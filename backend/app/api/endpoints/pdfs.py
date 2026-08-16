from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from sqlalchemy import func, or_
from typing import List, Optional
import os
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta
from app.core.time_utils import utcnow
from app.utils.parsing import parse_csv_list as _parse_csv_list
from pydantic import BaseModel

from app.core.database import get_db, SessionLocal
from app.core.config import settings
from app.api.endpoints.auth import get_current_active_user, require_write_access
from app.models.models import User, PDFStatement, BankEmail, Bank, GmailAccount, Transaction
from app.services.pdf_parser import PDFParser
from app.services.password_service import get_password_candidates, parse_with_passwords
from app.services.transaction_service import TransactionService
from app.services.pdf_storage import get_preferred_pdf_path, ensure_decrypted_with_candidates, ensure_decrypted_pdf
from app.services.balance_service import apply_statement_balance
from app.services import ai_transaction_extraction, reward_points_service, investment_service
from app.services.transaction_hooks import apply_auto_rules_and_notify, create_or_reconcile_transaction
import logging

router = APIRouter()
logger = logging.getLogger(__name__)


class PdfCleanupRequest(BaseModel):
    max_age_days: int
    bank_id: Optional[int] = None
    delete_transactions: bool = True
    dry_run: bool = False


class PdfResetRequest(BaseModel):
    bank_id: Optional[int] = None
    delete_transactions: bool = True
    delete_emails: bool = True


class PdfRemapRequest(BaseModel):
    pdf_ids: List[int]
    bank_id: int


def _parse_bool_list(value) -> List[bool]:
    result = []
    for item in _parse_csv_list(value, str):
        normalized = item.lower()
        if normalized in {"true", "1", "yes"}:
            result.append(True)
        elif normalized in {"false", "0", "no"}:
            result.append(False)
    return result


_PDF_SORT_FIELDS = (
    "id", "bank_name", "from_email", "file_name",
    "statement_period_start", "statement_period_end",
    "transaction_count", "is_processed", "created_at", "email_received_date",
)


