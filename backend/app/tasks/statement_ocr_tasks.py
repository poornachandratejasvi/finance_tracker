"""Celery tasks: fallback statement extraction via Paperless-ngx's OCR, for a
PDF whose relevant content is rendered as a graphic rather than real text --
pdfplumber's text-layer extraction (and any regex/AI reading on top of that
same text) can never see a graphic no matter how well-tuned, but Paperless's
OCR reads the actual rendered page and does.

Entirely optional -- only runs if Paperless-ngx is configured -- and reuses
the exact same upload/poll mechanism for two different purposes, selected by
`purpose`:

- 'credit_card_bill': re-extract Total Amount Due / due date / statement date
  for the Calendar's credit-card tracking (see credit_balance_service.py).
  Confirmed real case: an ICICI statement's summary box came through as raw
  font glyph codes, not readable text, in pdfplumber's extraction.
- 'statement_transactions': a statement parsed to ZERO transactions even after
  the AI-on-text fallback (see sync.py / pdfs.py). Re-parses Paperless's OCR'd
  text with the same bank-agnostic parse_transactions_text_generic, then
  creates whatever isn't a duplicate -- reusing the exact same
  dedup/reconciliation functions (find_confirmed_match,
  create_or_reconcile_transaction, apply_auto_rules_and_notify) every other
  ingestion path already calls, just invoked directly here rather than by
  re-entering sync.py's larger PDF-processing function. A Discord notification
  summarizes what was added (and how many duplicates were skipped).
"""
import logging
import os

from app.core.celery_app import celery_app

logger = logging.getLogger(__name__)


@celery_app.task(name="statement_ocr.enqueue")
def enqueue_statement_ocr(pdf_statement_id: int, bank_id: int, user_id: int, purpose: str = "credit_card_bill"):
    """Decrypt + upload one specific statement PDF to Paperless, then hand off
    to poll_statement_ocr to wait for OCR and act on the result per `purpose`."""
    from app.core.database import SessionLocal
    from app.models.models import Bank, PDFStatement
    from app.services.password_service import get_password_candidates
    from app.services.pdf_storage import ensure_decrypted_with_candidates
    from app.services import paperless_service

    db = SessionLocal()
    try:
        bank = db.query(Bank).filter(Bank.id == bank_id).first()
        pdf = db.query(PDFStatement).filter(PDFStatement.id == pdf_statement_id).first()
        if not bank or not pdf:
            return
        candidates = get_password_candidates(db, bank)
        try:
            path, _used = ensure_decrypted_with_candidates(db, pdf, candidates)
        except Exception:
            logger.info("Statement OCR: could not decrypt PDF %s", pdf_statement_id, exc_info=True)
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
        poll_statement_ocr.delay(pdf_statement_id, bank_id, user_id, task_id, purpose)
    finally:
        db.close()


@celery_app.task(name="statement_ocr.poll", bind=True, max_retries=24)
def poll_statement_ocr(self, pdf_statement_id: int, bank_id: int, user_id: int, task_id: str, purpose: str):
    """Same backoff shape as paperless_tasks.resolve_paperless_document --
    Paperless's OCR can take well past what an HTTP request should block for."""
    from app.core.database import SessionLocal
    from app.models.models import Bank
    from app.services import paperless_service

    db = SessionLocal()
    try:
        document_id = paperless_service.resolve_document_id(db, task_id)
        if document_id is None:
            raise self.retry(countdown=min(10 * (self.request.retries + 1), 60))

        content = paperless_service.get_document_content(db, document_id)
        if not content:
            logger.info("Statement OCR: Paperless returned no content for document %s (statement %s)", document_id, pdf_statement_id)
            return

        bank = db.query(Bank).filter(Bank.id == bank_id).first()
        if not bank:
            return

        if purpose == "credit_card_bill":
            _apply_credit_card_bill_ocr(db, bank, content)
        elif purpose == "statement_transactions":
            _notify_if_transactions_found(db, bank, user_id, pdf_statement_id, content)
        else:
            logger.warning("Statement OCR: unknown purpose %r for statement %s", purpose, pdf_statement_id)
    finally:
        db.close()


