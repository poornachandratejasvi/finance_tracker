"""Re-derive a credit card's outstanding balance (Total Amount Due) from its most
recent statement PDF, on demand.

Regex extraction (pdf_parser.extract_total_amount_due) works for some issuers but
misses others whose statement layout splits the label and the number across
different table cells, or repeats the same label in a stale payment-history
table elsewhere in the document. This module retries regex against the latest
statement and, if that comes up empty, falls back to asking the user's
configured AI provider to read a short excerpt and extract the figure. Manual
override always remains available via PUT /banks/{id}.
"""
import logging
import os
from typing import Optional

from sqlalchemy.orm import Session

from app.models.models import Bank, PDFStatement, BankEmail
from app.services.password_service import get_password_candidates
from app.services.pdf_storage import ensure_decrypted_with_candidates
from app.services.pdf_parser import PDFParser
from app.services import ai_pdf_extraction

logger = logging.getLogger(__name__)


def _latest_pdf(db: Session, bank_id: int) -> Optional[PDFStatement]:
    return (
        db.query(PDFStatement)
        .join(BankEmail, PDFStatement.bank_email_id == BankEmail.id)
        .filter(BankEmail.bank_id == bank_id)
        .order_by(PDFStatement.id.desc())
        .first()
    )


def redetect_credit_card_balance(db: Session, uid: int, bank: Bank, use_ai: bool = True) -> dict:
    """Re-derive one credit card's Total Amount Due from its latest statement.

    Returns a report dict: {bank_id, bank_name, old_balance, new_balance, source,
    detail}. source is one of: 'regex', 'ai', 'unchanged', 'no_pdf', 'locked',
    'parse_error', 'not_found'. Does not raise; failures are reported, not thrown.
    """
    report = {
        "bank_id": bank.id, "bank_name": bank.name,
        "old_balance": bank.current_balance, "new_balance": bank.current_balance,
        "source": "unchanged", "detail": None,
    }

    pdf = _latest_pdf(db, bank.id)
    if not pdf:
        report["source"] = "no_pdf"
        report["detail"] = "No statement PDF on file for this account."
        return report

    candidates = get_password_candidates(db, bank)
    try:
        path, _used = ensure_decrypted_with_candidates(db, pdf, candidates)
    except Exception as e:
        report["source"] = "locked"
        report["detail"] = f"Could not decrypt PDF: {str(e)[:150]}"
        return report

    if not path or not os.path.exists(path):
        report["source"] = "locked"
        report["detail"] = "PDF is password-protected and no stored password worked."
        return report

    try:
        text = PDFParser.extract_text(path)
    except Exception as e:
        report["source"] = "parse_error"
        report["detail"] = f"Failed to read PDF text: {str(e)[:150]}"
        return report

    if not text:
        report["source"] = "parse_error"
        report["detail"] = "PDF produced no extractable text (likely a scanned image)."
        return report

    new_balance = PDFParser.extract_total_amount_due(text)
    source = "regex" if new_balance is not None else None
    ai_error = None

    if new_balance is None and use_ai:
        try:
            summary = ai_pdf_extraction.extract_billing_summary(db, uid, text)
            ai_error = summary.get("_error")
            new_balance = summary.get("total_amount_due")
            if new_balance is not None:
                source = "ai"
        except Exception as e:
            ai_error = str(e)[:200]
            logger.info("AI balance fallback failed for bank %s: %s", bank.id, ai_error)

    if new_balance is None:
        if ai_error:
            report["source"] = "ai_error"
            low = ai_error.lower()
            if "429" in ai_error or "quota" in low or "resource_exhausted" in low:
                report["detail"] = "Regex found nothing and the AI provider's quota is exhausted — try again later, or set the balance manually."
            else:
                report["detail"] = f"Regex found nothing and the AI fallback failed: {ai_error}"
        else:
            report["source"] = "not_found"
            report["detail"] = "Neither regex nor AI could find a Total Amount Due figure. Set it manually."
        return report

    if bank.current_balance == new_balance:
        # Value didn't change, but a manual override still needs to be cleared here —
        # this path runs for both the explicit "Redetect" button and the periodic auto
        # task, and the caller distinguishes them by whether 'manual' banks were queried.
        bank.balance_source = "auto"
        report["source"] = "unchanged"
        return report

    bank.current_balance = new_balance
    bank.balance_updated_at = pdf.statement_period_end or pdf.created_at
    bank.balance_source = "auto"  # re-detecting explicitly supersedes any earlier manual override
    report["new_balance"] = new_balance
    report["source"] = source
    return report


def redetect_all_credit_balances(db: Session, uid: int, use_ai: bool = True) -> list:
    """Run redetect_credit_card_balance for every credit-card account the user has."""
    banks = (
        db.query(Bank)
        .filter(Bank.user_id == uid, Bank.bank_type == "credit")
        .all()
    )
    reports = []
    for b in banks:
        reports.append(redetect_credit_card_balance(db, uid, b, use_ai=use_ai))
    db.commit()
    return reports