@router.get("/")
def get_pdfs(
    bank_id: Optional[str] = None,
    is_processed: Optional[str] = None,
    from_email: Optional[str] = None,
    skip: int = 0,
    limit: int = 100,
    sort_by: str = Query("id", pattern="^(" + "|".join(_PDF_SORT_FIELDS) + ")$"),
    sort_dir: str = Query("desc", pattern="^(asc|desc)$"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    """Get list of PDF statements with details, sortable on any column (including
    the computed bank_name/transaction_count, which aren't real DB columns — the
    per-user PDF count is small enough that sorting/paginating in Python here is
    simpler and just as fast as pushing a partial sort into SQL)."""
    # Get user's Gmail accounts
    gmail_accounts = db.query(GmailAccount).filter(
        GmailAccount.user_id == current_user.id
    ).all()
    gmail_account_ids = [ga.id for ga in gmail_accounts]

    # Get bank emails
    query = db.query(BankEmail).filter(
        BankEmail.gmail_account_id.in_(gmail_account_ids)
    )
    bank_ids = _parse_csv_list(bank_id, int)
    if bank_ids:
        query = query.filter(BankEmail.bank_id.in_(bank_ids))
    if from_email:
        query = query.filter(BankEmail.from_email.ilike(f"%{from_email}%"))

    bank_email_map = {be.id: be for be in query.all()}
    bank_email_ids = list(bank_email_map.keys())

    # Get PDFs
    pdf_query = db.query(PDFStatement).filter(
        PDFStatement.bank_email_id.in_(bank_email_ids)
    )

    processed_filters = _parse_bool_list(is_processed)
    if processed_filters:
        pdf_query = pdf_query.filter(PDFStatement.is_processed.in_(processed_filters))

    all_pdfs = pdf_query.order_by(PDFStatement.id.desc()).all()

    # Build response with bank info (batch-load banks + transaction counts to avoid N+1)
    bank_ids_needed = {bank_email_map[pdf.bank_email_id].bank_id
                       for pdf in all_pdfs if pdf.bank_email_id in bank_email_map}
    banks_by_id = {b.id: b for b in db.query(Bank).filter(Bank.id.in_(bank_ids_needed)).all()}

    pdf_ids = [p.id for p in all_pdfs]
    tx_counts = dict(
        db.query(Transaction.pdf_statement_id, func.count(Transaction.id))
        .filter(Transaction.pdf_statement_id.in_(pdf_ids))
        .group_by(Transaction.pdf_statement_id)
        .all()
    ) if pdf_ids else {}

    items = []
    for pdf in all_pdfs:
        bank_email = bank_email_map.get(pdf.bank_email_id)
        bank = banks_by_id.get(bank_email.bank_id) if bank_email else None

        items.append({
            "id": pdf.id,
            "file_name": pdf.file_name,
            "file_path": pdf.file_path,
            "decrypted_available": bool(pdf.decrypted_path and os.path.exists(pdf.decrypted_path)),
            "is_processed": pdf.is_processed,
            "error_message": pdf.error_message,
            "is_password_protected": pdf.is_password_protected,
            "statement_period_start": pdf.statement_period_start,
            "statement_period_end": pdf.statement_period_end,
            "created_at": pdf.created_at,
            "bank_name": bank.name if bank else None,
            "bank_id": bank.id if bank else None,
            "from_email": bank_email.from_email if bank_email else None,
            "email_subject": bank_email.subject if bank_email else None,
            "email_received_date": bank_email.received_date if bank_email else None,
            "transaction_count": tx_counts.get(pdf.id, 0),
        })

    # Sort with nulls always last (regardless of direction) — a missing bank_name or
    # statement_period shouldn't jump to the top just because the direction flipped.
    def _key(it):
        v = it.get(sort_by)
        return v.lower() if isinstance(v, str) else v

    reverse = sort_dir == "desc"
    with_value = [it for it in items if it.get(sort_by) is not None]
    without_value = [it for it in items if it.get(sort_by) is None]
    with_value.sort(key=_key, reverse=reverse)
    items = with_value + without_value

    total = len(items)
    page_items = items[skip: skip + limit]

    return {
        "items": page_items,
        "total": total,
        "skip": skip,
        "limit": limit
    }


@router.get("/{pdf_id}/download")
def download_pdf(
    pdf_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    """Download a PDF file"""
    # Get PDF
    pdf = db.query(PDFStatement).filter(PDFStatement.id == pdf_id).first()
    if not pdf:
        raise HTTPException(status_code=404, detail="PDF not found")
    
    # Verify user has access
    bank_email = db.query(BankEmail).filter(BankEmail.id == pdf.bank_email_id).first()
    if not bank_email:
        raise HTTPException(status_code=404, detail="Bank email not found")
    
    gmail_account = db.query(GmailAccount).filter(
        GmailAccount.id == bank_email.gmail_account_id,
        GmailAccount.user_id == current_user.id
    ).first()
    
    if not gmail_account:
        raise HTTPException(status_code=403, detail="Access denied")
    
    # Check if file exists
    preferred_path = get_preferred_pdf_path(pdf)
    if pdf.is_password_protected and (not preferred_path or not os.path.exists(preferred_path)):
        bank = db.query(Bank).filter(Bank.id == bank_email.bank_id).first()
        if bank:
            candidates = get_password_candidates(db, bank)
            preferred_path, used_password = ensure_decrypted_with_candidates(db, pdf, candidates)
            if used_password and used_password != bank.account_password:
                bank.account_password = used_password
                db.commit()

    if not preferred_path or not os.path.exists(preferred_path):
        raise HTTPException(status_code=404, detail="PDF file not found on disk")
    
    return FileResponse(
        preferred_path,
        media_type='application/pdf',
        filename=pdf.file_name
    )


@router.get("/{pdf_id}/fields")
def get_pdf_fields(
    pdf_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    """Extract detected column headers from a PDF statement."""
    pdf = db.query(PDFStatement).filter(PDFStatement.id == pdf_id).first()
    if not pdf:
        raise HTTPException(status_code=404, detail="PDF not found")

    bank_email = db.query(BankEmail).filter(BankEmail.id == pdf.bank_email_id).first()
    if not bank_email:
        raise HTTPException(status_code=404, detail="Bank email not found")

    gmail_account = db.query(GmailAccount).filter(
        GmailAccount.id == bank_email.gmail_account_id,
        GmailAccount.user_id == current_user.id
    ).first()
    if not gmail_account:
        raise HTTPException(status_code=403, detail="Access denied")

    preferred_path = get_preferred_pdf_path(pdf)
    password_for_tables = None
    if pdf.is_password_protected and (not preferred_path or not os.path.exists(preferred_path)):
        bank = db.query(Bank).filter(Bank.id == bank_email.bank_id).first()
        if bank:
            candidates = get_password_candidates(db, bank)
            preferred_path, used_password = ensure_decrypted_with_candidates(db, pdf, candidates)
            if used_password:
                password_for_tables = used_password
                if used_password != bank.account_password:
                    bank.account_password = used_password
                    db.commit()
            elif bank.account_password:
                password_for_tables = bank.account_password
                from app.services.pdf_storage import ensure_decrypted_pdf
                ensure_decrypted_pdf(db, pdf, bank.account_password)

    if not preferred_path or not os.path.exists(preferred_path):
        if password_for_tables:
            tables = PDFParser.extract_tables(pdf.file_path, password_for_tables)
        else:
            raise HTTPException(status_code=404, detail="PDF file not found on disk")
    else:
        tables = PDFParser.extract_tables(preferred_path)
    detected_columns = []
    seen = set()
    for table in tables:
        for col in list(table.columns):
            col_name = str(col).strip()
            if not col_name or col_name.lower() == 'nan':
                continue
            if col_name in seen:
                continue
            seen.add(col_name)
            detected_columns.append(col_name)

    if not detected_columns:
        bank = db.query(Bank).filter(Bank.id == bank_email.bank_id).first()
        if bank and bank.field_mapping:
            import json
            mapping = json.loads(bank.field_mapping)
            for value in mapping.values():
                if isinstance(value, str) and value and value not in seen:
                    seen.add(value)
                    detected_columns.append(value)

    return {
        "pdf_id": pdf.id,
        "file_name": pdf.file_name,
        "detected_columns": detected_columns
    }


@router.post("/decrypt-all")
def decrypt_all_pdfs(
    bank_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_write_access)
):
    """Create decrypted copies for all protected PDFs (optionally filtered by bank)."""
    gmail_accounts = db.query(GmailAccount).filter(
        GmailAccount.user_id == current_user.id
    ).all()
    gmail_account_ids = [ga.id for ga in gmail_accounts]

    bank_email_query = db.query(BankEmail).filter(
        BankEmail.gmail_account_id.in_(gmail_account_ids)
    )
    if bank_id:
        bank_email_query = bank_email_query.filter(BankEmail.bank_id == bank_id)

    bank_email_ids = [be.id for be in bank_email_query.all()]
    pdfs = db.query(PDFStatement).filter(
        PDFStatement.bank_email_id.in_(bank_email_ids)
    ).all()

    decrypted = 0
    skipped = 0
    for pdf in pdfs:
        if not pdf.is_password_protected:
            skipped += 1
            continue

        bank_email = db.query(BankEmail).filter(BankEmail.id == pdf.bank_email_id).first()
        if not bank_email:
            skipped += 1
            continue

        bank = db.query(Bank).filter(Bank.id == bank_email.bank_id).first()
        if not bank:
            skipped += 1
            continue

        if pdf.decrypted_path and os.path.exists(pdf.decrypted_path):
            skipped += 1
            continue

        candidates = get_password_candidates(db, bank)
        decrypted_path, used_password = ensure_decrypted_with_candidates(db, pdf, candidates)
        if used_password and used_password != bank.account_password:
            bank.account_password = used_password
            db.commit()
        if decrypted_path:
            decrypted += 1
            # This endpoint only decrypts -- it never runs the normal parse/
            # reconcile pipeline, so an investment-linked "bank" (e.g. a CDSL
            # CAS statement) would otherwise sit decrypted forever without
            # its holdings ever reconciled. Every other PDF-processing path
            # (reprocess, sync, manual upload) already calls this; mirror it
            # here so bulk password-retry doesn't leave CAS data stale.
            if bank.bank_type == "investment":
                try:
                    text = PDFParser.extract_text(decrypted_path)
                    investment_service.record_cas_statement(db, bank, text, bank_email.received_date)
                    pdf.is_processed = True
                    db.commit()
                except Exception:
                    logger.warning("CAS extraction failed for bank %s", bank.id, exc_info=True)
        else:
            skipped += 1

    return {"success": True, "decrypted": decrypted, "skipped": skipped}


@router.post("/reset")
def reset_pdfs(
    payload: PdfResetRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_write_access)
):
    """Delete PDFs and related data for the user (optionally filtered by bank)."""
    gmail_accounts = db.query(GmailAccount).filter(
        GmailAccount.user_id == current_user.id
    ).all()
    gmail_account_ids = [ga.id for ga in gmail_accounts]

    bank_email_query = db.query(BankEmail).filter(
        BankEmail.gmail_account_id.in_(gmail_account_ids)
    )
    if payload.bank_id:
        bank_email_query = bank_email_query.filter(BankEmail.bank_id == payload.bank_id)

    bank_emails = bank_email_query.all()
    bank_email_ids = [be.id for be in bank_emails]

    pdfs = db.query(PDFStatement).filter(
        PDFStatement.bank_email_id.in_(bank_email_ids)
    ).all()

    deleted_pdfs = 0
    deleted_transactions = 0
    for pdf in pdfs:
        if payload.delete_transactions:
            deleted_transactions += db.query(Transaction).filter(
                Transaction.pdf_statement_id == pdf.id
            ).delete()

        if pdf.file_path and os.path.exists(pdf.file_path):
            try:
                os.remove(pdf.file_path)
            except Exception:
                pass
        if pdf.decrypted_path and os.path.exists(pdf.decrypted_path):
            try:
                os.remove(pdf.decrypted_path)
            except Exception:
                pass

        db.delete(pdf)
        deleted_pdfs += 1

    deleted_emails = 0
    if payload.delete_emails:
        for bank_email in bank_emails:
            db.delete(bank_email)
            deleted_emails += 1

    db.commit()

    return {
        "success": True,
        "deleted_pdfs": deleted_pdfs,
        "deleted_transactions": deleted_transactions,
        "deleted_emails": deleted_emails
    }


@router.post("/{pdf_id}/reprocess")
def reprocess_pdf(
    pdf_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_write_access)
):
    """Reprocess a single PDF"""
    # Get PDF
    pdf = db.query(PDFStatement).filter(PDFStatement.id == pdf_id).first()
    if not pdf:
        raise HTTPException(status_code=404, detail="PDF not found")
    
    # Verify user has access
    bank_email = db.query(BankEmail).filter(BankEmail.id == pdf.bank_email_id).first()
    if not bank_email:
        raise HTTPException(status_code=404, detail="Bank email not found")
    
    gmail_account = db.query(GmailAccount).filter(
        GmailAccount.id == bank_email.gmail_account_id,
        GmailAccount.user_id == current_user.id
    ).first()
    
    if not gmail_account:
        raise HTTPException(status_code=403, detail="Access denied")
    
    bank = db.query(Bank).filter(Bank.id == bank_email.bank_id).first()
    if not bank:
        raise HTTPException(status_code=404, detail="Bank not found")

    import json
    field_mapping = json.loads(bank.field_mapping) if bank.field_mapping else None
    
    try:
        preferred_path = get_preferred_pdf_path(pdf)
        # For password-protected PDFs, only skip candidates if a decrypted copy exists on disk
        has_decrypted_copy = bool(pdf.decrypted_path and os.path.exists(pdf.decrypted_path))
        # Parse PDF with password candidates if needed
        if pdf.is_password_protected and not has_decrypted_copy:
            candidates = get_password_candidates(db, bank)
            parse_result, used_password = parse_with_passwords(
                pdf_path=pdf.file_path,
                bank_code=bank.code,
                passwords=candidates,
                field_mapping=field_mapping
            )
            if parse_result.get('success') and used_password and used_password != bank.account_password:
                bank.account_password = used_password
                db.commit()
            ensure_decrypted_with_candidates(db, pdf, candidates)
            if used_password:
                from app.services.pdf_storage import ensure_decrypted_pdf
                ensure_decrypted_pdf(db, pdf, used_password)
        else:
            parse_result = PDFParser.parse_statement(
                pdf_path=preferred_path or pdf.file_path,
                bank_code=bank.code,
                password=None,
                field_mapping=field_mapping
            )
            # If parsing the decrypted/plain copy fails, fall back to trying candidates
            if not parse_result.get('success') and pdf.is_password_protected:
                candidates = get_password_candidates(db, bank)
                if candidates:
                    parse_result, used_password = parse_with_passwords(
                        pdf_path=pdf.file_path,
                        bank_code=bank.code,
                        passwords=candidates,
                        field_mapping=field_mapping
                    )
                    if parse_result.get('success') and used_password and used_password != bank.account_password:
                        bank.account_password = used_password
                        db.commit()
        
        if not parse_result['success']:
            detail = parse_result.get('error', 'Unknown error')
            if pdf.is_password_protected:
                detail = f"Failed to parse PDF: {detail}. Update bank password candidates and retry."
            pdf.error_message = detail[:1000]
            db.commit()
            raise HTTPException(status_code=400, detail=detail)

        # Delete existing transactions from this PDF only after successful parse
        deleted_count = db.query(Transaction).filter(
            Transaction.pdf_statement_id == pdf.id
        ).delete()

        # Update statement period
        pdf.statement_period_start = parse_result['statement_period']['start']
        pdf.statement_period_end = parse_result['statement_period']['end']
        pdf.is_processed = True
        pdf.error_message = None  # clear any prior failure

        # Investment-linked "banks" (e.g. a CDSL CAS statement) aren't real
        # accounts -- never let the AI fallback hallucinate "transactions"
        # out of a holdings table; see investment_service.record_cas_statement.
        if bank.bank_type == "investment":
            parse_result["transactions"] = []
        else:
            # Parser found nothing at all — try the AI fallback before giving up.
            ai_transaction_extraction.fill_missing_transactions(db, current_user.id, parse_result)

        # Add transactions
        transactions_added = 0
        for trans_data in parse_result['transactions']:
            # Auto-categorize
            if not trans_data.get('category'):
                trans_data['category'] = TransactionService.categorize_transaction(
                    trans_data['description']
                )

            transaction, _reconciled = create_or_reconcile_transaction(
                db, current_user.id, bank.id, trans_data, pdf_statement_id=pdf.id
            )
            apply_auto_rules_and_notify(db, current_user.id, transaction)
            transactions_added += 1

        if pdf.is_password_protected and bank.account_password:
            from app.services.pdf_storage import ensure_decrypted_pdf
            ensure_decrypted_pdf(db, pdf, bank.account_password)
        apply_statement_balance(
            bank, parse_result, fallback_date=bank_email.received_date,
            ai_context={"db": db, "user_id": current_user.id},
        )
        try:
            reward_points_service.record_statement_reward_points(
                db, bank, pdf.id, parse_result.get("_raw_text"),
                bank_email.received_date, ai_context={"db": db, "user_id": current_user.id},
            )
        except Exception:
            logger.warning("Reward-points extraction failed for bank %s", bank.id, exc_info=True)
        try:
            investment_service.record_ppf_statement(db, bank, parse_result.get("_raw_text"), bank_email.received_date)
        except Exception:
            logger.warning("PPF extraction failed for bank %s", bank.id, exc_info=True)
        try:
            investment_service.record_cas_statement(db, bank, parse_result.get("_raw_text"), bank_email.received_date)
        except Exception:
            logger.warning("CAS extraction failed for bank %s", bank.id, exc_info=True)

        db.commit()

        return {
            "success": True,
            "pdf_id": pdf.id,
            "file_name": pdf.file_name,
            "transactions_deleted": deleted_count,
            "transactions_added": transactions_added,
            "statement_period": parse_result['statement_period']
        }
        
    except HTTPException:
        # Preserve the intended status (e.g. 400 password error) — don't mask as 500.
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"Error reprocessing PDF {pdf_id}: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


def _reprocess_pdf_worker(pdf_id: int, user_id: int) -> dict:
    db = SessionLocal()
    try:
        pdf = db.query(PDFStatement).filter(PDFStatement.id == pdf_id).first()
        if not pdf:
            return {"pdf_id": pdf_id, "success": False, "error": "PDF not found"}

        bank_email = db.query(BankEmail).filter(BankEmail.id == pdf.bank_email_id).first()
        if not bank_email:
            return {"pdf_id": pdf_id, "success": False, "error": "Bank email not found"}

        gmail_account = db.query(GmailAccount).filter(
            GmailAccount.id == bank_email.gmail_account_id,
            GmailAccount.user_id == user_id
        ).first()
        if not gmail_account:
            return {"pdf_id": pdf_id, "success": False, "error": "Access denied"}

        bank = db.query(Bank).filter(Bank.id == bank_email.bank_id).first()
        if not bank:
            return {"pdf_id": pdf_id, "success": False, "error": "Bank not found"}

        import json
        field_mapping = json.loads(bank.field_mapping) if bank.field_mapping else None

        preferred_path = get_preferred_pdf_path(pdf)
        # For password-protected PDFs, only skip candidates if a decrypted copy exists on disk
        has_decrypted_copy = bool(pdf.decrypted_path and os.path.exists(pdf.decrypted_path))
        if pdf.is_password_protected and not has_decrypted_copy:
            candidates = get_password_candidates(db, bank)
            parse_result, used_password = parse_with_passwords(
                pdf_path=pdf.file_path,
                bank_code=bank.code,
                passwords=candidates,
                field_mapping=field_mapping
            )
            if parse_result.get('success') and used_password and used_password != bank.account_password:
                bank.account_password = used_password
                db.commit()
            ensure_decrypted_with_candidates(db, pdf, candidates)
            if used_password:
                from app.services.pdf_storage import ensure_decrypted_pdf
                ensure_decrypted_pdf(db, pdf, used_password)
        else:
            parse_result = PDFParser.parse_statement(
                pdf_path=preferred_path or pdf.file_path,
                bank_code=bank.code,
                password=None,
                field_mapping=field_mapping
            )
            # If parsing the decrypted/plain copy fails, fall back to trying candidates
            if not parse_result.get('success') and pdf.is_password_protected:
                candidates = get_password_candidates(db, bank)
                if candidates:
                    parse_result, used_password = parse_with_passwords(
                        pdf_path=pdf.file_path,
                        bank_code=bank.code,
                        passwords=candidates,
                        field_mapping=field_mapping
                    )
                    if parse_result.get('success') and used_password and used_password != bank.account_password:
                        bank.account_password = used_password
                        db.commit()

        if not parse_result.get('success'):
            err = parse_result.get('error', 'Unknown error')
            pdf.error_message = str(err)[:1000]
            db.commit()
            return {"pdf_id": pdf_id, "success": False, "error": err}

        deleted_count = db.query(Transaction).filter(
            Transaction.pdf_statement_id == pdf.id
        ).delete()

        pdf.statement_period_start = parse_result['statement_period']['start']
        pdf.statement_period_end = parse_result['statement_period']['end']
        pdf.is_processed = True
        pdf.error_message = None

        if bank.bank_type == "investment":
            parse_result["transactions"] = []
        else:
            # Parser found nothing at all — try the AI fallback before giving up.
            ai_transaction_extraction.fill_missing_transactions(db, user_id, parse_result)

        transactions_added = 0
        for trans_data in parse_result['transactions']:
            if not trans_data.get('category'):
                trans_data['category'] = TransactionService.categorize_transaction(
                    trans_data['description']
                )
            transaction, _reconciled = create_or_reconcile_transaction(
                db, user_id, bank.id, trans_data, pdf_statement_id=pdf.id
            )
            apply_auto_rules_and_notify(db, user_id, transaction)
            transactions_added += 1

        if pdf.is_password_protected and bank.account_password:
            from app.services.pdf_storage import ensure_decrypted_pdf
            ensure_decrypted_pdf(db, pdf, bank.account_password)
        apply_statement_balance(
            bank, parse_result, fallback_date=bank_email.received_date,
            ai_context={"db": db, "user_id": user_id},
        )
        try:
            reward_points_service.record_statement_reward_points(
                db, bank, pdf.id, parse_result.get("_raw_text"),
                bank_email.received_date, ai_context={"db": db, "user_id": user_id},
            )
        except Exception:
            logger.warning("Reward-points extraction failed for bank %s", bank.id, exc_info=True)
        try:
            investment_service.record_ppf_statement(db, bank, parse_result.get("_raw_text"), bank_email.received_date)
        except Exception:
            logger.warning("PPF extraction failed for bank %s", bank.id, exc_info=True)
        try:
            investment_service.record_cas_statement(db, bank, parse_result.get("_raw_text"), bank_email.received_date)
        except Exception:
            logger.warning("CAS extraction failed for bank %s", bank.id, exc_info=True)
        db.commit()

        return {
            "pdf_id": pdf.id,
            "success": True,
            "transactions_deleted": deleted_count,
            "transactions_added": transactions_added,
        }
    except Exception as exc:
        db.rollback()
        return {"pdf_id": pdf_id, "success": False, "error": str(exc)}
    finally:
        db.close()


@router.post("/reprocess-all")
def reprocess_all_pdfs(
    bank_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_write_access)
):
    """Reprocess all PDFs for the current user (optionally filtered by bank)."""
    gmail_accounts = db.query(GmailAccount).filter(
        GmailAccount.user_id == current_user.id
    ).all()
    gmail_account_ids = [ga.id for ga in gmail_accounts]

    bank_email_query = db.query(BankEmail).filter(
        BankEmail.gmail_account_id.in_(gmail_account_ids)
    )
    if bank_id:
        bank_email_query = bank_email_query.filter(BankEmail.bank_id == bank_id)

    bank_email_ids = [be.id for be in bank_email_query.all()]
    pdfs = db.query(PDFStatement).filter(
        PDFStatement.bank_email_id.in_(bank_email_ids)
    ).all()

    if not pdfs:
        return {"success": True, "processed": 0, "errors": []}

    results = []
    errors = []
    max_workers = max(1, settings.MAX_WORKERS)
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = [executor.submit(_reprocess_pdf_worker, pdf.id, current_user.id) for pdf in pdfs]
        for future in as_completed(futures):
            result = future.result()
            results.append(result)
            if not result.get("success"):
                errors.append(result)

    return {
        "success": len(errors) == 0,
        "processed": len(results),
        "errors": errors
    }


