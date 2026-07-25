from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel, EmailStr
from sqlalchemy.orm import Session
from typing import Optional, List
from concurrent.futures import ThreadPoolExecutor, as_completed
import os
import io
import zipfile
from datetime import datetime, timedelta

from app.core.database import get_db, SessionLocal
from app.core.time_utils import utcnow
from app.core.config import settings
from app.api.endpoints.auth import get_current_active_user, get_current_admin_user
from app.models.models import User, PDFStatement, BankEmail, Bank, GmailAccount, Transaction
from app.services.csv_service import generate_csv_for_pdf, send_csv_email

router = APIRouter()


class CsvEmailRequest(BaseModel):
    to_email: Optional[EmailStr] = None
    delete_after: bool = True


class CsvBulkEmailRequest(BaseModel):
    pdf_ids: List[int]
    to_email: Optional[EmailStr] = None
    delete_after: bool = True


class CsvBulkGenerateRequest(BaseModel):
    pdf_ids: List[int]


class CsvCleanupRequest(BaseModel):
    max_age_days: Optional[int] = None
    max_files: Optional[int] = None
    max_total_mb: Optional[int] = None
    delete_csvs: bool = True
    delete_decrypted_pdfs: bool = False
    dry_run: bool = False


def _get_pdf_with_access(db: Session, pdf_id: int, user_id: int) -> PDFStatement:
    pdf = db.query(PDFStatement).filter(PDFStatement.id == pdf_id).first()
    if not pdf:
        raise HTTPException(status_code=404, detail="PDF not found")

    bank_email = db.query(BankEmail).filter(BankEmail.id == pdf.bank_email_id).first()
    if not bank_email:
        raise HTTPException(status_code=404, detail="Bank email not found")

    gmail_account = db.query(GmailAccount).filter(
        GmailAccount.id == bank_email.gmail_account_id,
        GmailAccount.user_id == user_id
    ).first()
    if not gmail_account:
        raise HTTPException(status_code=403, detail="Access denied")

    return pdf


def _get_bank_for_pdf(db: Session, pdf: PDFStatement) -> Bank:
    bank_email = db.query(BankEmail).filter(BankEmail.id == pdf.bank_email_id).first()
    if not bank_email:
        raise HTTPException(status_code=404, detail="Bank email not found")

    bank = db.query(Bank).filter(Bank.id == bank_email.bank_id).first()
    if not bank:
        raise HTTPException(status_code=404, detail="Bank not found")

    return bank


