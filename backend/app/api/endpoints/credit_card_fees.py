"""Credit-card annual-fee / fee-waiver config -- a different lifecycle than
CreditCardBill's per-statement-cycle due dates (once/year, independent of
statement cycles, often with a spend-based waiver condition), so this is a
separate 1:1-per-Bank config row rather than a CreditCardBill field.
"""
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.time_utils import utcnow
from app.api.endpoints.auth import get_current_active_user, require_write_access
from app.models.models import User, CreditCardFee, Bank, Transaction

router = APIRouter()


def _parse_date(s: Optional[str]) -> Optional[datetime]:
    if not s:
        return None
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00")).replace(tzinfo=None)
    except (ValueError, TypeError):
        return None


class FeeCreate(BaseModel):
    bank_id: int
    annual_fee_amount: float
    fee_anniversary_date: str
    waiver_spend_threshold: Optional[float] = None
    notes: Optional[str] = None


class FeeUpdate(BaseModel):
    annual_fee_amount: Optional[float] = None
    fee_anniversary_date: Optional[str] = None
    waiver_spend_threshold: Optional[float] = None
    notes: Optional[str] = None


def _fee_dict(db: Session, f: CreditCardFee, bank: Optional[Bank] = None) -> dict:
    from app.services.calendar_service import add_calendar_months

    now = utcnow()
    # Project the next annual occurrence the same way calendar_service already
    # projects future credit-card due dates -- step forward by 12-month
    # increments (one full year per step) from the last known anniversary
    # until it's in the future.
    next_date = f.fee_anniversary_date
    n = 0
    while next_date < now:
        n += 1
        next_date = add_calendar_months(f.fee_anniversary_date, 12 * n)
    last_anniversary = add_calendar_months(f.fee_anniversary_date, 12 * (n - 1)) if n > 0 else f.fee_anniversary_date
    txns = db.query(Transaction).filter(
        Transaction.bank_id == f.bank_id, Transaction.user_id == f.user_id,
        Transaction.transaction_date >= last_anniversary, Transaction.transaction_type == "debit",
    ).all()
    spend_since_anniversary = sum(t.amount or 0.0 for t in txns)

    waiver_progress_pct = None
    if f.waiver_spend_threshold:
        waiver_progress_pct = round(min(100.0, spend_since_anniversary / f.waiver_spend_threshold * 100), 1)

    return {
        "id": f.id,
        "bank_id": f.bank_id,
        "bank_name": bank.name if bank else None,
        "annual_fee_amount": f.annual_fee_amount,
        "fee_anniversary_date": f.fee_anniversary_date.strftime("%Y-%m-%d"),
        "next_fee_date": next_date.strftime("%Y-%m-%d"),
        "waiver_spend_threshold": f.waiver_spend_threshold,
        "spend_since_anniversary": round(spend_since_anniversary, 2),
        "waiver_progress_pct": waiver_progress_pct,
        "notes": f.notes,
    }


@router.get("/")
def list_fees(db: Session = Depends(get_db), current_user: User = Depends(get_current_active_user)):
    rows = (
        db.query(CreditCardFee, Bank)
        .join(Bank, CreditCardFee.bank_id == Bank.id)
        .filter(CreditCardFee.user_id == current_user.id)
        .all()
    )
    return [_fee_dict(db, f, bank) for f, bank in rows]


@router.post("/", status_code=status.HTTP_201_CREATED)
def create_fee(payload: FeeCreate, db: Session = Depends(get_db), current_user: User = Depends(require_write_access)):
    bank = db.query(Bank).filter(Bank.id == payload.bank_id, Bank.user_id == current_user.id).first()
    if not bank:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Bank not found")
    existing = db.query(CreditCardFee).filter(CreditCardFee.bank_id == payload.bank_id).first()
    if existing:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="This card already has fee config -- edit it instead.")
    anniversary = _parse_date(payload.fee_anniversary_date)
    if anniversary is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="fee_anniversary_date is required")
    f = CreditCardFee(
        bank_id=payload.bank_id, user_id=current_user.id,
        annual_fee_amount=payload.annual_fee_amount, fee_anniversary_date=anniversary,
        waiver_spend_threshold=payload.waiver_spend_threshold, notes=payload.notes,
    )
    db.add(f)
    db.commit()
    db.refresh(f)
    return _fee_dict(db, f, bank)


@router.put("/{bank_id}")
def update_fee(bank_id: int, payload: FeeUpdate, db: Session = Depends(get_db), current_user: User = Depends(require_write_access)):
    f = db.query(CreditCardFee).filter(CreditCardFee.bank_id == bank_id, CreditCardFee.user_id == current_user.id).first()
    if not f:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No fee config for this card")
    data = payload.dict(exclude_unset=True)
    for field in ("annual_fee_amount", "waiver_spend_threshold", "notes"):
        if field in data:
            setattr(f, field, data[field])
    if "fee_anniversary_date" in data:
        parsed = _parse_date(data["fee_anniversary_date"])
        if parsed:
            f.fee_anniversary_date = parsed
    f.updated_at = utcnow()
    db.commit()
    db.refresh(f)
    bank = db.query(Bank).filter(Bank.id == bank_id).first()
    return _fee_dict(db, f, bank)


@router.delete("/{bank_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_fee(bank_id: int, db: Session = Depends(get_db), current_user: User = Depends(require_write_access)):
    f = db.query(CreditCardFee).filter(CreditCardFee.bank_id == bank_id, CreditCardFee.user_id == current_user.id).first()
    if not f:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No fee config for this card")
    db.delete(f)
    db.commit()