@router.post("/reassign-banks")
def reassign_pdf_banks(
    bank_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_write_access)
):
    """Re-detect bank for PDFs and update bank association when mismatched."""
    gmail_accounts = db.query(GmailAccount).filter(
        GmailAccount.user_id == current_user.id
    ).all()
    gmail_account_ids = [ga.id for ga in gmail_accounts]

    bank_email_query = db.query(BankEmail).filter(
        BankEmail.gmail_account_id.in_(gmail_account_ids)
    )
    if bank_id:
        bank_email_query = bank_email_query.filter(BankEmail.bank_id == bank_id)

    bank_email_ids = [be.id for be in bank_email_query.all()]
    pdfs = db.query(PDFStatement).filter(
        PDFStatement.bank_email_id.in_(bank_email_ids)
    ).all()

    if not pdfs:
        return {"success": True, "updated": 0, "checked": 0, "skipped": 0}

    banks = db.query(Bank).filter(
        Bank.user_id == current_user.id
    ).all()
    bank_by_code = {str(b.code).strip().lower(): b for b in banks if b.code}

    updated = 0
    skipped = 0
    for pdf in pdfs:
        bank_email = db.query(BankEmail).filter(BankEmail.id == pdf.bank_email_id).first()
        if not bank_email:
            skipped += 1
            continue

        current_bank = db.query(Bank).filter(Bank.id == bank_email.bank_id).first()
        if not current_bank:
            skipped += 1
            continue

        preferred_path = get_preferred_pdf_path(pdf)
        pdf_text = ""
        if pdf.is_password_protected and (not preferred_path or not os.path.exists(preferred_path)):
            candidates = get_password_candidates(db, current_bank)
            preferred_path, used_password = ensure_decrypted_with_candidates(db, pdf, candidates)
            if used_password:
                ensure_decrypted_pdf(db, pdf, used_password)
                if used_password != current_bank.account_password:
                    current_bank.account_password = used_password
                    db.commit()
            if preferred_path and os.path.exists(preferred_path):
                pdf_text = PDFParser.extract_text(preferred_path, None)
            elif used_password:
                pdf_text = PDFParser.extract_text(pdf.file_path, used_password)
        else:
            pdf_text = PDFParser.extract_text(preferred_path or pdf.file_path, None)

        if not pdf_text:
            skipped += 1
            continue

        detected_code = PDFParser.detect_bank(pdf_text)
        if not detected_code:
            skipped += 1
            continue

        target_bank = bank_by_code.get(str(detected_code).lower())
        if not target_bank:
            for bank in banks:
                if bank.name and detected_code.lower() in bank.name.lower():
                    target_bank = bank
                    break
                if detected_code.upper() == 'BOB' and bank.name and 'baroda' in bank.name.lower():
                    target_bank = bank
                    break

        if target_bank and target_bank.id != bank_email.bank_id:
            logger.info(
                "Reassigned PDF %s from bank_id=%s to bank_id=%s",
                pdf.id,
                bank_email.bank_id,
                target_bank.id
            )
            bank_email.bank_id = target_bank.id
            updated += 1

    db.commit()

    return {
        "success": True,
        "updated": updated,
        "checked": len(pdfs),
        "skipped": skipped
    }