def _apply_credit_card_bill_ocr(db, bank, content: str) -> None:
    from app.core.time_utils import utcnow
    from app.services.pdf_parser import PDFParser
    from app.services.credit_balance_service import _upsert_credit_card_bill

    due_date = PDFParser.extract_due_date(content)
    statement_date = PDFParser.extract_statement_date(content)
    balance = PDFParser.extract_total_amount_due(content)

    if due_date is None and balance is None:
        logger.info("Statement OCR: still nothing found for bank %s even from Paperless's OCR", bank.id)
        return

    if due_date is not None:
        _upsert_credit_card_bill(db, bank, due_date, statement_date, balance, None)
    if balance is not None and bank.current_balance != balance and bank.balance_source != "manual":
        bank.current_balance = balance
        bank.balance_updated_at = utcnow()
        bank.balance_source = "auto"
    db.commit()
    logger.info("Statement OCR: resolved due_date=%s balance=%s for bank %s via Paperless", due_date, balance, bank.id)


def _notify_if_transactions_found(db, bank, user_id: int, pdf_statement_id: int, content: str) -> None:
    """Re-parse via Paperless's OCR'd text and create whatever comes out that
    isn't a duplicate -- same dedup pipeline every other ingestion path
    (sync.py, pdfs.py) uses, just called directly rather than by re-entering
    those functions:
      - find_confirmed_match first: skip a row that's already a real,
        confirmed transaction (e.g. a bank alert/SMS already recorded the
        same purchase while this OCR pass was still pending) -- a true
        duplicate, never created.
      - create_or_reconcile_transaction for everything else: absorbs into a
        matching PENDING transaction if one exists, otherwise creates new.
    """
    from app.models.models import PDFStatement
    from app.services.pdf_parser import PDFParser
    from app.services.categorization import resolve_category
    from app.services.transaction_hooks import find_confirmed_match, create_or_reconcile_transaction, apply_auto_rules_and_notify
    from app.services import discord_service

    pdf = db.query(PDFStatement).filter(PDFStatement.id == pdf_statement_id).first()
    period = (pdf.statement_period_start, pdf.statement_period_end) if pdf else None

    try:
        rows = PDFParser.parse_transactions_text_generic(content, bank.code, period)
    except Exception:
        logger.warning("Statement OCR: text-generic parse failed for statement %s", pdf_statement_id, exc_info=True)
        return

    if not rows:
        logger.info("Statement OCR: Paperless OCR also found zero transactions for statement %s (bank %s)", pdf_statement_id, bank.id)
        return

    added = 0
    skipped_duplicates = 0
    for trans_data in rows:
        if find_confirmed_match(db, user_id, bank.id, trans_data.get("transaction_type"), trans_data.get("amount"), trans_data.get("transaction_date")):
            skipped_duplicates += 1
            continue
        if not trans_data.get("category"):
            trans_data["category"] = resolve_category(db, user_id, trans_data["description"])
        transaction, _reconciled = create_or_reconcile_transaction(
            db, user_id, bank.id, trans_data, pdf_statement_id=pdf_statement_id, source="pdf"
        )
        apply_auto_rules_and_notify(db, user_id, transaction)
        added += 1
    db.commit()

    logger.info(
        "Statement OCR: added %d transaction(s), skipped %d duplicate(s) for statement %s (bank %s)",
        added, skipped_duplicates, pdf_statement_id, bank.id,
    )
    if added == 0:
        return
    try:
        discord_service.send_discord_message(
            db, user_id,
            f"📄 {bank.name}: added {added} transaction(s) via OCR fallback",
            f"The original statement parse found none for this PDF, but Paperless's OCR of the rendered "
            f"page recovered {added} transaction(s), automatically added" +
            (f" ({skipped_duplicates} duplicate(s) skipped)" if skipped_duplicates else "") +
            f". Review statement #{pdf_statement_id} in PDFs if anything looks off.",
        )
    except Exception:
        logger.warning("Statement OCR: Discord notify failed for statement %s", pdf_statement_id, exc_info=True)
