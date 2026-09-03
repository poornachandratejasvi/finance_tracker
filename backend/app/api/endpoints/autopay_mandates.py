"""UPI/bank autopay mandate CRUD -- manual tracking (v1: no automated
detection from bank/UPI-app emails, see plan notes) so a silent recurring
debit never surprises the user. Distinct from Subscription: this represents
the AUTHORIZATION itself, not a bill to pay by hand.
"""
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.time_utils import utcnow
from app.api.endpoints.auth import get_current_active_user, require_write_access
from app.models.models import User, AutopayMandate, Bank

router = APIRouter()

_FREQUENCIES = {"weekly", "monthly", "yearly", "other"}
_STATUSES = {"active", "paused", "cancelled"}


def _parse_date(s: Optional[str]) -> Optional[datetime]:
    if not s:
        return None
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00")).replace(tzinfo=None)
    except (ValueError, TypeError):
        return None


class MandateCreate(BaseModel):
    bank_id: Optional[int] = None
    merchant_name: str
    upi_vpa: Optional[str] = None
    max_amount: Optional[float] = None
    frequency: Optional[str] = "monthly"
    next_debit_date: Optional[str] = None
    status: Optional[str] = "active"
    notes: Optional[str] = None


class MandateUpdate(BaseModel):
    bank_id: Optional[int] = None
    merchant_name: Optional[str] = None
    upi_vpa: Optional[str] = None
    max_amount: Optional[float] = None
    frequency: Optional[str] = None
    next_debit_date: Optional[str] = None
    status: Optional[str] = None
    notes: Optional[str] = None


def _mandate_dict(m: AutopayMandate) -> dict:
    return {
        "id": m.id,
        "bank_id": m.bank_id,
        "merchant_name": m.merchant_name,
        "upi_vpa": m.upi_vpa,
        "max_amount": m.max_amount,
        "frequency": m.frequency,
        "next_debit_date": m.next_debit_date.strftime("%Y-%m-%d") if m.next_debit_date else None,
        "status": m.status,
        "notes": m.notes,
    }


@router.get("/")
def list_mandates(db: Session = Depends(get_db), current_user: User = Depends(get_current_active_user)):
    rows = (
        db.query(AutopayMandate)
        .filter(AutopayMandate.user_id == current_user.id)
        .order_by(AutopayMandate.next_debit_date.asc().nullslast())
        .all()
    )
    return [_mandate_dict(m) for m in rows]


@router.post("/", status_code=status.HTTP_201_CREATED)
def create_mandate(payload: MandateCreate, db: Session = Depends(get_db), current_user: User = Depends(require_write_access)):
    if payload.bank_id is not None:
        bank = db.query(Bank).filter(Bank.id == payload.bank_id, Bank.user_id == current_user.id).first()
        if not bank:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Bank not found")
    frequency = payload.frequency if payload.frequency in _FREQUENCIES else "monthly"
    mandate_status = payload.status if payload.status in _STATUSES else "active"
    m = AutopayMandate(
        user_id=current_user.id,
        bank_id=payload.bank_id,
        merchant_name=payload.merchant_name.strip(),
        upi_vpa=payload.upi_vpa,
        max_amount=payload.max_amount,
        frequency=frequency,
        next_debit_date=_parse_date(payload.next_debit_date),
        status=mandate_status,
        notes=payload.notes,
    )
    db.add(m)
    db.commit()
    db.refresh(m)
    return _mandate_dict(m)


@router.put("/{mandate_id}")
def update_mandate(mandate_id: int, payload: MandateUpdate, db: Session = Depends(get_db), current_user: User = Depends(require_write_access)):
    m = db.query(AutopayMandate).filter(AutopayMandate.id == mandate_id, AutopayMandate.user_id == current_user.id).first()
    if not m:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Mandate not found")
    data = payload.dict(exclude_unset=True)
    for field in ("bank_id", "merchant_name", "upi_vpa", "max_amount", "notes"):
        if field in data:
            setattr(m, field, data[field])
    if "frequency" in data and data["frequency"] in _FREQUENCIES:
        m.frequency = data["frequency"]
    if "status" in data and data["status"] in _STATUSES:
        m.status = data["status"]
    if "next_debit_date" in data:
        m.next_debit_date = _parse_date(data["next_debit_date"])
    m.updated_at = utcnow()
    db.commit()
    db.refresh(m)
    return _mandate_dict(m)


@router.delete("/{mandate_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_mandate(mandate_id: int, db: Session = Depends(get_db), current_user: User = Depends(require_write_access)):
    m = db.query(AutopayMandate).filter(AutopayMandate.id == mandate_id, AutopayMandate.user_id == current_user.id).first()
    if not m:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Mandate not found")
    db.delete(m)
    db.commit()
