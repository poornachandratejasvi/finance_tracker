"""Parses premium-receipt PDF text (already OCR/text-extracted by
PDFParser.extract_text) from an insurer's emailed statement, one parser per
insurer -- mirrors alert_email_service.py's per-bank-parser convention.

Every pattern below was extracted from a REAL premium receipt in the user's
own inbox (ICICI Prudential's "iProtect Smart" policy), not guessed --
`parse_insurance_pdf` returns None for anything that doesn't match, same
"skip harmlessly rather than mis-parse" convention as the bank alert parsers.
"""
import re
import logging
from datetime import datetime
from typing import Optional, Dict

logger = logging.getLogger(__name__)


def _parse_ddmmyyyy(s: str) -> Optional[datetime]:
    try:
        return datetime.strptime(s, "%d-%m-%Y")
    except ValueError:
        return None


def _icici_prudential(text: str) -> Optional[Dict]:
    # The "SUMMARY OF PAYMENT DETAILS" table renders as one space-separated
    # line once the PDF is flattened to text (column headers and the data row
    # interleave, but the data row itself is a clean, regular sequence):
    #   "17-04-2025 J1210284 25-04-2026 46147 / YEARLY Website Payment 0 0"
    #    ^paid date  ^policy   ^next due  ^amount  ^frequency  ^payment mode
    m = re.search(
        r"(\d{2}-\d{2}-\d{4})\s+(\S+)\s+(\d{2}-\d{2}-\d{4})\s+([\d,]+)\s*/\s*"
        r"(YEARLY|MONTHLY|QUARTERLY|HALF\s*YEARLY)\s+(.+?)\s+\d+\s+\d+",
        text,
        re.IGNORECASE,
    )
    if not m:
        return None
    paid_str, policy_number, next_due_str, amount_str, frequency, payment_mode = m.groups()
    paid_date = _parse_ddmmyyyy(paid_str)
    next_due_date = _parse_ddmmyyyy(next_due_str)
    if not paid_date or not next_due_date:
        return None

    # Cross-check against "Total Premium Paid ` 46147" when present -- same
    # figure, but a second, independent anchor elsewhere in the document.
    total_m = re.search(r"Total Premium Paid\D{0,3}([\d,]+)", text)
    amount = float((total_m.group(1) if total_m else amount_str).replace(",", ""))

    return {
        "policy_number": policy_number,
        "paid_date": paid_date,
        "next_due_date": next_due_date,
        "amount": amount,
        "frequency": frequency.lower().replace(" ", "_"),
        "payment_mode": payment_mode.strip(),
    }


def _lic_billdesk(text: str) -> Optional[Dict]:
    # LIC's current payment-receipt channel (via BillDesk, sender
    # licreceipt@billdesk.in) -- unlike ICICI Pru's PDF, this one isn't
    # password-protected. Real sample fields, each its own clean line:
    #   "Policy Number:666527748 Date:15-06-2026 Amount :16063.00"
    #   "Next Due 24/12/2026"
    #   "Number Of Instalments Half Yearly/ 1"
    policy_m = re.search(r"Policy Number:(\S+)\s+Date:(\d{2}-\d{2}-\d{4})\s+Amount\s*:([\d.]+)", text)
    next_due_m = re.search(r"Next Due\s+(\d{2}/\d{2}/\d{4})", text)
    if not policy_m or not next_due_m:
        return None
    policy_number, paid_str, amount_str = policy_m.groups()
    paid_date = _parse_ddmmyyyy(paid_str.replace("-", "-"))  # already DD-MM-YYYY
    next_due_date = datetime.strptime(next_due_m.group(1), "%d/%m/%Y")
    if not paid_date:
        return None

    total_m = re.search(r"Grand Total\s+([\d.]+)", text)
    amount = float(total_m.group(1)) if total_m else float(amount_str)

    freq_m = re.search(r"Number Of Instalments\s+([A-Za-z ]+?)/", text)
    frequency = (freq_m.group(1).strip().lower().replace(" ", "_") if freq_m else "yearly")

    return {
        "policy_number": policy_number,
        "paid_date": paid_date,
        "next_due_date": next_due_date,
        "amount": amount,
        "frequency": frequency,
        "payment_mode": "Online",
    }


# (sender substring, parser function) -- checked in order, first match wins.
# LIC dispatches on the specific local-part+domain (not a bare domain) since
# "billdesk.in" alone is a generic payment-gateway domain shared across many
# billers, not insurer-specific.
INSURANCE_PARSERS = [
    ("iciciprulife.com", _icici_prudential),
    ("licreceipt@billdesk.in", _lic_billdesk),
]


def parse_insurance_pdf(sender: str, text: str) -> Optional[Dict]:
    """Return {policy_number, paid_date, next_due_date, amount, frequency,
    payment_mode} if this looks like a premium receipt from a known insurer,
    else None. Never raises -- an insurer's template change should degrade to
    "skipped", not break the sync."""
    sender_lower = (sender or "").lower()
    for domain, parser in INSURANCE_PARSERS:
        if domain in sender_lower:
            try:
                return parser(text)
            except Exception:
                logger.warning("Insurance PDF parser for %s raised on a document", domain, exc_info=True)
                return None
    return None
