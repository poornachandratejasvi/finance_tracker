"""Parses real-time bank spend/credit alert emails (the "Rs.X debited..." message
that arrives within seconds of a card swipe/transfer) — distinct from the monthly
PDF statement email. These give near-real-time visibility into spending well
before the statement (and its PDF) arrives, at the cost of being less complete
(no running balance reconciliation, no merchant category, etc.), which is why a
transaction created from one starts life as unconfirmed/"Pending" (see
Transaction.is_confirmed) until the statement transaction supersedes it.

Every pattern below was extracted from REAL alert emails in the user's own inbox
(not guessed/generic), one per linked bank. Add a new entry here for any bank
whose alert format isn't covered yet — `parse_alert_email` simply returns None
for anything that doesn't match, so an unrecognised email is skipped harmlessly
rather than mis-parsed.
"""
import re
import logging
from datetime import datetime
from typing import Optional, Dict

logger = logging.getLogger(__name__)

# Date formats seen across these banks' alert templates, tried in order.
_DATE_FORMATS = [
    "%d %b, %Y",   # 13 Mar, 2026
    "%d %b %Y",    # 20 Feb 2026
    "%b %d, %Y",   # Jul 29, 2026
    "%d-%m-%Y",    # 22-05-2026
    "%d-%m-%y",    # 30-10-25
    "%d/%m/%y",    # 16/01/26
    "%d/%m/%Y",
]


def _parse_date(date_str: str, time_str: Optional[str] = None) -> Optional[datetime]:
    date_str = date_str.strip().rstrip(",")
    dt = None
    for fmt in _DATE_FORMATS:
        try:
            dt = datetime.strptime(date_str, fmt)
            break
        except ValueError:
            continue
    if dt is None:
        return None
    if time_str:
        time_str = time_str.strip().upper().replace(" ", "")
        for tfmt in ("%I:%M:%S%p", "%H:%M:%S", "%I:%M%p", "%H:%M"):
            try:
                t = datetime.strptime(time_str, tfmt)
                dt = dt.replace(hour=t.hour, minute=t.minute, second=t.second)
                break
            except ValueError:
                continue
    return dt


def _amount(raw: str) -> float:
    return float(raw.replace(",", ""))


def _hdfc(sender, subject, body, received_date=None):
    m = re.search(
        r"Rs\.?\s*([\d,]+\.\d{2})\s+(?:is debited|has been debited) from your HDFC Bank Credit Card "
        r"ending (\d+) towards (.+?) on (\d{1,2} \w+,? \d{4}) at (\d{1,2}:\d{2}:\d{2})",
        body,
    )
    if not m:
        return None
    return {
        "amount": _amount(m.group(1)),
        "transaction_type": "debit",
        "description": m.group(3).strip(),
        "transaction_date": _parse_date(m.group(4), m.group(5)),
        "card_hint": m.group(2),
    }


def _icici(sender, subject, body, received_date=None):
    m = re.search(
        r"Your ICICI Bank Credit Card (?:XX)?(\d+) has been used for a transaction of INR "
        r"([\d,]+\.\d{2}) on (\w+ \d{1,2}, \d{4}) at (\d{1,2}:\d{2}:\d{2})\.?\s*Info:\s*(.+?)\.",
        body,
    )
    if not m:
        return None
    return {
        "amount": _amount(m.group(2)),
        "transaction_type": "debit",
        "description": m.group(5).strip(),
        "transaction_date": _parse_date(m.group(3), m.group(4)),
        "card_hint": m.group(1),
    }


def _sbi_card(sender, subject, body, received_date=None):
    m = re.search(
        r"Rs\.?([\d,]+\.\d{2}) spent on your SBI Credit Card ending (\d+) at (.+?) on (\d{2}/\d{2}/\d{2})",
        body,
    )
    if not m:
        return None
    return {
        "amount": _amount(m.group(1)),
        "transaction_type": "debit",
        "description": m.group(3).strip(),
        "transaction_date": _parse_date(m.group(4)),
        "card_hint": m.group(2),
    }


def _sbi_savings(sender, subject, body, received_date=None):
    m = re.search(
        r"Your A/C (\w+) has a (debit|credit) by transfer of Rs ([\d,]+\.\d{2}) on (\d{2}/\d{2}/\d{2})",
        body,
    )
    if not m:
        return None
    return {
        "amount": _amount(m.group(3)),
        "transaction_type": m.group(2),
        "description": "Bank transfer",
        "transaction_date": _parse_date(m.group(4)),
        "card_hint": m.group(1),
    }


def _bank_of_baroda(sender, subject, body, received_date=None):
    m = re.search(
        r"Rs\.?\s*([\d,]+\.\d{2})\s*(debited|credited)\s*(?:from|to)\s*A/c no\.?\s*(\w+) on "
        r"(\d{2}-\d{2}-\d{2}) via bob World",
        body,
    )
    if not m:
        return None
    return {
        "amount": _amount(m.group(1)),
        "transaction_type": "debit" if m.group(2) == "debited" else "credit",
        "description": "bob World transfer",
        "transaction_date": _parse_date(m.group(4)),
        "card_hint": m.group(3),
    }


