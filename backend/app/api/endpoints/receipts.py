"""Scan a receipt photo (OCR + AI extraction) into a draft transaction. This
never creates a transaction itself -- it returns a best-guess draft for the
client to preview/edit and submit via the existing POST /api/transactions,
same preview-then-confirm shape as the SMS import flow. Auto-creating straight
from an OCR guess would risk silently wrong amounts with no chance to correct.
"""
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.api.endpoints.auth import get_current_active_user
from app.models.models import User
from app.services.receipt_ocr import extract_receipt_text, OCR_AVAILABLE
from app.services.ai_receipt_extraction import extract_receipt_transaction

router = APIRouter()

_ALLOWED_CONTENT_TYPES = {"image/jpeg", "image/jpg", "image/png"}
_MAX_BYTES = 12 * 1024 * 1024  # a phone camera JPEG rarely exceeds a few MB


@router.post("/scan")
async def scan_receipt(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    if file.content_type not in _ALLOWED_CONTENT_TYPES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Upload a JPEG or PNG photo of the receipt.",
        )
    if not OCR_AVAILABLE:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="OCR is not available on the server.",
        )

    image_bytes = await file.read()
    if len(image_bytes) > _MAX_BYTES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Photo is too large.")

    ocr_text = extract_receipt_text(image_bytes)
    if not ocr_text.strip():
        return {
            "success": False,
            "reason": "no_text",
            "message": "Couldn't read any text from that photo. Try a clearer, well-lit shot.",
        }

    extracted = extract_receipt_transaction(db, current_user.id, ocr_text)
    if not extracted:
        return {
            "success": False,
            "reason": "no_extraction",
            "message": "Couldn't identify an amount on this receipt. Enter it manually.",
            "raw_text": ocr_text.strip()[:500],
        }

    return {"success": True, "transaction_type": "debit", **extracted}
