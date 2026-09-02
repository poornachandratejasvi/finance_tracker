"""Celery tasks: fallback statement-summary extraction via Paperless-ngx's OCR,
for a statement whose Total Amount Due / due date live in a graphic (not a
real text layer) that this app's own PDFParser/AI-on-raw-text extraction can
never see -- Paperless's OCR reads the actual rendered page, catching what a
text-layer-only extraction misses (confirmed real cases: an ICICI statement's
summary box came through as raw font glyph codes, not readable text, in
pdfplumber's extraction).

Entirely optional -- only runs if Paperless-ngx is configured (see
credit_balance_service.py for when this gets triggered) and this app already
has that integration for receipt archiving; this reuses the exact same
upload/poll mechanism, just for a different document type and a different use
of the result (re-extraction, not just linking a document to a transaction).
"""
import logging
import os

from app.core.celery_app import celery_app

logger = logging.getLogger(__name__)


@celery_app.task(name="statement_ocr.enqueue")
def enqueue_statement_ocr(bank_id: int):
    """Decrypt + upload the bank's latest statement PDF to Paperless, then
    hand off to poll_statement_ocr to wait for OCR and re-run extraction."""
    from app.core.database import SessionLocal
    from app.models.models import Bank
    from app.services.password_service import get_password_candidates
    from app.services.pdf_storage import ensure_decrypted_with_candidates
    from app.services.credit_balance_service import _latest_pdf
    from app.services import paperless_service

    db = SessionLocal()
    try:
        bank = db.query(Bank).filter(Bank.id == bank_id).first()
        if not bank:
            return
        row = _latest_pdf(db, bank_id)
        if not row:
            return
        pdf, _received = row
        candidates = get_password_candidates(db, bank)
        try:
            path, _used = ensure_decrypted_with_candidates(db, pdf, candidates)
        except Exception:
            logger.info("Statement OCR: could not decrypt PDF for bank %s", bank_id, exc_info=True)
            return
        if not path or not os.path.exists(path):
            return

        with open(path, "rb") as f:
            file_bytes = f.read()
        task_id = paperless_service.upload_document(
            db, file_bytes, os.path.basename(path), title=f"{bank.name} statement (auto-OCR fallback)"
        )
        if not task_id:
            return
        poll_statement_ocr.delay(bank_id, task_id)
    finally:
        db.close()


@celery_app.task(name="statement_ocr.poll", bind=True, max_retries=24)
def poll_statement_ocr(self, bank_id: int, task_id: str):
    """Same backoff shape as paperless_tasks.resolve_paperless_document --
    Paperless's OCR can take well past what an HTTP request should block for."""
    from app.core.database import SessionLocal
    from app.models.models import Bank
    from app.services import paperless_service
    from app.services.pdf_parser import PDFParser
    from app.services.credit_balance_service import _upsert_credit_card_bill

    db = SessionLocal()
    try:
        document_id = paperless_service.resolve_document_id(db, task_id)
        if document_id is None:
            raise self.retry(countdown=min(10 * (self.request.retries + 1), 60))

        content = paperless_service.get_document_content(db, document_id)
        if not content:
            logger.info("Statement OCR: Paperless returned no content for document %s (bank %s)", document_id, bank_id)
            return

        bank = db.query(Bank).filter(Bank.id == bank_id).first()
        if not bank:
            return

        due_date = PDFParser.extract_due_date(content)
        statement_date = PDFParser.extract_statement_date(content)
        balance = PDFParser.extract_total_amount_due(content)

        if due_date is None and balance is None:
            logger.info("Statement OCR: still nothing found for bank %s even from Paperless's OCR", bank_id)
            return

        if due_date is not None:
            _upsert_credit_card_bill(db, bank, due_date, statement_date, balance, None)
        if balance is not None and bank.current_balance != balance and bank.balance_source != "manual":
            from app.core.time_utils import utcnow

            bank.current_balance = balance
            bank.balance_updated_at = utcnow()
            bank.balance_source = "auto"
        db.commit()
        logger.info("Statement OCR: resolved due_date=%s balance=%s for bank %s via Paperless", due_date, balance, bank_id)
    finally:
        db.close()
