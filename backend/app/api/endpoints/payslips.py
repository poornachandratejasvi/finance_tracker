"""Payslip upload + parsing (see payslip_service.parse_payslip) -- feeds the
tax dashboard's 80C (provident fund) and HRA-exemption (basic/hra_received)
figures. Re-uploading the same month updates that row in place.
"""
import os
import tempfile

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.api.endpoints.auth import get_current_active_user, require_write_access
from app.models.models import User, Payslip
from app.services.pdf_parser import PDFParser
from app.services import payslip_service

router = APIRouter()


def _payslip_dict(db: Session, p: Payslip) -> dict:
    from app.services import paperless_service

    return {
        "id": p.id,
        "month": p.month,
        "employee_name": p.employee_name,
        "regime_type": p.regime_type,
        "basic": p.basic,
        "hra_received": p.hra_received,
        "provident_fund": p.provident_fund,
        "income_tax_deducted": p.income_tax_deducted,
        "other_earnings_total": p.other_earnings_total,
        "other_deductions_total": p.other_deductions_total,
        "total_earnings": p.total_earnings,
        "total_deductions": p.total_deductions,
        "net_pay": p.net_pay,
        "document_url": paperless_service.document_url(db, p.paperless_document_id),
    }


@router.get("/")
def list_payslips(db: Session = Depends(get_db), current_user: User = Depends(get_current_active_user)):
    rows = db.query(Payslip).filter(Payslip.user_id == current_user.id).order_by(Payslip.month.desc()).all()
    return [_payslip_dict(db, p) for p in rows]


@router.get("/{payslip_id}")
def get_payslip(payslip_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_active_user)):
    p = db.query(Payslip).filter(Payslip.id == payslip_id, Payslip.user_id == current_user.id).first()
    if not p:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Payslip not found")
    return _payslip_dict(db, p)


@router.post("/upload", status_code=status.HTTP_201_CREATED)
async def upload_payslip(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_write_access),
):
    if file.content_type != "application/pdf":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Upload a PDF payslip.")

    file_bytes = await file.read()
    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
            tmp.write(file_bytes)
            tmp_path = tmp.name
        text = PDFParser.extract_text(tmp_path)
    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.remove(tmp_path)

    parsed = payslip_service.parse_payslip(text)
    if not parsed:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Couldn't recognize this as a payslip -- the parser looks for a specific Nokia-payslip layout today.",
        )

    p = db.query(Payslip).filter(Payslip.user_id == current_user.id, Payslip.month == parsed["month"]).first()
    if not p:
        p = Payslip(user_id=current_user.id, month=parsed["month"])
        db.add(p)
    for field, value in parsed.items():
        if field != "month":
            setattr(p, field, value)
    db.commit()
    db.refresh(p)

    from app.services import paperless_service
    if paperless_service.is_configured(db):
        task_id = paperless_service.upload_document(db, file_bytes, file.filename, title=f"Payslip {p.month}")
        if task_id:
            from app.tasks.payslip_document_tasks import resolve_payslip_document
            resolve_payslip_document.delay(p.id, task_id)

    return _payslip_dict(db, p)


@router.delete("/{payslip_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_payslip(payslip_id: int, db: Session = Depends(get_db), current_user: User = Depends(require_write_access)):
    p = db.query(Payslip).filter(Payslip.id == payslip_id, Payslip.user_id == current_user.id).first()
    if not p:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Payslip not found")
    db.delete(p)
    db.commit()