@router.post("/remap-bank")
def remap_pdf_bank(
    payload: PdfRemapRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_write_access)
):
    if not payload.pdf_ids:
        raise HTTPException(status_code=400, detail="No PDFs selected")

    target_bank = db.query(Bank).filter(
        Bank.id == payload.bank_id,
        Bank.user_id == current_user.id
    ).first()
    if not target_bank:
        raise HTTPException(status_code=404, detail="Target bank not found")

    pdfs = db.query(PDFStatement).filter(
        PDFStatement.id.in_(payload.pdf_ids)
    ).all()

    updated = 0
    skipped = 0
    for pdf in pdfs:
        bank_email = db.query(BankEmail).filter(BankEmail.id == pdf.bank_email_id).first()
        if not bank_email:
            skipped += 1
            continue

        gmail_account = db.query(GmailAccount).filter(
            GmailAccount.id == bank_email.gmail_account_id,
            GmailAccount.user_id == current_user.id
        ).first()
        if not gmail_account:
            skipped += 1
            continue

        if bank_email.bank_id == target_bank.id:
            skipped += 1
            continue

        logger.info(
            "Remapping PDF %s from bank_id=%s to bank_id=%s",
            pdf.id,
            bank_email.bank_id,
            target_bank.id
        )
        bank_email.bank_id = target_bank.id
        db.query(Transaction).filter(
            Transaction.pdf_statement_id == pdf.id
        ).update({Transaction.bank_id: target_bank.id}, synchronize_session=False)
        updated += 1

    db.commit()

    return {
        "success": True,
        "updated": updated,
        "skipped": skipped
    }


