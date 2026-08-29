from fastapi import APIRouter, Depends, HTTPException, status, Query, UploadFile, File, BackgroundTasks
from sqlalchemy.orm import Session
from sqlalchemy import or_
from typing import List, Optional
import os
import logging
from datetime import datetime
from uuid import uuid4

from app.core.database import get_db
from app.core.config import settings
from app.core.time_utils import utcnow
from app.api.endpoints.auth import get_current_active_user, require_write_access
from app.models.models import User, Bank, BankConfig, GmailAccount, BankEmail, PDFStatement, Transaction
from app.schemas.bank import (
    BankCreate,
    BankUpdate,
    BankResponse,
    BankConfigCreate,
    BankConfigUpdate,
    BankConfigResponse,
)
from app.services.pdf_parser import PDFParser
from app.services.transaction_service import TransactionService
from app.services.password_service import get_password_candidates, save_password_candidates
from app.services.pdf_storage import ensure_decrypted_pdf
from app.services.balance_service import apply_statement_balance, recompute_all_balances
from app.services.credit_balance_service import redetect_all_credit_balances
from app.services import ai_transaction_extraction, reward_points_service, investment_service
from app.services.transaction_hooks import apply_auto_rules_and_notify, create_or_reconcile_transaction
from app.core.household import visible_user_ids

logger = logging.getLogger(__name__)

from pydantic import BaseModel

router = APIRouter()


