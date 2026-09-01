"""Fetches shipping-confirmation/out-for-delivery/delivered emails and upserts
Package rows -- see shipment_email_service.py for the per-sender parsers. Not
bank-scoped (unlike alert_sync_service.py): carriers/merchants aren't tied to a
configured Bank, so this searches its own broader carrier-keyword query and
dedupes via its own ShipmentEmail log instead of BankEmail.
"""
import json
import logging
from typing import Optional

from app.models.models import Package, ShipmentEmail, GmailAccount
from app.services.gmail_service import GmailService, credentials_from_dict
from app.services.shipment_email_service import parse_shipment_email

logger = logging.getLogger(__name__)

SHIPMENT_KEYWORDS_QUERY = (
    # Amazon senders + subject prefixes are precise (confirmed against real
    # inbox mail -- their subjects always start with one of these words), which
    # keeps unrelated Amazon mail (Diamonds credits, return/refund confirmations,
    # review requests) out of the sync entirely.
    '((from:shipment-tracking@amazon.in OR from:auto-confirm@amazon.in OR from:order-update@amazon.in) '
    '(subject:Shipped OR subject:Ordered OR subject:Delivered OR subject:"Out for delivery")) '
    'OR ((from:flipkart.com OR from:delhivery.com OR from:bluedart.com OR from:dtdc.com '
    'OR from:ekartlogistics.com OR from:indiapost.gov.in OR from:xpressbees.com '
    'OR from:ecomexpress.in OR from:shadowfax.in) '
    '(shipped OR dispatched OR "out for delivery" OR delivered OR "on its way"))'
)


def _find_or_create_package(db, user_id: int, gmail_account_id: int, parsed: dict) -> Package:
    pkg: Optional[Package] = None
    if parsed.get("tracking_number"):
        pkg = db.query(Package).filter(
            Package.user_id == user_id,
            Package.carrier == parsed["carrier"],
            Package.tracking_number == parsed["tracking_number"],
        ).first()
    if not pkg and parsed.get("merchant") and parsed.get("order_id"):
        pkg = db.query(Package).filter(
            Package.user_id == user_id,
            Package.merchant == parsed["merchant"],
            Package.order_id == parsed["order_id"],
            Package.tracking_number.is_(None),
        ).first()

    if pkg:
        if parsed.get("tracking_number") and not pkg.tracking_number:
            pkg.tracking_number = parsed["tracking_number"]
    else:
        pkg = Package(
            user_id=user_id, gmail_account_id=gmail_account_id, source="email",
            carrier=parsed["carrier"], merchant=parsed.get("merchant"),
            order_id=parsed.get("order_id"), tracking_number=parsed.get("tracking_number"),
        )
        db.add(pkg)

    if parsed.get("item_description"):
        pkg.item_description = parsed["item_description"]
    if parsed.get("status"):
        pkg.status = parsed["status"]
    if parsed.get("expected_delivery_date"):
        pkg.expected_delivery_date = parsed["expected_delivery_date"]
    if parsed.get("actual_delivery_date"):
        pkg.actual_delivery_date = parsed["actual_delivery_date"]
    if parsed.get("tracking_url"):
        pkg.tracking_url = parsed["tracking_url"]
    return pkg


def sync_shipment_emails(db, gmail_account: GmailAccount, after_date=None) -> int:
    """Search this Gmail account for shipment-tracking emails, parse each, and
    upsert a Package row. Returns count of packages newly created/updated.
    Never raises -- a broken token or parser bug degrades to "synced nothing
    this round", not a broken beat task for every other account."""
    creds_dict = json.loads(gmail_account.credentials) if isinstance(gmail_account.credentials, str) else gmail_account.credentials
    if not creds_dict:
        return 0

    try:
        creds = credentials_from_dict(creds_dict)
        gmail_service = GmailService()
        if not gmail_service.authenticate_with_credentials(creds):
            return 0
    except Exception:
        logger.warning("Could not authenticate Gmail account %s for shipment sync", gmail_account.id, exc_info=True)
        return 0

    try:
        messages = gmail_service.search_messages_with_body(SHIPMENT_KEYWORDS_QUERY, max_results=100, after_date=after_date)
    except Exception:
        logger.warning("Shipment-email search failed for Gmail account %s", gmail_account.id, exc_info=True)
        return 0

    if getattr(gmail_service, "credentials_refreshed", False):
        try:
            refreshed = gmail_service.get_refreshed_credentials_dict()
            if refreshed:
                gmail_account.credentials = json.dumps(refreshed)
                db.commit()
        except Exception:
            logger.warning("Failed to persist refreshed credentials for Gmail account %s", gmail_account.id, exc_info=True)

    touched = 0
    for msg in messages:
        try:
            if db.query(ShipmentEmail).filter(ShipmentEmail.email_id == msg["id"]).first():
                continue

            sender = msg.get("sender", "")
            # A single email can cover multiple distinct orders (Amazon's
            # combined "Ordered"/"Shipped" digest emails) -- one Package per
            # entry, all logged against the same ShipmentEmail dedup row.
            parsed_list = parse_shipment_email(sender, msg.get("subject", ""), msg.get("body", "") or "", received_date=msg.get("date"))

            first_pkg = None
            for parsed in parsed_list:
                pkg = _find_or_create_package(db, gmail_account.user_id, gmail_account.id, parsed)
                pkg.last_gmail_message_id = msg["id"]
                first_pkg = first_pkg or pkg
                touched += 1

            db.add(ShipmentEmail(
                gmail_account_id=gmail_account.id,
                package_id=first_pkg.id if first_pkg else None,
                email_id=msg["id"], subject=msg.get("subject"), from_email=sender,
                received_date=msg.get("date"), carrier_detected=parsed_list[0]["carrier"] if parsed_list else None,
                is_processed=True,
            ))
            db.commit()
        except Exception:
            logger.warning("Failed to process one shipment-email candidate", exc_info=True)
            db.rollback()

    return touched