class PdfDeleteBySenderRequest(BaseModel):
    from_email: str
    bank_id: Optional[int] = None
    delete_transactions: bool = True


@router.post("/delete-by-sender")
def delete_pdfs_by_sender(
    payload: PdfDeleteBySenderRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_write_access)
):
    """Delete all PDFs and optionally their transactions for a given sender email."""
    if not payload.from_email or not payload.from_email.strip():
        raise HTTPException(status_code=400, detail="from_email is required")

    gmail_accounts = db.query(GmailAccount).filter(
        GmailAccount.user_id == current_user.id
    ).all()
    gmail_account_ids = [ga.id for ga in gmail_accounts]

    be_query = db.query(BankEmail).filter(
        BankEmail.gmail_account_id.in_(gmail_account_ids),
        BankEmail.from_email.ilike(f"%{payload.from_email.strip()}%")
    )
    if payload.bank_id:
        be_query = be_query.filter(BankEmail.bank_id == payload.bank_id)

    bank_emails = be_query.all()
    bank_email_ids = [be.id for be in bank_emails]

    if not bank_email_ids:
        return {"success": True, "deleted_pdfs": 0, "deleted_transactions": 0}

    pdfs = db.query(PDFStatement).filter(
        PDFStatement.bank_email_id.in_(bank_email_ids)
    ).all()

    deleted_pdfs = 0
    deleted_transactions = 0
    for pdf in pdfs:
        if payload.delete_transactions:
            cnt = db.query(Transaction).filter(
                Transaction.pdf_statement_id == pdf.id
            ).delete(synchronize_session=False)
            deleted_transactions += cnt
        # Remove files from disk
        for path in [pdf.file_path, pdf.decrypted_path]:
            if path and os.path.exists(path):
                try:
                    os.remove(path)
                except OSError:
                    pass
        db.delete(pdf)
        deleted_pdfs += 1

    # Mark bank_emails as unprocessed so they re-sync next time
    for be in bank_emails:
        be.is_processed = False

    db.commit()
    logger.info(
        "delete-by-sender: email=%s deleted_pdfs=%s deleted_tx=%s",
        payload.from_email, deleted_pdfs, deleted_transactions
    )
    return {
        "success": True,
        "deleted_pdfs": deleted_pdfs,
        "deleted_transactions": deleted_transactions
    }