@router.get("/", response_model=List[BankResponse])
def list_banks(
    skip: int = Query(0, ge=0),
    limit: int = Query(50, le=100),
    is_active: Optional[bool] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    """List all banks visible to the caller — their own, or their whole
    household's if they're an admin (see app.core.household.visible_user_ids)."""
    household_ids = visible_user_ids(db, current_user)
    query = db.query(Bank).filter(
        Bank.user_id.in_(household_ids)
    )

    if is_active is not None:
        query = query.filter(Bank.is_active == is_active)

    banks = query.offset(skip).limit(limit).all()

    # Attach "last synced" per bank = most recent statement-email pulled for it.
    from sqlalchemy import func, case
    from app.models.models import TransactionType
    bank_ids = [b.id for b in banks]
    if bank_ids:
        rows = (
            db.query(BankEmail.bank_id, func.max(BankEmail.created_at))
            .filter(BankEmail.bank_id.in_(bank_ids))
            .group_by(BankEmail.bank_id)
            .all()
        )
        last_map = {bid: dt for bid, dt in rows}

        # Per-bank net from transactions, so credit cards that never stored a
        # statement balance still show an owed amount. For a credit card,
        # owed = sum(debits) - sum(credits); we expose it as computed_balance and
        # let the client render it negative/red.
        debit_sum = func.sum(case((Transaction.transaction_type == TransactionType.DEBIT, Transaction.amount), else_=0.0))
        credit_sum = func.sum(case((Transaction.transaction_type == TransactionType.CREDIT, Transaction.amount), else_=0.0))
        txn_rows = (
            db.query(Transaction.bank_id, debit_sum, credit_sum, func.max(Transaction.transaction_date))
            .filter(Transaction.bank_id.in_(bank_ids), Transaction.user_id.in_(household_ids))
            .group_by(Transaction.bank_id)
            .all()
        )
        net_map = {bid: (float(d or 0), float(c or 0), last_txn) for bid, d, c, last_txn in txn_rows}

        for b in banks:
            b.last_synced_at = last_map.get(b.id)
            d, c, last_txn = net_map.get(b.id, (0.0, 0.0, None))
            b.last_transaction_at = last_txn
            # Uniform signed net = inflow(credit) - outflow(debit). For a credit
            # card this is negative when money is owed and positive when in credit;
            # for savings/other it approximates the balance. Used only as a
            # fallback when no statement balance is stored.
            b.computed_balance = (c - d) if (d or c) else None

    return banks


@router.post("/recompute-balances")
def recompute_balances(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Recompute every account's balance from the latest statement running balance
    (fixes balances that went stale when statements were uploaded out of order)."""
    changed = recompute_all_balances(db, current_user.id)
    return {"updated": changed}


@router.post("/redetect-credit-balances")
def redetect_credit_balances(
    use_ai: bool = True,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Re-derive every credit card's Total Amount Due from its latest statement PDF
    (regex first, AI-assisted extraction as fallback). Returns a per-bank report so
    the UI can show what changed vs what still needs a manual balance entry."""
    reports = redetect_all_credit_balances(db, current_user.id, use_ai=use_ai)
    return {"banks": reports}


@router.post("/check-stale-credit-cards")
def check_stale_credit_cards_now(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Manually run the 60+ day no-activity credit card check for whatever the
    caller can see (their own cards, or their whole household if admin), instead
    of waiting for the once-a-day scheduled run."""
    from app.tasks.credit_balance_tasks import check_stale_credit_cards

    household_ids = visible_user_ids(db, current_user)
    result = check_stale_credit_cards(db, user_ids=household_ids)
    return result


@router.get("/password-candidates")
def list_password_candidates(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    """List password candidates for all banks the user can access."""
    banks = db.query(Bank).filter(
        Bank.user_id == current_user.id
    ).all()

    result = []
    for bank in banks:
        candidates = get_password_candidates(db, bank)
        result.append({
            "bank_id": bank.id,
            "bank_name": bank.name,
            "candidates": candidates
        })

    return {
        "banks": result,
        "total": len(result)
    }


@router.get("/external")
def get_external_bank(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Return (creating if needed) this user's catch-all 'External' bank -- the
    same one /api/ingest/transaction and /api/ingest/sms fall back to when an
    incoming transaction's account name doesn't match anything. JWT-authed
    clients (the mobile app's native-intent offline queue) use this instead of
    guessing an existing bank when an account hint doesn't resolve, so an
    unrecognized account's transaction lands somewhere reviewable instead of
    being silently misattributed to an unrelated real account."""
    from app.api.endpoints.ingest import _get_external_bank

    bank = _get_external_bank(db, current_user)
    return {"id": bank.id, "name": bank.name}


@router.get("/statement-dashboard")
def get_statement_dashboard(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    """Per-bank: latest PDF statement info and expected next statement date."""
    from datetime import timedelta
    from sqlalchemy import func

    banks = db.query(Bank).filter(
        Bank.user_id == current_user.id
    ).all()

    result = []
    for bank in banks:
        # Latest bank_email for this bank
        latest_email = (
            db.query(BankEmail)
            .filter(BankEmail.bank_id == bank.id)
            .order_by(BankEmail.received_date.desc())
            .first()
        )
        # Latest PDF statement
        latest_pdf = None
        if latest_email:
            latest_pdf = (
                db.query(PDFStatement)
                .filter(PDFStatement.bank_email_id == latest_email.id)
                .order_by(PDFStatement.created_at.desc())
                .first()
            )

        total_statements = (
            db.query(func.count(PDFStatement.id))
            .join(BankEmail, PDFStatement.bank_email_id == BankEmail.id)
            .filter(BankEmail.bank_id == bank.id)
            .scalar()
        ) or 0

        total_transactions = (
            db.query(func.count(Transaction.id))
            .filter(Transaction.bank_id == bank.id, Transaction.user_id == current_user.id)
            .scalar()
        ) or 0

        # Determine latest date from statement period or email received date
        latest_date = None
        period_end = None
        email_subject = None
        if latest_pdf and latest_pdf.statement_period_end:
            period_end = latest_pdf.statement_period_end
            latest_date = period_end
        if latest_email:
            email_subject = latest_email.subject
            if latest_date is None and latest_email.received_date:
                latest_date = latest_email.received_date

        # Expected next statement: roughly 1 month after latest
        expected_next = None
        days_until_next = None
        if latest_date:
            expected_next = latest_date + timedelta(days=30)
            days_until_next = (expected_next.date() - utcnow().date()).days

        result.append({
            "bank_id": bank.id,
            "bank_name": bank.name,
            "bank_type": bank.bank_type,
            "bank_code": bank.code,
            "current_balance": bank.current_balance,
            "balance_updated_at": bank.balance_updated_at.isoformat() if bank.balance_updated_at else None,
            "total_statements": total_statements,
            "total_transactions": total_transactions,
            "latest_email_subject": email_subject,
            "latest_received_date": latest_email.received_date.isoformat() if latest_email and latest_email.received_date else None,
            "latest_statement_period_end": period_end.isoformat() if period_end else None,
            "latest_pdf_filename": latest_pdf.file_name if latest_pdf else None,
            "latest_pdf_processed": latest_pdf.is_processed if latest_pdf else False,
            "expected_next_statement": expected_next.isoformat() if expected_next else None,
            "days_until_next": days_until_next,
        })

    return {"banks": result}


@router.post("/", response_model=BankResponse, status_code=status.HTTP_201_CREATED)
def create_bank(
    bank_data: BankCreate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_write_access)
):
    """Create a new bank, owned by the caller (any non-VIEWER user can add
    their own accounts -- a household's admin isn't the only one who can track
    an account; a VIEWER can look but never add/edit/delete)."""

    # Allow duplicate codes - users can have multiple accounts with same bank
    bank = Bank(**bank_data.dict(), user_id=current_user.id)
    db.add(bank)
    db.commit()
    db.refresh(bank)

    # Kick off an initial sync right away so the user doesn't have to remember to
    # trigger one manually after adding a bank. Best-effort — a dispatch failure
    # (e.g. no Gmail account linked yet) shouldn't block bank creation.
    try:
        from app.api.endpoints.sync import dispatch_sync
        dispatch_sync(db, background_tasks, current_user.id, sync_type="incremental", bank_id=bank.id)
    except Exception:
        logger.warning("Auto-sync dispatch failed for new bank %s", bank.id, exc_info=True)

    return bank


@router.get("/{bank_id}", response_model=BankResponse)
def get_bank(
    bank_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    """Get bank by ID (own, or any household member's if admin)"""
    bank = db.query(Bank).filter(
        Bank.id == bank_id,
        Bank.user_id.in_(visible_user_ids(db, current_user))
    ).first()

    if not bank:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Bank not found"
        )

    return bank


@router.delete("/{bank_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_bank(
    bank_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_write_access)
):
    """Delete a bank. Scoped to the caller's own banks, or any household
    member's if the caller is an admin -- a VIEWER can't delete anything."""

    bank = db.query(Bank).filter(
        Bank.id == bank_id,
        Bank.user_id.in_(visible_user_ids(db, current_user)),
    ).first()

    if not bank:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Bank not found"
        )

    # Delete related records in correct order to avoid FK violations
    try:
        from app.models.models import PDFStatement, TransactionLabel
        # Step 0: Delete transaction_labels for this bank's transactions (otherwise they
        # are orphaned / violate the FK when the transactions are removed).
        txn_ids_q = db.query(Transaction.id).filter(Transaction.bank_id == bank_id)
        db.query(TransactionLabel).filter(
            TransactionLabel.transaction_id.in_(txn_ids_q)
        ).delete(synchronize_session=False)

        # Step 1: Delete transactions first (they reference both bank and pdf_statements)
        db.query(Transaction).filter(Transaction.bank_id == bank_id).delete(synchronize_session=False)

        # Step 2: Get all bank_email IDs for this bank
        bank_email_ids = [be.id for be in db.query(BankEmail).filter(BankEmail.bank_id == bank_id).all()]
        
        # Step 3: Delete PDF statements (they reference bank_emails)
        from app.models.models import PDFStatement
        if bank_email_ids:
            db.query(PDFStatement).filter(PDFStatement.bank_email_id.in_(bank_email_ids)).delete(synchronize_session=False)
        
        # Step 4: Delete bank_emails (now safe)
        db.query(BankEmail).filter(BankEmail.bank_id == bank_id).delete(synchronize_session=False)
        
        # Step 5: Delete bank_configs
        db.query(BankConfig).filter(BankConfig.bank_id == bank_id).delete(synchronize_session=False)
        
        # Step 6: Finally delete the bank
        db.delete(bank)
        db.commit()
        
    except Exception as e:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to delete bank: {str(e)}"
        )
    
    return None


