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
from datetime import datetime
from typing import Optional

from sqlalchemy.orm import Session

from app.models.models import Bank, PDFStatement, BankEmail, CreditCardBill
from app.services.password_service import get_password_candidates
from app.services.pdf_storage import ensure_decrypted_with_candidates
from app.services.pdf_parser import PDFParser
from app.services import ai_pdf_extraction

logger = logging.getLogger(__name__)


def _parse_iso_date(s: str) -> Optional[datetime]:
    try:
        return datetime.fromisoformat(s)
    except (ValueError, TypeError):
        return None


def _upsert_credit_card_bill(db: Session, bank: Bank, due_date: datetime, statement_date, total_amount_due, minimum_due) -> CreditCardBill:
    """Create or update this cycle's CreditCardBill row, deduped by
    (bank_id, due_date) -- a re-parse of the same statement (or a later
    redetect run before the next cycle) updates figures in place instead of
    creating a duplicate row per cycle."""
    bill = (
        db.query(CreditCardBill)
        .filter(CreditCardBill.bank_id == bank.id, CreditCardBill.due_date == due_date)
        .first()
    )
    if not bill:
        bill = CreditCardBill(bank_id=bank.id, user_id=bank.user_id, due_date=due_date)
        db.add(bill)
    if statement_date is not None:
        bill.statement_date = statement_date
    if total_amount_due is not None:
        bill.total_amount_due = total_amount_due
    if minimum_due is not None:
        bill.minimum_amount_due = minimum_due
    return bill


def _latest_pdf(db: Session, bank_id: int) -> Optional[tuple]:
    """Returns (PDFStatement, received_date) for the chronologically latest statement
    email on file for this bank. Ordered by the email's actual received date, not
    PDFStatement.id -- statements are frequently backfilled/reprocessed out of
    order, so "highest id" is often an older statement re-synced later, not the
    newest one."""
    return (
        db.query(PDFStatement, BankEmail.received_date)
        .join(BankEmail, PDFStatement.bank_email_id == BankEmail.id)
        .filter(BankEmail.bank_id == bank_id)
        .order_by(BankEmail.received_date.desc().nullslast(), PDFStatement.id.desc())
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

    row = _latest_pdf(db, bank.id)
    if not row:
        report["source"] = "no_pdf"
        report["detail"] = "No statement PDF on file for this account."
        return report
    pdf, received_date = row

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
    due_date = PDFParser.extract_due_date(text)
    statement_date = PDFParser.extract_statement_date(text)
    minimum_due = None
    source = "regex" if new_balance is not None else None
    ai_error = None

    # Only pay for an AI call if regex left something on the table -- balance,
    # due date, or statement date. All three ride the same call when needed
    # (extract_billing_summary returns all of them together), so a statement
    # regex fully handles never triggers one at all.
    if (new_balance is None or due_date is None) and use_ai:
        try:
            summary = ai_pdf_extraction.extract_billing_summary(db, uid, text)
            ai_error = summary.get("_error")
            if new_balance is None:
                new_balance = summary.get("total_amount_due")
                if new_balance is not None:
                    source = "ai"
            if due_date is None and summary.get("due_date"):
                due_date = _parse_iso_date(summary["due_date"])
            if statement_date is None and summary.get("statement_date"):
                statement_date = _parse_iso_date(summary["statement_date"])
            minimum_due = summary.get("minimum_amount_due")
        except Exception as e:
            ai_error = str(e)[:200]
            logger.info("AI balance fallback failed for bank %s: %s", bank.id, ai_error)

    if due_date is not None:
        _upsert_credit_card_bill(db, bank, due_date, statement_date, new_balance, minimum_due)
    elif new_balance is None or new_balance >= 1.0:
        # Still no due date, and this isn't a genuine "nothing owed" cycle
        # (a real near-zero balance like RBL's "Payment Due Date: Not
        # Applicable" or SBI's "NO PAYMENT REQUIRED" correctly has none --
        # skip those rather than re-uploading an unpaid-but-actually-paid-off
        # card's statement forever) -- try Paperless-ngx's OCR as a last
        # resort, best-effort and fully async (never blocks this call).
        try:
            from app.services import paperless_service
            if paperless_service.is_configured(db):
                from app.tasks.statement_ocr_tasks import enqueue_statement_ocr
                enqueue_statement_ocr.delay(pdf.id, bank.id, uid, purpose="credit_card_bill")
        except Exception:
            logger.info("Could not queue Paperless OCR fallback for bank %s", bank.id, exc_info=True)

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
    bank.balance_updated_at = pdf.statement_period_end or received_date or pdf.created_at
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
