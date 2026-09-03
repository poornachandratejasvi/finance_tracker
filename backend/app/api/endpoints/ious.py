"""Money lent to or borrowed from a specific person (assumed not an app user)
-- CRUD plus a repayment sub-ledger (IouPayment) so outstanding_amount is never
mutated blindly. Distinct from formal Bank-tracked debt (debt.py)."""
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.time_utils import utcnow
from app.api.endpoints.auth import get_current_active_user, require_write_access
from app.models.models import User, Iou, IouPayment

router = APIRouter()

_DIRECTIONS = {"lent", "borrowed"}


def _parse_date(s: Optional[str]) -> Optional[datetime]:
    if not s:
        return None
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00")).replace(tzinfo=None)
    except (ValueError, TypeError):
        return None


class IouCreate(BaseModel):
    person_name: str
    direction: str  # lent|borrowed
    principal_amount: float
    iou_date: str
    due_date: Optional[str] = None
    notes: Optional[str] = None


class IouUpdate(BaseModel):
    person_name: Optional[str] = None
    due_date: Optional[str] = None
    notes: Optional[str] = None
    status: Optional[str] = None


class PaymentCreate(BaseModel):
    amount: float
    payment_date: str
    notes: Optional[str] = None


def _iou_dict(i: Iou) -> dict:
    return {
        "id": i.id,
        "person_name": i.person_name,
        "direction": i.direction,
        "principal_amount": i.principal_amount,
        "outstanding_amount": round(i.outstanding_amount, 2),
        "iou_date": i.iou_date.strftime("%Y-%m-%d") if i.iou_date else None,
        "due_date": i.due_date.strftime("%Y-%m-%d") if i.due_date else None,
        "status": i.status,
        "notes": i.notes,
    }


def _get_iou(db: Session, iou_id: int, user_id: int) -> Iou:
    i = db.query(Iou).filter(Iou.id == iou_id, Iou.user_id == user_id).first()
    if not i:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="IOU not found")
    return i


@router.get("/")
def list_ious(
    status_filter: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    query = db.query(Iou).filter(Iou.user_id == current_user.id)
    if status_filter:
        query = query.filter(Iou.status == status_filter)
    rows = query.order_by(Iou.status.asc(), Iou.due_date.asc().nullslast()).all()
    open_rows = [i for i in rows if i.status == "open"]
    total_owed_to_me = sum(i.outstanding_amount for i in open_rows if i.direction == "lent")
    total_i_owe = sum(i.outstanding_amount for i in open_rows if i.direction == "borrowed")
    return {
        "items": [_iou_dict(i) for i in rows],
        "total_owed_to_me": round(total_owed_to_me, 2),
        "total_i_owe": round(total_i_owe, 2),
    }


@router.post("/", status_code=status.HTTP_201_CREATED)
def create_iou(payload: IouCreate, db: Session = Depends(get_db), current_user: User = Depends(require_write_access)):
    if payload.direction not in _DIRECTIONS:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="direction must be 'lent' or 'borrowed'")
    iou_date = _parse_date(payload.iou_date)
    if iou_date is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="iou_date is required")
    i = Iou(
        user_id=current_user.id,
        person_name=payload.person_name.strip(),
        direction=payload.direction,
        principal_amount=payload.principal_amount,
        outstanding_amount=payload.principal_amount,
        iou_date=iou_date,
        due_date=_parse_date(payload.due_date),
        notes=payload.notes,
        status="open",
    )
    db.add(i)
    db.commit()
    db.refresh(i)
    return _iou_dict(i)


@router.put("/{iou_id}")
def update_iou(iou_id: int, payload: IouUpdate, db: Session = Depends(get_db), current_user: User = Depends(require_write_access)):
    i = _get_iou(db, iou_id, current_user.id)
    data = payload.dict(exclude_unset=True)
    for field in ("person_name", "notes"):
        if field in data:
            setattr(i, field, data[field])
    if "due_date" in data:
        i.due_date = _parse_date(data["due_date"])
    if "status" in data and data["status"] in ("open", "settled"):
        i.status = data["status"]
    i.updated_at = utcnow()
    db.commit()
    db.refresh(i)
    return _iou_dict(i)


@router.delete("/{iou_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_iou(iou_id: int, db: Session = Depends(get_db), current_user: User = Depends(require_write_access)):
    i = _get_iou(db, iou_id, current_user.id)
    db.delete(i)
    db.commit()


@router.get("/{iou_id}/payments")
def list_payments(iou_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_active_user)):
    _get_iou(db, iou_id, current_user.id)
    rows = db.query(IouPayment).filter(IouPayment.iou_id == iou_id).order_by(IouPayment.payment_date.desc()).all()
    return [
        {"id": p.id, "amount": p.amount, "payment_date": p.payment_date.strftime("%Y-%m-%d"), "notes": p.notes}
        for p in rows
    ]


@router.post("/{iou_id}/record-payment", status_code=status.HTTP_201_CREATED)
def record_payment(iou_id: int, payload: PaymentCreate, db: Session = Depends(get_db), current_user: User = Depends(require_write_access)):
    i = _get_iou(db, iou_id, current_user.id)
    payment_date = _parse_date(payload.payment_date)
    if payment_date is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="payment_date is required")
    payment = IouPayment(iou_id=iou_id, amount=payload.amount, payment_date=payment_date, notes=payload.notes)
    db.add(payment)
    i.outstanding_amount = max(0.0, i.outstanding_amount - payload.amount)
    if i.outstanding_amount <= 0.01:
        i.outstanding_amount = 0.0
        i.status = "settled"
    i.updated_at = utcnow()
    db.commit()
    db.refresh(i)
    return _iou_dict(i)