@router.put("/{bank_id}", response_model=BankResponse)
def update_bank(
    bank_id: int,
    bank_data: BankUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_write_access)
):
    """Update bank. Scoped to the caller's own banks, or any household
    member's if the caller is an admin -- a VIEWER can't edit anything."""
    bank = db.query(Bank).filter(
        Bank.id == bank_id,
        Bank.user_id.in_(visible_user_ids(db, current_user))
    ).first()
    if not bank:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Bank not found"
        )
    
    # Update fields — never overwrite an existing password with blank/None
    update_data = bank_data.dict(exclude_unset=True)
    if 'account_password' in update_data and not (update_data['account_password'] or '').strip():
        del update_data['account_password']
    for field, value in update_data.items():
        setattr(bank, field, value)

    # A manually-entered balance should stick until the user either edits it
    # again or explicitly clicks "Redetect Credit Balances" — the automatic
    # periodic redetection (credit_balance_tasks.py) checks this flag and skips
    # any card marked 'manual' so it can never silently overwrite it.
    if 'current_balance' in update_data:
        bank.balance_source = 'manual'
        bank.balance_updated_at = utcnow()

    db.commit()
    db.refresh(bank)
    return bank    


class PasswordCandidatesRequest(BaseModel):
    candidates: List[str] = []
    primary_password: str | None = None


