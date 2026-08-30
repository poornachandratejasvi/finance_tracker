"""Fetches and parses real-time bank spend/credit alert emails into pending
("Pending" badge, is_confirmed=False) Transaction rows — see
alert_email_service.py for the per-bank parsers and transaction_hooks.py for
how they get reconciled away once the real statement transaction arrives.

Distinct from the PDF-statement sync path (sync.py/sync_tasks.py): those search
Gmail for `has:attachment filename:pdf`, which structurally excludes alert
emails (plain text/HTML, no attachment) — so this uses its own broader,
keyword-based search instead of reusing that query.
"""
import json
import logging
from typing import List

from app.models.models import Bank, BankEmail, GmailAccount, Transaction
from app.services.gmail_service import GmailService, credentials_from_dict
from app.services.alert_email_service import parse_alert_email
from app.services.transaction_hooks import apply_auto_rules_and_notify, dedupe_incoming_pending

logger = logging.getLogger(__name__)

# Broad on purpose — narrowed afterward in Python by matching the sender's domain
# against each bank's already-configured sender_email/sender_emails (see
# _bank_domains). Keeping the Gmail-side query keyword-only (no domain/from:
# filter) sidesteps uncertainty about whether Gmail's from: operator matches
# sub-domains the way plain `str.endswith` does (e.g. alerts sent from
# notification.my.rbl.bank.in, a subdomain of the bank's configured domain).
#
# `-has:attachment` is deliberately NOT dropped globally: Gmail's has:attachment
# also flags inline images (a bank alert template's embedded logo, say), and if a
# real PDF-statement email ever matched one of these keywords too, letting the
# alert-sync task see it first would mark its BankEmail row is_processed=True and
# permanently block the real statement-sync pipeline from ever downloading that
# PDF (see sync.py's `if existing_email and existing_email.is_processed: continue`).
# Standard Chartered's CASA alert template embeds such an inline image, so it gets
# a narrow, sender-scoped carve-out instead of loosening the blanket filter.
ALERT_KEYWORDS_QUERY = (
    '(-has:attachment (debited OR credited OR "has been spent" OR "has been used" '
    'OR "card swipe" OR spent OR "debit by transfer" OR "credit by transfer")) '
    'OR (from:alerts.in@sc.com (credited OR debited OR credit OR debit))'
)


def _bank_domains(bank: Bank) -> set:
    emails = []
    if bank.sender_email:
        emails.append(bank.sender_email)
    if bank.sender_emails:
        try:
            emails.extend(json.loads(bank.sender_emails))
        except Exception:
            pass
    return {e.split('@')[1].lower() for e in emails if e and '@' in e}


def _already_confirmed(db, user_id: int, bank_id: int, parsed: dict) -> bool:
    """True if a CONFIRMED transaction already covers this real-world spend
    (e.g. the statement was processed before this alert got around to being
    synced) — in which case creating a pending duplicate would be wrong."""
    from app.services.transaction_hooks import find_confirmed_match

    return find_confirmed_match(
        db, user_id, bank_id, parsed["transaction_type"], parsed["amount"], parsed["transaction_date"],
    ) is not None