@router.post("/cleanup")
def cleanup_pdfs(
    payload: PdfCleanupRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_write_access)
):
    cutoff = utcnow() - timedelta(days=payload.max_age_days)
    gmail_accounts = db.query(GmailAccount).filter(
        GmailAccount.user_id == current_user.id
    ).all()
    gmail_account_ids = [ga.id for ga in gmail_accounts]

    bank_email_query = db.query(BankEmail).filter(
        BankEmail.gmail_account_id.in_(gmail_account_ids)
    )
    if payload.bank_id:
        bank_email_query = bank_email_query.filter(BankEmail.bank_id == payload.bank_id)

    bank_email_ids = [be.id for be in bank_email_query.all()]
    pdfs = db.query(PDFStatement).filter(
        PDFStatement.bank_email_id.in_(bank_email_ids),
        PDFStatement.created_at < cutoff
    ).all()

    deleted = []
    for pdf in pdfs:
        if not payload.dry_run:
            if payload.delete_transactions:
                db.query(Transaction).filter(Transaction.pdf_statement_id == pdf.id).delete()
            if pdf.file_path and os.path.exists(pdf.file_path):
                os.remove(pdf.file_path)
            if pdf.decrypted_path and os.path.exists(pdf.decrypted_path):
                os.remove(pdf.decrypted_path)
            db.delete(pdf)
        deleted.append(pdf.id)

    if not payload.dry_run:
        db.commit()

    return {"success": True, "deleted_pdf_ids": deleted}


