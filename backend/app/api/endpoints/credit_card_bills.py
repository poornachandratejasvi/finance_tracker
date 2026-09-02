"""Credit-card statement/due-date tracking -- read the bills, see candidate
payment matches, confirm which transaction paid one. See
credit_card_bill_service.py for the matching logic and calendar_service.py for
how these surface on the Calendar page."""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.api_auth import get_current_user_flexible, require_write_access_flexible
from app.models.models import User, CreditCardBill, Bank, Transaction

router = APIRouter()


class ConfirmPayment(BaseModel):
    transaction_id: int


def _bill_dict(b: CreditCardBill, bank_name: Optional[str] = None) -> dict:
    return {
        "id": b.id,
        "bank_id": b.bank_id,
        "bank_name": bank_name,
        "statement_date": b.statement_date.isoformat() if b.statement_date else None,
        "due_date": b.due_date.isoformat() if b.due_date else None,
        "total_amount_due": b.total_amount_due,
        "minimum_amount_due": b.minimum_amount_due,
        "payment_status": b.payment_status,
        "payment_transaction_id": b.payment_transaction_id,
    }


def _get_bill(db: Session, bill_id: int, user_id: int) -> CreditCardBill:
    b = db.query(CreditCardBill).filter(CreditCardBill.id == bill_id, CreditCardBill.user_id == user_id).first()
    if not b:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Bill not found")
    return b


@router.get("/")
def list_bills(
    unpaid_only: bool = Query(False),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_flexible),
):
    q = db.query(CreditCardBill, Bank.name).join(Bank, CreditCardBill.bank_id == Bank.id).filter(
        CreditCardBill.user_id == current_user.id
    )
    if unpaid_only:
        q = q.filter(CreditCardBill.payment_status == "unpaid")
    rows = q.order_by(CreditCardBill.due_date.desc()).all()
    return [_bill_dict(b, bank_name) for b, bank_name in rows]


@router.get("/{bill_id}/candidates")
def get_payment_candidates(bill_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user_flexible)):
    from app.services.credit_card_bill_service import find_payment_candidates

    bill = _get_bill(db, bill_id, current_user.id)
    candidates = find_payment_candidates(db, bill)
    return [
        {
            "id": t.id, "description": t.description, "amount": t.amount,
            "transaction_type": t.transaction_type.value if hasattr(t.transaction_type, "value") else t.transaction_type,
            "transaction_date": t.transaction_date.isoformat() if t.transaction_date else None,
            "bank_id": t.bank_id,
        }
        for t in candidates
    ]


@router.post("/{bill_id}/confirm-payment")
def confirm_payment(bill_id: int, payload: ConfirmPayment, db: Session = Depends(get_db), current_user: User = Depends(require_write_access_flexible)):
    from app.services.credit_card_bill_service import confirm_payment as _confirm

    bill = _get_bill(db, bill_id, current_user.id)
    txn = db.query(Transaction).filter(Transaction.id == payload.transaction_id, Transaction.user_id == current_user.id).first()
    if not txn:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Transaction not found")
    _confirm(db, bill, payload.transaction_id)
    db.refresh(bill)
    return _bill_dict(bill)


@router.post("/{bill_id}/mark-paid")
def mark_paid(bill_id: int, db: Session = Depends(get_db), current_user: User = Depends(require_write_access_flexible)):
    from app.services.credit_card_bill_service import mark_paid_manually

    bill = _get_bill(db, bill_id, current_user.id)
    mark_paid_manually(db, bill)
    db.refresh(bill)
    return _bill_dict(bill)