def sync_alert_emails(db, gmail_account: GmailAccount, banks: List[Bank], after_date=None) -> int:
    """Search this Gmail account for alert-style emails, match each to one of
    `banks` by sender domain, parse, and create a pending Transaction. Returns
    how many new pending transactions were created. Never raises — a broken
    Gmail token or a parser bug should degrade to "synced nothing this round",
    not blow up the beat task for every other account."""
    creds_dict = json.loads(gmail_account.credentials) if isinstance(gmail_account.credentials, str) else gmail_account.credentials
    if not creds_dict:
        return 0

    domain_to_bank = {}
    for bank in banks:
        for domain in _bank_domains(bank):
            domain_to_bank[domain] = bank
    if not domain_to_bank:
        return 0

    try:
        creds = credentials_from_dict(creds_dict)
        gmail_service = GmailService()
        if not gmail_service.authenticate_with_credentials(creds):
            return 0
    except Exception:
        logger.warning("Could not authenticate Gmail account %s for alert sync", gmail_account.id, exc_info=True)
        return 0

    try:
        messages = gmail_service.search_messages_with_body(ALERT_KEYWORDS_QUERY, max_results=100, after_date=after_date)
    except Exception:
        logger.warning("Alert-email search failed for Gmail account %s", gmail_account.id, exc_info=True)
        return 0

    created = 0
    for msg in messages:
        try:
            if db.query(BankEmail).filter(BankEmail.email_id == msg['id']).first():
                continue

            sender = msg.get('sender', '')
            sender_domain = sender.split('@')[-1].rstrip('>').lower() if '@' in sender else ''
            bank = next((b for d, b in domain_to_bank.items() if sender_domain and sender_domain.endswith(d)), None)
            if not bank:
                # An alert-keyword match from a sender domain no configured bank owns.
                # Previously this was a silent `continue` -- no log, no record, no way
                # to ever notice a bank alert was being ignored. Log it (visible in
                # Settings -> Application Logs) and mark the message processed under
                # the per-user "External" bank so it isn't re-logged every 15 minutes
                # for the next ~2 days (this task's rolling after_date window) -- but
                # deliberately don't create a Transaction for it, since we have no
                # confirmed bank to attribute real money movement to.
                logger.warning(
                    "Alert email from unrecognized sender '%s' (Gmail account %s) -- no bank has this domain "
                    "configured. Add it to a bank's sender email(s) if this is a real bank alert.",
                    sender, gmail_account.id,
                )
                from app.api.endpoints.ingest import _get_external_bank
                from app.models.models import User
                owner = db.query(User).filter(User.id == gmail_account.user_id).first()
                if owner:
                    external = _get_external_bank(db, owner)
                    db.add(BankEmail(
                        gmail_account_id=gmail_account.id, bank_id=external.id, email_id=msg['id'],
                        subject=msg.get('subject'), from_email=sender, received_date=msg.get('date'),
                        has_attachment=False, email_type='alert', is_processed=True,
                    ))
                    db.commit()
                continue

            parsed = parse_alert_email(sender, msg.get('subject', ''), msg.get('body', '') or '', received_date=msg.get('date'))

            db.add(BankEmail(
                gmail_account_id=gmail_account.id, bank_id=bank.id, email_id=msg['id'],
                subject=msg.get('subject'), from_email=sender, received_date=msg.get('date'),
                has_attachment=False, email_type='alert', is_processed=True,
            ))

            if parsed and not _already_confirmed(db, bank.user_id, bank.id, parsed):
                # Gmail is the highest-priority real-time source (see
                # transaction_hooks._SOURCE_PRIORITY) -- if an SMS/Shortcut-ingest
                # pending row already covers this same purchase, absorb it into
                # this Gmail data in place instead of creating a second pending row.
                _, deduped = dedupe_incoming_pending(
                    db, bank.user_id, bank.id,
                    {
                        "transaction_date": parsed["transaction_date"],
                        "amount": parsed["amount"],
                        "transaction_type": parsed["transaction_type"],
                        "description": parsed["description"],
                    },
                    source="alert",
                )
                if not deduped:
                    transaction = Transaction(
                        user_id=bank.user_id, bank_id=bank.id,
                        transaction_date=parsed["transaction_date"], description=parsed["description"],
                        amount=parsed["amount"], transaction_type=parsed["transaction_type"],
                        source="alert", is_confirmed=False,
                    )
                    db.add(transaction)

                    try:
                        from app.services.balance_service import adjust_credit_balance_for_new_transaction
                        adjust_credit_balance_for_new_transaction(bank, transaction)
                    except Exception:
                        logger.warning("Post-statement balance adjustment failed for bank %s", bank.id, exc_info=True)

                    apply_auto_rules_and_notify(db, bank.user_id, transaction)
                    created += 1

            db.commit()
        except Exception:
            logger.warning("Failed to process one alert-email candidate", exc_info=True)
            db.rollback()

    return created
