"""Subscription/bill CRUD for the Calendar page -- manual entries plus a
one-click 'Track as Subscription' action fed from the existing
detect_recurring() pattern list (see /from-pattern)."""
from datetime import datetime, timedelta
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.time_utils import utcnow
from app.api.endpoints.auth import get_current_active_user, require_write_access
from app.models.models import User, Subscription

router = APIRouter()

# detect_recurring()'s _FREQ_BANDS includes 'daily', which has no matching
# Subscription.recurrence bucket -- map it to the closest supported one rather
# than reject it (a genuinely daily pattern is a poor fit for calendar-tracking
# at daily granularity anyway, weekly is close enough for a reminder).
_FREQUENCY_TO_RECURRENCE = {"daily": "weekly", "weekly": "weekly", "monthly": "monthly", "yearly": "yearly"}


def _parse_date(s: Optional[str]) -> Optional[datetime]:
    if not s:
        return None
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00")).replace(tzinfo=None)
    except (ValueError, TypeError):
        return None


class SubscriptionCreate(BaseModel):
    name: str
    item_type: Optional[str] = "subscription"
    amount: Optional[float] = None
    due_date: str
    recurrence: Optional[str] = "none"
    notes: Optional[str] = None


class SubscriptionUpdate(BaseModel):
    name: Optional[str] = None
    item_type: Optional[str] = None
    amount: Optional[float] = None
    due_date: Optional[str] = None
    recurrence: Optional[str] = None
    notes: Optional[str] = None
    is_active: Optional[bool] = None


class PatternInput(BaseModel):
    """Mirrors the exact dict shape GET /api/watchers/detect-recurring returns
    (see recurring_detection.detect_recurring / RecurringTransactionsCard.jsx)."""
    sample_description: Optional[str] = None
    signature: Optional[str] = None
    amount: Optional[float] = None
    frequency: Optional[str] = None
    last_date: Optional[str] = None
    median_gap_days: Optional[float] = None
    bank_id: Optional[int] = None
    transaction_type: Optional[str] = None
    occurrences: Optional[int] = None
    first_date: Optional[str] = None
    bank_name: Optional[str] = None
    suggested_keywords: Optional[List[str]] = None


def _subscription_dict(s: Subscription) -> dict:
    return {
        "id": s.id,
        "name": s.name,
        "item_type": s.item_type,
        "amount": s.amount,
        "due_date": s.due_date.isoformat() if s.due_date else None,
        "recurrence": s.recurrence,
        "notes": s.notes,
        "is_active": s.is_active,
        "source": s.source,
        "created_at": s.created_at.isoformat() if s.created_at else None,
    }


def _get_subscription(db: Session, subscription_id: int, user_id: int) -> Subscription:
    s = db.query(Subscription).filter(Subscription.id == subscription_id, Subscription.user_id == user_id).first()
    if not s:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Subscription not found")
    return s


@router.get("/")
def list_subscriptions(db: Session = Depends(get_db), current_user: User = Depends(get_current_active_user)):
    rows = db.query(Subscription).filter(Subscription.user_id == current_user.id).order_by(Subscription.due_date.asc()).all()
    return [_subscription_dict(s) for s in rows]


@router.post("/", status_code=status.HTTP_201_CREATED)
def create_subscription(payload: SubscriptionCreate, db: Session = Depends(get_db), current_user: User = Depends(require_write_access)):
    due_date = _parse_date(payload.due_date)
    if not due_date:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="A valid due_date is required.")
    s = Subscription(
        user_id=current_user.id,
        name=payload.name,
        item_type=payload.item_type or "subscription",
        amount=payload.amount,
        due_date=due_date,
        recurrence=payload.recurrence or "none",
        notes=payload.notes,
        source="manual",
    )
    db.add(s)
    db.commit()
    db.refresh(s)
    return _subscription_dict(s)


@router.put("/{subscription_id}")
def update_subscription(subscription_id: int, payload: SubscriptionUpdate, db: Session = Depends(get_db), current_user: User = Depends(require_write_access)):
    s = _get_subscription(db, subscription_id, current_user.id)
    data = payload.dict(exclude_unset=True)
    for field in ("name", "item_type", "amount", "recurrence", "notes", "is_active"):
        if field in data:
            setattr(s, field, data[field])
    if "due_date" in data:
        parsed = _parse_date(data["due_date"])
        if parsed:
            s.due_date = parsed
    s.updated_at = utcnow()
    db.commit()
    db.refresh(s)
    return _subscription_dict(s)


@router.delete("/{subscription_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_subscription(subscription_id: int, db: Session = Depends(get_db), current_user: User = Depends(require_write_access)):
    s = _get_subscription(db, subscription_id, current_user.id)
    db.delete(s)
    db.commit()


@router.post("/from-pattern", status_code=status.HTTP_201_CREATED)
def create_subscription_from_pattern(payload: PatternInput, db: Session = Depends(get_db), current_user: User = Depends(require_write_access)):
    """One-click 'Track as Subscription' from a detected recurring-transaction
    pattern -- same due-date math as recurring_detection.check_upcoming_renewals."""
    last_date = _parse_date(payload.last_date)
    if not last_date:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Pattern is missing last_date.")

    recurrence = _FREQUENCY_TO_RECURRENCE.get(payload.frequency or "", "monthly")
    due_date = last_date + timedelta(days=payload.median_gap_days or 30)

    s = Subscription(
        user_id=current_user.id,
        name=payload.sample_description or payload.signature or "Recurring transaction",
        item_type="subscription",
        amount=payload.amount,
        due_date=due_date,
        recurrence=recurrence,
        source="suggested",
    )
    db.add(s)
    db.commit()
    db.refresh(s)
    return _subscription_dict(s)
