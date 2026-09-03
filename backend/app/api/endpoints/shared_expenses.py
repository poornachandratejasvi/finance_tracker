"""Household expense splitting -- distinct from ious.py (people OUTSIDE the
app): every party here is a real User in the same household. See
app.core.household.household_user_ids for the "who can this be split with"
check reused throughout.
"""
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.time_utils import utcnow
from app.core.household import household_user_ids
from app.api.endpoints.auth import get_current_active_user, require_write_access
from app.models.models import User, SharedExpense, SharedExpenseShare

router = APIRouter()


def _parse_date(s: Optional[str]) -> Optional[datetime]:
    if not s:
        return None
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00")).replace(tzinfo=None)
    except (ValueError, TypeError):
        return None


class SplitEntry(BaseModel):
    user_id: int
    amount: float


class ExpenseCreate(BaseModel):
    description: str
    total_amount: float
    expense_date: str
    splits: List[SplitEntry]


def _expense_dict(e: SharedExpense) -> dict:
    return {
        "id": e.id,
        "description": e.description,
        "total_amount": e.total_amount,
        "expense_date": e.expense_date.strftime("%Y-%m-%d") if e.expense_date else None,
        "paid_by_user_id": e.paid_by_user_id,
        "paid_by_username": e.paid_by.username if e.paid_by else None,
        "shares": [
            {
                "id": s.id, "user_id": s.user_id,
                "username": s.user.username if s.user else None,
                "amount": s.share_amount, "is_settled": s.is_settled,
                "settled_at": s.settled_at.strftime("%Y-%m-%d") if s.settled_at else None,
            }
            for s in e.shares
        ],
    }


@router.get("/members")
def list_household_members(db: Session = Depends(get_db), current_user: User = Depends(get_current_active_user)):
    """Who a shared expense can be split with -- unlike family_dashboard.py
    (admin-only, combined balances), any household member can see this."""
    if not current_user.household_id:
        return []
    ids = household_user_ids(db, current_user)
    return [{"id": u.id, "username": u.username} for u in db.query(User).filter(User.id.in_(ids)).all()]


@router.get("/")
def list_shared_expenses(db: Session = Depends(get_db), current_user: User = Depends(get_current_active_user)):
    if not current_user.household_id:
        return []
    rows = (
        db.query(SharedExpense)
        .filter(SharedExpense.household_id == current_user.household_id)
        .order_by(SharedExpense.expense_date.desc())
        .all()
    )
    return [_expense_dict(e) for e in rows]


@router.post("/", status_code=status.HTTP_201_CREATED)
def create_shared_expense(payload: ExpenseCreate, db: Session = Depends(get_db), current_user: User = Depends(require_write_access)):
    if not current_user.household_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="You're not part of a household with anyone else yet.")
    if not payload.splits:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="At least one split is required.")

    valid_ids = set(household_user_ids(db, current_user))
    for split in payload.splits:
        if split.user_id not in valid_ids:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"User {split.user_id} is not in your household.")

    split_sum = round(sum(s.amount for s in payload.splits), 2)
    if abs(split_sum - round(payload.total_amount, 2)) > 0.01:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Splits sum to {split_sum}, not the total {payload.total_amount}.")

    expense_date = _parse_date(payload.expense_date) or utcnow()
    expense = SharedExpense(
        household_id=current_user.household_id, paid_by_user_id=current_user.id,
        description=payload.description.strip(), total_amount=payload.total_amount, expense_date=expense_date,
    )
    db.add(expense)
    db.flush()

    for split in payload.splits:
        is_payer = split.user_id == current_user.id
        db.add(SharedExpenseShare(
            shared_expense_id=expense.id, user_id=split.user_id, share_amount=split.amount,
            is_settled=is_payer, settled_at=utcnow() if is_payer else None,
        ))
    db.commit()
    db.refresh(expense)
    return _expense_dict(expense)


@router.post("/{expense_id}/shares/{share_id}/settle")
def settle_share(expense_id: int, share_id: int, db: Session = Depends(get_db), current_user: User = Depends(require_write_access)):
    expense = db.query(SharedExpense).filter(SharedExpense.id == expense_id, SharedExpense.household_id == current_user.household_id).first()
    if not expense:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Shared expense not found")
    share = next((s for s in expense.shares if s.id == share_id), None)
    if not share:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Share not found")
    share.is_settled = True
    share.settled_at = utcnow()
    db.commit()
    return _expense_dict(expense)


@router.delete("/{expense_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_shared_expense(expense_id: int, db: Session = Depends(get_db), current_user: User = Depends(require_write_access)):
    expense = db.query(SharedExpense).filter(SharedExpense.id == expense_id, SharedExpense.household_id == current_user.household_id).first()
    if not expense:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Shared expense not found")
    db.delete(expense)
    db.commit()
