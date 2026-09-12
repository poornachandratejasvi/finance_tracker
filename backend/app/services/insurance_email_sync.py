"""Fetches and parses insurer premium-receipt emails into InsurancePolicy's
next_premium_due_date/last_premium_paid_date/last_premium_amount -- see
insurance_email_service.py for the per-insurer PDF parsers.

Mirrors alert_sync_service.py's shape closely: broad keyword search (Gmail's
`has:attachment filename:pdf` genuinely narrows this one, unlike the alert
path, since a premium receipt always has the PDF attached), sender-domain
matching against each policy's configured sender_email, with the same
forwarded-copy fallback (a receipt often lands at a work inbox and gets
manually forwarded to the Gmail account this app watches).
"""
import json
import logging
import tempfile
import os
from typing import List

from app.models.models import GmailAccount, InsurancePolicy, InsuranceEmail
from app.services.gmail_service import GmailService, credentials_from_dict
from app.services.email_forwarding_utils import extract_forwarded_sender
from app.services.insurance_email_service import parse_insurance_pdf
from app.services.pdf_parser import PDFParser

logger = logging.getLogger(__name__)

# Broad on purpose (any insurer, any premium-receipt wording), narrowed
# afterward in Python by matching the sender's domain against each policy's
# configured sender_email -- same "keyword-only Gmail query, precise Python
# filter" split as alert_sync_service.py.
INSURANCE_KEYWORDS_QUERY = (
    'has:attachment filename:pdf (premium OR renewal OR receipt OR "insurance cover")'
)


def _policy_domains(policies: List[InsurancePolicy]) -> dict:
    """Mirrors alert_sync_service.py's _bank_domains() -- a policy can list
    more than one sender domain (e.g. LIC sends premium receipts from either
    licindia.com directly or licreceipt@billdesk.in depending on payment
    channel), so sender_emails (JSON array) is checked alongside the single
    primary sender_email."""
    domain_to_policy = {}
    for p in policies:
        emails = []
        if p.sender_email:
            emails.append(p.sender_email)
        if p.sender_emails:
            try:
                emails.extend(json.loads(p.sender_emails))
            except Exception:
                pass
        for e in emails:
            if e and "@" in e:
                domain_to_policy[e.split("@")[1].lower()] = p
    return domain_to_policy


def sync_insurance_emails(db, gmail_account: GmailAccount, policies: List[InsurancePolicy], after_date=None) -> int:
    """Search this Gmail account for premium-receipt emails, match each to one
    of `policies` by sender domain (direct or forwarded), decrypt+parse the
    attached PDF, and update that policy's premium tracking fields. Returns
    how many policies were updated. Never raises -- a broken Gmail token or a
    parser bug should degrade to "synced nothing this round", not blow up the
    beat task for every other account."""
    domain_to_policy = _policy_domains(policies)
    if not domain_to_policy:
        return 0

    creds_dict = json.loads(gmail_account.credentials) if isinstance(gmail_account.credentials, str) else gmail_account.credentials
    if not creds_dict:
        return 0

    try:
        creds = credentials_from_dict(creds_dict)
        gmail_service = GmailService()
        if not gmail_service.authenticate_with_credentials(creds):
            return 0
    except Exception:
        logger.warning("Could not authenticate Gmail account %s for insurance sync", gmail_account.id, exc_info=True)
        return 0

    try:
        messages = gmail_service.search_messages_with_body(INSURANCE_KEYWORDS_QUERY, max_results=50, after_date=after_date)
    except Exception:
        logger.warning("Insurance-email search failed for Gmail account %s", gmail_account.id, exc_info=True)
        return 0

    updated = 0
    for msg in messages:
        try:
            if not msg.get("attachments"):
                continue
            if db.query(InsuranceEmail).filter(InsuranceEmail.email_id == msg["id"]).first():
                continue

            sender = msg.get("sender", "")
            sender_domain = sender.split("@")[-1].rstrip(">").lower() if "@" in sender else ""
            policy = next((p for d, p in domain_to_policy.items() if sender_domain and sender_domain.endswith(d)), None)

            if not policy:
                forwarded_sender = extract_forwarded_sender(msg.get("body", "") or "")
                if forwarded_sender:
                    forwarded_domain = forwarded_sender.split("@")[-1].lower()
                    forwarded_policy = next(
                        (p for d, p in domain_to_policy.items() if forwarded_domain.endswith(d)), None
                    )
                    if forwarded_policy:
                        policy = forwarded_policy
                        sender = forwarded_sender

            if not policy:
                continue

            db.add(InsuranceEmail(
                gmail_account_id=gmail_account.id, policy_id=policy.id, email_id=msg["id"],
                subject=msg.get("subject"), from_email=sender, received_date=msg.get("date"),
                is_processed=True,
            ))

            att = msg["attachments"][0]
            data = gmail_service.get_attachment(msg["id"], att["attachmentId"])
            if not data:
                db.commit()
                continue

            tmp_path = None
            try:
                with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
                    tmp.write(data)
                    tmp_path = tmp.name
                text = PDFParser.extract_text(tmp_path, password=policy.pdf_password) or ""
            except Exception:
                logger.warning("Failed to decrypt/extract insurance PDF for policy %s", policy.id, exc_info=True)
                db.commit()
                continue
            finally:
                if tmp_path:
                    os.unlink(tmp_path)

            parsed = parse_insurance_pdf(sender, text)
            if not parsed:
                db.commit()
                continue

            policy.next_premium_due_date = parsed["next_due_date"]
            policy.last_premium_paid_date = parsed["paid_date"]
            policy.last_premium_amount = parsed["amount"]
            db.commit()
            updated += 1
        except Exception:
            logger.warning("Failed to process one insurance-email candidate", exc_info=True)
            db.rollback()

    return updated