def _rbl(sender, subject, body, received_date=None):
    m = re.search(
        r"Card swipe INR\s*([\d,]+\.\d{2}) spent at (.+?) on RBL Bank credit card \((\d+)\) on (\d{2}-\d{2}-\d{4})",
        body,
    )
    if not m:
        return None
    return {
        "amount": _amount(m.group(1)),
        "transaction_type": "debit",
        "description": m.group(2).strip(),
        "transaction_date": _parse_date(m.group(4)),
        "card_hint": m.group(3),
    }


def _yes_bank(sender, subject, body, received_date=None):
    m = re.search(
        r"INR\s*([\d,]+\.\d{2}) has been spent on your YES BANK Credit Card ending with (\d+) at "
        r"(.+?) on (\d{2}-\d{2}-\d{4}) at (\d{1,2}:\d{2}:\d{2}\s*[ap]m)",
        body,
        re.IGNORECASE,
    )
    if not m:
        return None
    return {
        "amount": _amount(m.group(1)),
        "transaction_type": "debit",
        "description": m.group(3).strip(),
        "transaction_date": _parse_date(m.group(4), m.group(5)),
        "card_hint": m.group(2),
    }


def _hsbc(sender, subject, body, received_date=None):
    m = re.search(
        r"Credit card no ending with (\d+),?\s*has been used for INR\s*([\d,]+\.\d{2}) for payment to "
        r"(.+?) on (\d{1,2} \w+ \d{4}) at (\d{1,2}:\d{2})",
        body,
    )
    if not m:
        return None
    return {
        "amount": _amount(m.group(2)),
        "transaction_type": "debit",
        "description": m.group(3).strip(),
        "transaction_date": _parse_date(m.group(4), m.group(5)),
        "card_hint": m.group(1),
    }


def _standard_chartered(sender, subject, body, received_date=None):
    # Two distinct CASA alert templates seen from the same sender: one names the
    # transfer type and includes an explicit date, the other is a terser
    # "credited/debited by" line with no date in the body at all — for that one
    # we fall back to the email's own received date (best-effort, same tolerance
    # as the ±3-day reconciliation window already used everywhere else here).
    m = re.search(
        r"there is an NEFT (credit|debit) of INR\s*([\d,]+\.\d{2}) in your account (\w+) on (\d{2}/\d{2}/\d{4})",
        body,
    )
    if m:
        return {
            "amount": _amount(m.group(2)),
            "transaction_type": m.group(1),
            "description": "NEFT transfer",
            "transaction_date": _parse_date(m.group(4)),
            "card_hint": m.group(3),
        }
    m = re.search(
        r"Your a/c no\.?\s*(\w+) is (credited|debited) by INR\s*([\d,]+\.\d{2})",
        body,
    )
    if m:
        return {
            "amount": _amount(m.group(3)),
            "transaction_type": "credit" if m.group(2) == "credited" else "debit",
            "description": "Bank transfer",
            "transaction_date": received_date.replace(tzinfo=None) if received_date else None,
            "card_hint": m.group(1),
        }
    return None


# (sender substring match, parser function) — checked in order, first match wins.
# Sender substrings are the ACTUAL alert-sending addresses observed in the inbox,
# which are frequently different from the statement-email sender configured on
# the Bank row (e.g. HDFC statements come from Emailstatements.cards@hdfcbank.net
# but alerts come from alerts@hdfcbank.net / alerts@hdfcbank.bank.in).
ALERT_PARSERS = [
    ("alerts@hdfcbank.net", _hdfc),
    ("alerts@hdfcbank.bank.in", _hdfc),
    ("credit_cards@icici.bank.in", _icici),
    ("onlinesbicard@sbicard.com", _sbi_card),
    ("alerts.sbi.bank.in", _sbi_savings),
    ("bankofbaroda.bank.in", _bank_of_baroda),
    ("rblalerts@rbl.bank.in", _rbl),
    ("rblalerts@rblbank.com", _rbl),
    ("notification.my.rbl.bank.in", _rbl),
    ("alerts@yes.bank.in", _yes_bank),
    ("alerts@yesbank.in", _yes_bank),
    ("hsbc@mail.hsbc.co.in", _hsbc),
    ("alerts.in@sc.com", _standard_chartered),
]


def parse_alert_email(sender: str, subject: str, body: str, received_date=None) -> Optional[Dict]:
    """Return {amount, transaction_type, description, transaction_date, card_hint}
    if this looks like a real-time spend/credit alert this module knows how to
    read, else None (never raises — a bank template change should degrade to
    "skipped", not break the sync). received_date is the email's own date, used
    as a transaction_date fallback by templates that don't include one in the body."""
    sender_lower = (sender or "").lower()
    for sender_match, parser in ALERT_PARSERS:
        if sender_match in sender_lower:
            try:
                result = parser(sender, subject, body, received_date=received_date)
            except Exception:
                logger.warning("Alert parser for %s raised on a message", sender_match, exc_info=True)
                return None
            if result and result.get("transaction_date") and result.get("amount"):
                return result
            return None
    return None