@router.get("/stats")
def get_pdf_stats(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    """Get PDF statistics by bank"""
    # Get user's Gmail accounts
    gmail_accounts = db.query(GmailAccount).filter(
        GmailAccount.user_id == current_user.id
    ).all()
    gmail_account_ids = [ga.id for ga in gmail_accounts]
    
    # Get banks with PDF counts
    banks = db.query(Bank).all()
    stats = []
    
    for bank in banks:
        # Get bank emails for this bank
        bank_emails = db.query(BankEmail).filter(
            BankEmail.bank_id == bank.id,
            BankEmail.gmail_account_id.in_(gmail_account_ids)
        ).all()
        
        if not bank_emails:
            continue
        
        bank_email_ids = [be.id for be in bank_emails]
        
        # Count PDFs
        total_pdfs = db.query(PDFStatement).filter(
            PDFStatement.bank_email_id.in_(bank_email_ids)
        ).count()
        
        processed_pdfs = db.query(PDFStatement).filter(
            PDFStatement.bank_email_id.in_(bank_email_ids),
            PDFStatement.is_processed == True
        ).count()
        
        # Get date range
        date_range = db.query(
            func.min(PDFStatement.statement_period_start),
            func.max(PDFStatement.statement_period_end)
        ).filter(
            PDFStatement.bank_email_id.in_(bank_email_ids),
            PDFStatement.is_processed == True
        ).first()
        
        stats.append({
            "bank_id": bank.id,
            "bank_name": bank.name,
            "total_pdfs": total_pdfs,
            "processed_pdfs": processed_pdfs,
            "unprocessed_pdfs": total_pdfs - processed_pdfs,
            "period_start": date_range[0] if date_range else None,
            "period_end": date_range[1] if date_range else None
        })
    
    return {
        "stats": stats
    }
