"""Planned expenses/income CRUD + per-cycle settlement (map to a transaction,
or close manually) -- see planned_item_service.py for the matching logic and
calendar_service.py for how these surface on the Calendar page."""
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.time_utils import utcnow
from app.core.api_auth import get_current_user_flexible, require_write_access_flexible
from app.models.models import User, PlannedItem, PlannedItemOccurrence, Transaction

router = APIRouter()


def _parse_date(s: Optional[str]) -> Optional[datetime]:
    if not s:
        return None
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00")).replace(tzinfo=None)
    except (ValueError, TypeError):
        return None


class PlannedItemCreate(BaseModel):
    name: str
    direction: Optional[str] = "expense"
    amount: Optional[float] = None
    match_hint: Optional[str] = None
    due_date: str
    recurrence: Optional[str] = "monthly"
    notes: Optional[str] = None


class PlannedItemUpdate(BaseModel):
    name: Optional[str] = None
    direction: Optional[str] = None
    amount: Optional[float] = None
    match_hint: Optional[str] = None
    due_date: Optional[str] = None
    recurrence: Optional[str] = None
    notes: Optional[str] = None
    is_active: Optional[bool] = None


class ConfirmMatch(BaseModel):
    transaction_id: int


def _occurrence_dict(o: PlannedItemOccurrence) -> dict:
    return {
        "id": o.id,
        "planned_item_id": o.planned_item_id,
        "due_date": o.due_date.isoformat() if o.due_date else None,
        "expected_amount": o.expected_amount,
        "status": o.status,
        "matched_transaction_id": o.matched_transaction_id,
        "closed_at": o.closed_at.isoformat() if o.closed_at else None,
    }


def _item_dict(item: PlannedItem, current: Optional[PlannedItemOccurrence] = None) -> dict:
    return {
        "id": item.id,
        "name": item.name,
        "direction": item.direction,
        "amount": item.amount,
        "match_hint": item.match_hint,
        "due_date": item.due_date.isoformat() if item.due_date else None,
        "recurrence": item.recurrence,
        "is_active": item.is_active,
        "notes": item.notes,
        "created_at": item.created_at.isoformat() if item.created_at else None,
        "current_occurrence": _occurrence_dict(current) if current else None,
    }


def _get_item(db: Session, item_id: int, user_id: int) -> PlannedItem:
    item = db.query(PlannedItem).filter(PlannedItem.id == item_id, PlannedItem.user_id == user_id).first()
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Planned item not found")
    return item


def _get_occurrence(db: Session, occurrence_id: int, user_id: int) -> PlannedItemOccurrence:
    o = (
        db.query(PlannedItemOccurrence)
        .filter(PlannedItemOccurrence.id == occurrence_id, PlannedItemOccurrence.user_id == user_id)
        .first()
    )
    if not o:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Occurrence not found")
    return o


def _nearest_open_occurrence(db: Session, item_id: int) -> Optional[PlannedItemOccurrence]:
    """The soonest-due not-yet-closed occurrence, falling back to the most
    recently closed/matched one if every occurrence on file is settled."""
    row = (
        db.query(PlannedItemOccurrence)
        .filter(PlannedItemOccurrence.planned_item_id == item_id, PlannedItemOccurrence.status == "open")
        .order_by(PlannedItemOccurrence.due_date.asc())
        .first()
    )
    if row:
        return row
    return (
        db.query(PlannedItemOccurrence)
        .filter(PlannedItemOccurrence.planned_item_id == item_id)
        .order_by(PlannedItemOccurrence.due_date.desc())
        .first()
    )


@router.get("/")
def list_planned_items(db: Session = Depends(get_db), current_user: User = Depends(get_current_user_flexible)):
    from app.services.planned_item_service import ensure_occurrences

    items = (
        db.query(PlannedItem)
        .filter(PlannedItem.user_id == current_user.id)
        .order_by(PlannedItem.due_date.asc())
        .all()
    )
    for item in items:
        ensure_occurrences(db, item)
    db.commit()

    return [_item_dict(item, _nearest_open_occurrence(db, item.id)) for item in items]