@router.get("/{bank_id}/account-password")
def get_bank_account_password(
    bank_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    """Return the stored account password for a bank (admin only)."""
    if current_user.role.upper() != "ADMIN":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not enough permissions")
    bank = db.query(Bank).filter(
        Bank.id == bank_id,
        Bank.user_id.in_(visible_user_ids(db, current_user))
    ).first()
    if not bank:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Bank not found")
    return {"bank_id": bank_id, "has_password": bool(bank.account_password), "password": bank.account_password or ""}


@router.get("/{bank_id}/password-candidates")
def get_bank_password_candidates(
    bank_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    """Get password candidates for a bank (used for PDF unlock retries)."""
    bank = db.query(Bank).filter(
        Bank.id == bank_id,
        Bank.user_id.in_(visible_user_ids(db, current_user))
    ).first()

    if not bank:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Bank not found"
        )

    candidates = get_password_candidates(db, bank)
    return {
        "bank_id": bank_id,
        "bank_name": bank.name,
        "candidates": candidates
    }


@router.put("/{bank_id}/password-candidates")
def update_bank_password_candidates(
    bank_id: int,
    payload: PasswordCandidatesRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_write_access)
):
    """Update password candidates for a bank."""
    bank = db.query(Bank).filter(
        Bank.id == bank_id,
        Bank.user_id.in_(visible_user_ids(db, current_user))
    ).first()

    if not bank:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Bank not found"
        )

    saved = save_password_candidates(db, bank, payload.candidates)

    if payload.primary_password:
        bank.account_password = payload.primary_password.strip()
        db.commit()

    return {
        "success": True,
        "bank_id": bank_id,
        "candidates": saved
    }




@router.post("/{bank_id}/config", response_model=BankConfigResponse, status_code=status.HTTP_201_CREATED)
def create_bank_config(
    bank_id: int,
    config_data: BankConfigCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_write_access)
):
    """Create bank configuration."""
    bank = db.query(Bank).filter(Bank.id == bank_id).first()
    if not bank:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Bank not found"
        )
    
    config = BankConfig(**config_data.dict())
    db.add(config)
    db.commit()
    db.refresh(config)
    
    return config