@router.post("/pdfs/{pdf_id}/generate")
def generate_csv(
    pdf_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    pdf = _get_pdf_with_access(db, pdf_id, current_user.id)
    bank = _get_bank_for_pdf(db, pdf)

    try:
        result = generate_csv_for_pdf(db, pdf, bank)
        return {
            "success": True,
            "pdf_id": pdf_id,
            "csv_path": result["csv_path"],
            "row_count": result["row_count"],
        }
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.get("/pdfs/{pdf_id}/download")
def download_csv(
    pdf_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    pdf = _get_pdf_with_access(db, pdf_id, current_user.id)
    bank = _get_bank_for_pdf(db, pdf)

    result = generate_csv_for_pdf(db, pdf, bank)
    csv_path = result["csv_path"]
    if not os.path.exists(csv_path):
        raise HTTPException(status_code=404, detail="CSV not found on disk")

    return FileResponse(
        csv_path,
        media_type='text/csv',
        filename=os.path.basename(csv_path)
    )


@router.post("/pdfs/{pdf_id}/email")
def email_csv_for_pdf(
    pdf_id: int,
    payload: CsvEmailRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    pdf = _get_pdf_with_access(db, pdf_id, current_user.id)
    bank = _get_bank_for_pdf(db, pdf)

    to_email = payload.to_email or bank.csv_email
    if not to_email:
        raise HTTPException(status_code=400, detail="Recipient email is required")

    result = generate_csv_for_pdf(db, pdf, bank)
    csv_path = result["csv_path"]

    subject = f"{bank.name} Statement CSV"
    body = f"CSV export for {bank.name} statement {pdf.file_name}."
    try:
        send_csv_email(to_email, subject, body, csv_path)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Failed to send email: {exc}")

    if payload.delete_after and os.path.exists(csv_path):
        os.remove(csv_path)

    return {"success": True, "sent_to": to_email}


@router.post("/banks/{bank_id}/email-latest")
def email_latest_bank_csv(
    bank_id: int,
    payload: CsvEmailRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    bank = db.query(Bank).filter(Bank.id == bank_id).first()
    if not bank:
        raise HTTPException(status_code=404, detail="Bank not found")

    to_email = payload.to_email or bank.csv_email
    if not to_email:
        raise HTTPException(status_code=400, detail="Recipient email is required")

    bank_emails = db.query(BankEmail).filter(BankEmail.bank_id == bank_id).all()
    if not bank_emails:
        raise HTTPException(status_code=404, detail="No emails found for bank")
    bank_email_ids = [be.id for be in bank_emails]
    pdf = db.query(PDFStatement).filter(
        PDFStatement.bank_email_id.in_(bank_email_ids)
    ).order_by(PDFStatement.created_at.desc()).first()

    if not pdf:
        raise HTTPException(status_code=404, detail="No PDFs found for bank")

    gmail_account_ids = [be.gmail_account_id for be in bank_emails]
    gmail_account = db.query(GmailAccount).filter(
        GmailAccount.id.in_(gmail_account_ids),
        GmailAccount.user_id == current_user.id
    ).first()
    if not gmail_account:
        raise HTTPException(status_code=403, detail="Access denied")

    result = generate_csv_for_pdf(db, pdf, bank)
    csv_path = result["csv_path"]

    subject = f"{bank.name} Statement CSV"
    body = f"CSV export for {bank.name} statement {pdf.file_name}."
    try:
        send_csv_email(to_email, subject, body, csv_path)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Failed to send email: {exc}")

    if payload.delete_after and os.path.exists(csv_path):
        os.remove(csv_path)

    return {"success": True, "sent_to": to_email, "pdf_id": pdf.id}


@router.post("/email")
def email_csv_bulk(
    payload: CsvBulkEmailRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    if not payload.pdf_ids:
        raise HTTPException(status_code=400, detail="pdf_ids is required")

    sent = []
    for pdf_id in payload.pdf_ids:
        pdf = _get_pdf_with_access(db, pdf_id, current_user.id)
        bank = _get_bank_for_pdf(db, pdf)
        to_email = payload.to_email or bank.csv_email
        if not to_email:
            raise HTTPException(status_code=400, detail="Recipient email is required")

        result = generate_csv_for_pdf(db, pdf, bank)
        csv_path = result["csv_path"]
        subject = f"{bank.name} Statement CSV"
        body = f"CSV export for {bank.name} statement {pdf.file_name}."
        send_csv_email(to_email, subject, body, csv_path)

        if payload.delete_after and os.path.exists(csv_path):
            os.remove(csv_path)

        sent.append({"pdf_id": pdf_id, "sent_to": to_email})

    return {"success": True, "sent": sent}


@router.post("/pdfs/bulk-generate")
def generate_csv_bulk(
    payload: CsvBulkGenerateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    if not payload.pdf_ids:
        raise HTTPException(status_code=400, detail="pdf_ids is required")

    results = []
    for pdf_id in payload.pdf_ids:
        pdf = _get_pdf_with_access(db, pdf_id, current_user.id)
        bank = _get_bank_for_pdf(db, pdf)
        try:
            result = generate_csv_for_pdf(db, pdf, bank)
            results.append({
                "pdf_id": pdf_id,
                "success": True,
                "row_count": result["row_count"],
            })
        except Exception as exc:
            results.append({"pdf_id": pdf_id, "success": False, "error": str(exc)})

    return {
        "success": all(r.get("success") for r in results),
        "results": results
    }


def _generate_csv_worker(pdf_id: int, user_id: int) -> dict:
    db = SessionLocal()
    try:
        pdf = _get_pdf_with_access(db, pdf_id, user_id)
        bank = _get_bank_for_pdf(db, pdf)
        result = generate_csv_for_pdf(db, pdf, bank)
        return {
            "pdf_id": pdf_id,
            "success": True,
            "row_count": result["row_count"],
        }
    except Exception as exc:
        return {"pdf_id": pdf_id, "success": False, "error": str(exc)}
    finally:
        db.close()


def _run_generate_all_background(pdf_ids: list, user_id: int):
    """Run in background — no HTTP context."""
    max_workers = max(1, settings.MAX_WORKERS)
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = [executor.submit(_generate_csv_worker, pdf_id, user_id) for pdf_id in pdf_ids]
        for future in as_completed(futures):
            future.result()  # consume result (errors logged inside worker)


@router.post("/pdfs/generate-all")
def generate_csv_for_all(
    bank_id: Optional[int] = None,
    background_tasks: BackgroundTasks = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
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
        return {"success": True, "processed": 0, "queued": 0, "errors": []}

    pdf_ids = [pdf.id for pdf in pdfs]

    if background_tasks is not None:
        # Fire-and-forget: return immediately; processing continues in background
        background_tasks.add_task(_run_generate_all_background, pdf_ids, current_user.id)
        return {
            "success": True,
            "processed": len(pdf_ids),
            "queued": len(pdf_ids),
            "message": "CSV generation started in background. Download will be available shortly.",
            "errors": [],
        }

    # Fallback: synchronous (for tests / direct calls without BackgroundTasks)
    results = []
    errors = []
    max_workers = max(1, settings.MAX_WORKERS)
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = [executor.submit(_generate_csv_worker, pdf_id, current_user.id) for pdf_id in pdf_ids]
        for future in as_completed(futures):
            result = future.result()
            results.append(result)
            if not result.get("success"):
                errors.append(result)

    return {
        "success": len(errors) == 0,
        "processed": len(results),
        "queued": 0,
        "errors": errors
    }


@router.get("/pdfs/download-zip")
def download_all_csv_zip(
    bank_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    """Download all generated CSVs for a bank (or all banks) as a single ZIP file."""
    from app.services.csv_service import _csv_dir  # noqa: PLC0415
    from sqlalchemy import or_  # noqa: PLC0415

    # Resolve bank IDs the user has access to
    bank_query = db.query(Bank).filter(
        Bank.user_id == current_user.id
    )
    if bank_id:
        bank_query = bank_query.filter(Bank.id == bank_id)
    accessible_bank_ids = {b.id for b in bank_query.all()}

    # Collect PDF IDs via BankEmail → Bank (same path as statement-dashboard)
    bank_email_ids = [
        be.id for be in
        db.query(BankEmail).filter(BankEmail.bank_id.in_(accessible_bank_ids)).all()
    ]
    # Build pdf_id → bank_name mapping
    pdf_to_bank: dict = {}
    for be in db.query(BankEmail).filter(BankEmail.id.in_(bank_email_ids)).all():
        bank = db.query(Bank).filter(Bank.id == be.bank_id).first()
        folder = (bank.name.replace("/", "_") if bank else "unknown")
        for pdf in db.query(PDFStatement).filter(PDFStatement.bank_email_id == be.id).all():
            pdf_to_bank[pdf.id] = folder

    # Scan CSV directory; file names start with "{pdf_id}_"
    csv_directory = _csv_dir()
    if not os.path.isdir(csv_directory):
        raise HTTPException(status_code=404, detail="No CSV files found. Please run 'Generate All CSVs' first.")

    # Only include CSVs for PDFs that actually produced transactions — i.e. real bank
    # statements. This excludes the invoice/receipt/T&C/order-confirmation attachments
    # (and empty 0-transaction CSVs) that also arrive as PDFs on bank emails.
    statement_pdf_ids = set()
    all_pdf_ids = list(pdf_to_bank.keys())
    if all_pdf_ids:
        rows = (
            db.query(Transaction.pdf_statement_id)
            .filter(
                Transaction.user_id == current_user.id,
                Transaction.pdf_statement_id.in_(all_pdf_ids),
            )
            .distinct()
            .all()
        )
        statement_pdf_ids = {r[0] for r in rows if r[0] is not None}

    matched_files = []
    for fname in os.listdir(csv_directory):
        if not fname.endswith(".csv"):
            continue
        try:
            pdf_id = int(fname.split("_")[0])
        except (ValueError, IndexError):
            continue
        if pdf_id not in statement_pdf_ids:
            continue  # skip non-statement / empty CSVs
        path = os.path.join(csv_directory, fname)
        try:
            if os.path.getsize(path) <= 2:  # empty (header-only / blank) file
                continue
        except OSError:
            continue
        matched_files.append((pdf_id, fname, path))

    if not matched_files:
        raise HTTPException(
            status_code=404,
            detail="No statement CSVs found for this selection. Generate CSVs for statements that contain transactions first.",
        )

    zip_buffer = io.BytesIO()
    with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        for pdf_id, fname, path in matched_files:
            folder = pdf_to_bank.get(pdf_id, "unknown")
            zf.write(path, f"{folder}/{fname}")
    zip_buffer.seek(0)

    bank_label = f"bank_{bank_id}" if bank_id else "all_banks"
    zip_name = f"statements_{bank_label}_{utcnow().strftime('%Y%m%d_%H%M%S')}.zip"

    return StreamingResponse(
        zip_buffer,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{zip_name}"'},
    )


def _cleanup_files(
    files: List[str],
    cutoff: Optional[datetime],
    max_files: Optional[int],
    max_total_mb: Optional[int],
    dry_run: bool,
) -> List[str]:
    """Select files to delete by age (cutoff), count (max_files) and size (max_total_mb).

    All three criteria are honoured together. Passing only ``cutoff`` (max_age_days) now
    correctly deletes every file older than the cutoff — previously age had no effect
    unless a count/size limit was also supplied.
    """
    existing = [f for f in files if os.path.exists(f)]
    existing.sort(key=lambda f: os.path.getmtime(f))  # oldest first
    to_delete = set()

    # Age-based retention
    if cutoff is not None:
        for f in existing:
            if datetime.utcfromtimestamp(os.path.getmtime(f)) < cutoff:
                to_delete.add(f)

    # Count-based retention: keep only the newest `max_files`
    if max_files is not None and len(existing) > max_files:
        for f in existing[:len(existing) - max_files]:
            to_delete.add(f)

    # Size-based retention: drop oldest until under the byte budget
    if max_total_mb is not None:
        max_bytes = max_total_mb * 1024 * 1024
        remaining = [f for f in existing if f not in to_delete]
        total_bytes = sum(os.path.getsize(f) for f in remaining)
        while remaining and total_bytes > max_bytes:
            path = remaining.pop(0)
            total_bytes -= os.path.getsize(path)
            to_delete.add(path)

    deleted = []
    for path in existing:
        if path in to_delete:
            if not dry_run:
                try:
                    os.remove(path)
                except OSError:
                    continue
            deleted.append(path)
    return deleted


@router.post("/cleanup")
def cleanup_exports(
    payload: CsvCleanupRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin_user)
):
    """Delete CSV exports / decrypted PDFs from shared storage (admin only)."""
    deleted_csvs = []
    deleted_decrypted = []
    cutoff = None
    if payload.max_age_days is not None:
        cutoff = utcnow() - timedelta(days=payload.max_age_days)

    if payload.delete_csvs:
        csv_dir = os.path.join(settings.UPLOAD_DIR, settings.CSV_SUBDIR)
        csv_files = [os.path.join(csv_dir, f) for f in os.listdir(csv_dir)] if os.path.isdir(csv_dir) else []
        deleted_csvs = _cleanup_files(csv_files, cutoff, payload.max_files, payload.max_total_mb, payload.dry_run)

    if payload.delete_decrypted_pdfs:
        decrypted_dir = os.path.join(settings.UPLOAD_DIR, "decrypted")
        decrypted_files = [os.path.join(decrypted_dir, f) for f in os.listdir(decrypted_dir)] if os.path.isdir(decrypted_dir) else []
        deleted_decrypted = _cleanup_files(decrypted_files, cutoff, payload.max_files, payload.max_total_mb, payload.dry_run)

    return {
        "success": True,
        "deleted_csvs": deleted_csvs,
        "deleted_decrypted_pdfs": deleted_decrypted
    }
