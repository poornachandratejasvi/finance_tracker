"""AI-assisted fallback for parsing a bank transaction SMS when the regex-based
parser in ingest.py (_SMS_AMOUNT_RE / _SMS_CREDIT_RE) can't find a Rs./INR
amount -- SMS templates vary a lot across banks (some spell out "Rs" or "INR",
others use a currency glyph that renders oddly, others phrase the amount as
"debited by" with no currency marker at all). This is a fallback, not the
primary path: it only runs if the regex comes back empty, and only if the
user has an AI provider configured.

Kept deliberately narrow-scope and cheap: SMS text is already short (no
excerpt-building needed), and max_tokens is small, since this may run once
per incoming SMS.
"""
import logging

from sqlalchemy.orm import Session

from app.services import ai_service

logger = logging.getLogger(__name__)


def extract_sms_transaction(db: Session, uid: int, text: str) -> dict:
    """Ask the user's configured AI provider to pull a transaction out of a
    bank SMS's raw text. Returns {} (never raises) if no provider is
    configured, the call fails, or nothing parseable comes back.

    Returned dict keys: amount (float), transaction_type ("credit"|"debit"),
    description (str|None) -- all present together, or the dict is empty.
    """
    if not text or not text.strip():
        return {}

    system = (
        "You extract a single bank transaction from a raw SMS alert. Bank SMS "
        "templates vary: the amount may follow 'Rs.', 'INR', 'Rs', a currency "
        "symbol that garbled into a stray letter, or no marker at all (e.g. "
        "'a/c debited by 500'). Identify the transaction amount as a positive "
        "number, and whether money left the SMS RECIPIENT's own account (debit) "
        "or arrived in it (credit) -- watch for UPI-transfer SMS that mention "
        "TWO accounts and BOTH words, e.g. 'Your a/c XX1234 is debited for Rs.500 "
        "... and credited to a/c XX5678': that is a debit (the recipient's own "
        "account XX1234 lost the money; 'credited' there describes the OTHER "
        "party's account, not theirs). The recipient's own account is normally "
        "the one introduced first ('Your a/c ...'). Also produce a short "
        "human-readable description (e.g. the merchant name or 'ATM withdrawal' "
        "-- not the whole SMS). Respond ONLY with a JSON "
        'object: {"amount": <number or null>, "transaction_type": "credit" or '
        '"debit" or null, "description": "<short string or null>"}. No prose, '
        "no markdown fences. Use null for anything you can't confidently identify."
    )
    prompt = f"SMS TEXT:\n{text.strip()[:500]}"

    try:
        raw = ai_service.complete(db, uid, system, prompt, max_tokens=150)
    except Exception as e:
        logger.info("AI SMS extraction unavailable: %s", str(e)[:150])
        return {}

    data = ai_service._extract_json(raw)
    if not isinstance(data, dict):
        return {}

    amount = data.get("amount")
    ttype = data.get("transaction_type")
    if not (isinstance(amount, (int, float)) and amount > 0):
        return {}
    if ttype not in ("credit", "debit"):
        return {}

    description = data.get("description")
    return {
        "amount": float(amount),
        "transaction_type": ttype,
        "description": description.strip()[:140] if isinstance(description, str) and description.strip() else None,
    }