@router.post("/", status_code=status.HTTP_201_CREATED)
def create_planned_item(payload: PlannedItemCreate, db: Session = Depends(get_db), current_user: User = Depends(require_write_access_flexible)):
    from app.services.planned_item_service import ensure_occurrences

    due_date = _parse_date(payload.due_date)
    if not due_date:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="A valid due_date is required.")
    if payload.direction not in ("expense", "income"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="direction must be 'expense' or 'income'.")

    item = PlannedItem(
        user_id=current_user.id,
        name=payload.name,
        direction=payload.direction or "expense",
        amount=payload.amount,
        match_hint=payload.match_hint,
        due_date=due_date,
        recurrence=payload.recurrence or "monthly",
        notes=payload.notes,
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    ensure_occurrences(db, item)
    db.commit()
    return _item_dict(item, _nearest_open_occurrence(db, item.id))


@router.put("/{item_id}")
def update_planned_item(item_id: int, payload: PlannedItemUpdate, db: Session = Depends(get_db), current_user: User = Depends(require_write_access_flexible)):
    item = _get_item(db, item_id, current_user.id)
    data = payload.dict(exclude_unset=True)
    if "direction" in data and data["direction"] not in ("expense", "income"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="direction must be 'expense' or 'income'.")
    for field in ("name", "direction", "amount", "match_hint", "recurrence", "notes", "is_active"):
        if field in data:
            setattr(item, field, data[field])
    if "due_date" in data:
        parsed = _parse_date(data["due_date"])
        if parsed:
            item.due_date = parsed
    item.updated_at = utcnow()
    db.commit()
    db.refresh(item)
    return _item_dict(item, _nearest_open_occurrence(db, item.id))


@router.delete("/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_planned_item(item_id: int, db: Session = Depends(get_db), current_user: User = Depends(require_write_access_flexible)):
    item = _get_item(db, item_id, current_user.id)
    db.delete(item)
    db.commit()


@router.get("/{item_id}/occurrences")
def list_occurrences(item_id: int, limit: int = Query(12, le=100), db: Session = Depends(get_db), current_user: User = Depends(get_current_user_flexible)):
    _get_item(db, item_id, current_user.id)
    rows = (
        db.query(PlannedItemOccurrence)
        .filter(PlannedItemOccurrence.planned_item_id == item_id)
        .order_by(PlannedItemOccurrence.due_date.desc())
        .limit(limit)
        .all()
    )
    return [_occurrence_dict(o) for o in rows]


@router.get("/occurrences/{occurrence_id}/candidates")
def get_occurrence_candidates(occurrence_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user_flexible)):
    from app.services.planned_item_service import find_candidates

    occurrence = _get_occurrence(db, occurrence_id, current_user.id)
    candidates = find_candidates(db, occurrence)
    return [
        {
            "id": t.id, "description": t.description, "amount": t.amount,
            "transaction_type": t.transaction_type.value if hasattr(t.transaction_type, "value") else t.transaction_type,
            "transaction_date": t.transaction_date.isoformat() if t.transaction_date else None,
            "bank_id": t.bank_id,
        }
        for t in candidates
    ]


@router.post("/occurrences/{occurrence_id}/confirm")
def confirm_occurrence(occurrence_id: int, payload: ConfirmMatch, db: Session = Depends(get_db), current_user: User = Depends(require_write_access_flexible)):
    from app.services.planned_item_service import confirm_match

    occurrence = _get_occurrence(db, occurrence_id, current_user.id)
    txn = db.query(Transaction).filter(Transaction.id == payload.transaction_id, Transaction.user_id == current_user.id).first()
    if not txn:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Transaction not found")
    confirm_match(db, occurrence, payload.transaction_id)
    db.refresh(occurrence)
    return _occurrence_dict(occurrence)


@router.post("/occurrences/{occurrence_id}/close")
def close_occurrence_endpoint(occurrence_id: int, db: Session = Depends(get_db), current_user: User = Depends(require_write_access_flexible)):
    from app.services.planned_item_service import close_occurrence

    occurrence = _get_occurrence(db, occurrence_id, current_user.id)
    close_occurrence(db, occurrence)
    db.refresh(occurrence)
    return _occurrence_dict(occurrence)


@router.get("/summary")
def planned_items_summary(month: Optional[str] = Query(None, description="YYYY-MM, defaults to the current month"), db: Session = Depends(get_db), current_user: User = Depends(get_current_user_flexible)):
    from calendar import monthrange

    if month:
        try:
            year, mon = (int(p) for p in month.split("-"))
        except (ValueError, TypeError):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="month must be YYYY-MM.")
    else:
        now = utcnow()
        year, mon = now.year, now.month

    start = datetime(year, mon, 1)
    end = datetime(year, mon, monthrange(year, mon)[1], 23, 59, 59)

    rows = (
        db.query(PlannedItemOccurrence, PlannedItem.direction)
        .join(PlannedItem, PlannedItemOccurrence.planned_item_id == PlannedItem.id)
        .filter(
            PlannedItemOccurrence.user_id == current_user.id,
            PlannedItemOccurrence.due_date >= start,
            PlannedItemOccurrence.due_date <= end,
        )
        .all()
    )

    planned_income = sum((o.expected_amount or 0) for o, direction in rows if direction == "income")
    planned_expense = sum((o.expected_amount or 0) for o, direction in rows if direction == "expense")
    open_count = sum(1 for o, _ in rows if o.status == "open")

    return {
        "month": f"{year:04d}-{mon:02d}",
        "planned_income": planned_income,
        "planned_expense": planned_expense,
        "open_count": open_count,
        "total_count": len(rows),
    }