@router.post("/{bank_id}/upload-pdf", status_code=status.HTTP_201_CREATED)
async def upload_bank_pdf(
    bank_id: int,
    file: UploadFile = File(...),
    password: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_write_access)
):
    """Upload and process bank statement PDF"""
    import logging
    logger = logging.getLogger(__name__)

    # Validate bank exists AND is visible to the caller (own bank, or any
    # household member's bank if the caller is an admin).
    bank = db.query(Bank).filter(
        Bank.id == bank_id,
        Bank.user_id.in_(visible_user_ids(db, current_user)),
    ).first()
    if not bank:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Bank not found"
        )
    # Attribute everything this upload creates to the bank's actual owner, not
    # necessarily the caller -- an admin uploading a statement on behalf of a
    # household member must not have it land in the admin's own data instead.
    owner_id = bank.user_id

    # Validate PDF file
    if not file.filename.lower().endswith('.pdf'):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only PDF files are allowed"
        )
    
    try:
        # Create upload directory
        os.makedirs(settings.UPLOAD_DIR, exist_ok=True)
        
        # Save PDF file
        pdf_filename = f"{bank.code}_{utcnow().strftime('%Y%m%d%H%M%S')}_{file.filename}"
        pdf_path = os.path.join(settings.UPLOAD_DIR, pdf_filename)
        
        with open(pdf_path, 'wb') as f:
            content = await file.read()
            f.write(content)
        
        logger.info(f"Saved PDF to {pdf_path}")
        
        # Check if password protected
        is_protected = PDFParser.is_password_protected(pdf_path)
        
        # Use provided password or bank account password
        pdf_password = password or bank.account_password
        
        # Ensure a GmailAccount exists for manual uploads so PDFs appear in listings
        manual_email = f"manual+{owner_id}@local"
        gmail_account = db.query(GmailAccount).filter(
            GmailAccount.user_id == owner_id,
            GmailAccount.email == manual_email
        ).first()
        if not gmail_account:
            gmail_account = GmailAccount(
                user_id=owner_id,
                email=manual_email,
                credentials='{}',
                is_active=False
            )
            db.add(gmail_account)
            db.commit()
            db.refresh(gmail_account)

        bank_email = BankEmail(
            gmail_account_id=gmail_account.id,
            bank_id=bank.id,
            email_id=f"manual_{uuid4().hex}",
            subject=f"Manual upload: {file.filename}",
            received_date=utcnow(),
            has_attachment=True,
            is_processed=False
        )
        db.add(bank_email)
        db.commit()
        db.refresh(bank_email)

        # Create PDF statement record
        pdf_statement = PDFStatement(
            bank_email_id=bank_email.id,
            file_path=pdf_path,
            file_name=file.filename,
            is_password_protected=is_protected
        )
        db.add(pdf_statement)
        db.commit()
        db.refresh(pdf_statement)
        
        logger.info(f"Created PDF statement record: {pdf_statement.id}")
        
        import json
        field_mapping = json.loads(bank.field_mapping) if bank.field_mapping else None
        # Parse PDF
        parse_result = PDFParser.parse_statement(
            pdf_path,
            bank_code=bank.code,
            password=pdf_password if is_protected else None,
            field_mapping=field_mapping
        )
        
        if not parse_result['success']:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Failed to parse PDF: {parse_result.get('error', 'Unknown error')}"
            )
        
        logger.info(f"Parsed PDF successfully, found {len(parse_result['transactions'])} transactions")
        
        # Store decrypted copy when available
        if is_protected and pdf_password:
            ensure_decrypted_pdf(db, pdf_statement, pdf_password)

        # Update statement period
        pdf_statement.statement_period_start = parse_result['statement_period']['start']
        pdf_statement.statement_period_end = parse_result['statement_period']['end']
        pdf_statement.is_processed = True
        bank_email.is_processed = True

        # Investment-linked "banks" (e.g. a CDSL CAS statement) aren't real
        # accounts -- never let the AI fallback hallucinate "transactions"
        # out of a holdings table; see investment_service.record_cas_statement.
        if bank.bank_type == "investment":
            parse_result["transactions"] = []
        else:
            # Parser found nothing at all — try the AI fallback before giving up.
            ai_transaction_extraction.fill_missing_transactions(db, owner_id, parse_result)

        # Add transactions
        transactions_added = 0
        for trans_data in parse_result['transactions']:
            # Auto-categorize if no category
            if not trans_data.get('category'):
                trans_data['category'] = TransactionService.categorize_transaction(
                    trans_data['description']
                )
            
            transaction, _reconciled = create_or_reconcile_transaction(
                db, owner_id, bank.id, trans_data, pdf_statement_id=pdf_statement.id
            )
            apply_auto_rules_and_notify(db, owner_id, transaction)
            transactions_added += 1

        apply_statement_balance(
            bank, parse_result, fallback_date=bank_email.received_date,
            ai_context={"db": db, "user_id": owner_id},
        )
        try:
            reward_points_service.record_statement_reward_points(
                db, bank, pdf_statement.id, parse_result.get("_raw_text"),
                bank_email.received_date, ai_context={"db": db, "user_id": owner_id},
            )
        except Exception:
            logger.warning("Reward-points extraction failed for bank %s", bank.id, exc_info=True)
        try:
            investment_service.record_ppf_statement(
                db, bank, parse_result.get("_raw_text"), bank_email.received_date,
            )
        except Exception:
            logger.warning("PPF extraction failed for bank %s", bank.id, exc_info=True)
        try:
            investment_service.record_cas_statement(
                db, bank, parse_result.get("_raw_text"), bank_email.received_date,
            )
        except Exception:
            logger.warning("CAS extraction failed for bank %s", bank.id, exc_info=True)
        db.commit()

        logger.info(f"Added {transactions_added} transactions to database")
        
        return {
            "success": True,
            "message": f"PDF processed successfully. Added {transactions_added} transactions.",
            "pdf_statement_id": pdf_statement.id,
            "transactions_count": transactions_added,
            "statement_period": {
                "start": pdf_statement.statement_period_start,
                "end": pdf_statement.statement_period_end
            }
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error processing PDF upload: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to process PDF: {str(e)}"
        )
