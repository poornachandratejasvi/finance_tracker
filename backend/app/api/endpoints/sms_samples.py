"""SMS samples the user labels, plus the ones the extractor learns."""

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session
from typing import Optional

from app.api.endpoints.auth import get_current_active_user, require_write_access
from app.core.database import get_db
from app.models.models import SmsSample, User
from app.services.sms_sample_service import interpret, save_labeled_sample

router = APIRouter()


class SmsSampleBody(BaseModel):
    raw_text: str
    sender: Optional[str] = None
    is_transaction: bool = True
    amount: Optional[float] = None
    transaction_type: Optional[str] = None
    description: Optional[str] = None
    bank_id: Optional[int] = None
    balance_amount: Optional[float] = None


class SmsPreviewBody(BaseModel):
    raw_text: str
    sender: Optional[str] = None


def _dict(row: SmsSample) -> dict:
    return {
        "id": row.id,
        "raw_text": row.raw_text,
        "sender": row.sender,
        "is_transaction": row.is_transaction,
        "amount": row.amount,
        "transaction_type": row.transaction_type,
        "description": row.description,
        "bank_id": row.bank_id,
        "balance_amount": row.balance_amount,
        "source": row.source,
        "created_at": row.created_at.isoformat() if row.created_at else None,
    }


@router.get("/")
def list_sms_samples(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    rows = (
        db.query(SmsSample)
        .filter(SmsSample.user_id == current_user.id)
        .order_by(SmsSample.id.desc())
        .all()
    )
    return [_dict(row) for row in rows]


@router.post("/preview")
def preview_sms(
    body: SmsPreviewBody,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Read one SMS the way ingest would, without saving a transaction or a sample."""
    decision = interpret(db, current_user, body.raw_text, body.sender, use_ai=True, remember_result=False)
    return {
        "action": decision.get("action"),
        "via": decision.get("via"),
        "amount": decision.get("amount"),
        "transaction_type": decision.get("transaction_type"),
        "description": decision.get("description"),
        "bank_id": decision.get("bank_id"),
        "balance": decision.get("balance"),
    }


@router.post("/", status_code=status.HTTP_201_CREATED)
def create_sms_sample(
    body: SmsSampleBody,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_write_access),
):
    try:
        row = save_labeled_sample(db, current_user, body.dict())
    except ValueError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))
    return _dict(row)


@router.put("/{sample_id}")
def update_sms_sample(
    sample_id: int,
    body: SmsSampleBody,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_write_access),
):
    try:
        row = save_labeled_sample(db, current_user, body.dict(), sample_id=sample_id)
    except ValueError as exc:
        status_code = status.HTTP_404_NOT_FOUND if "not found" in str(exc).lower() else status.HTTP_422_UNPROCESSABLE_ENTITY
        raise HTTPException(status_code, str(exc))
    return _dict(row)


@router.delete("/{sample_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_sms_sample(
    sample_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_write_access),
):
    row = db.query(SmsSample).filter(SmsSample.id == sample_id, SmsSample.user_id == current_user.id).first()
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Sample not found.")
    db.delete(row)
    db.commit()
