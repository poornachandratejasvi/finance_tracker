"""Credit-card reward/loyalty points tracking (balance, expiring batches, manual
entries) -- see app.services.reward_points_service for the ledger logic."""
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.endpoints.auth import get_current_active_user, require_write_access
from app.core.database import get_db
from app.models.models import Bank, User
from app.services import reward_points_service

router = APIRouter()

VALID_ENTRY_TYPES = ("earned", "redeemed", "expired", "adjustment")


def _entry_response(e) -> dict:
    return {
        "id": e.id, "bank_id": e.bank_id, "entry_type": e.entry_type,
        "points": e.points, "expiry_date": e.expiry_date.isoformat() if e.expiry_date else None,
        "entry_date": e.entry_date.isoformat() if e.entry_date else None,
        "description": e.description, "source": e.source, "created_at": e.created_at.isoformat(),
    }


@router.get("/")
def list_reward_points(
    bank_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Per-card summaries (balance + upcoming expiring batches) plus the raw entry list."""
    summaries = reward_points_service.all_bank_summaries(db, current_user.id)
    entries = reward_points_service.list_entries(db, current_user.id, bank_id)
    return {
        "summaries": summaries,
        "entries": [_entry_response(e) for e in entries],
    }


@router.get("/monthly")
def monthly_reward_points(
    bank_id: Optional[int] = None,
    months: int = 12,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Per-month gained/used/expired/net totals, most recent month first."""
    return {"months": reward_points_service.monthly_summary(db, current_user.id, bank_id, months)}


class RewardEntryCreate(BaseModel):
    bank_id: int
    entry_type: str
    points: float
    expiry_date: Optional[datetime] = None
    description: Optional[str] = None


@router.post("/", status_code=status.HTTP_201_CREATED)
def create_reward_entry(
    payload: RewardEntryCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_write_access),
):
    if payload.entry_type not in VALID_ENTRY_TYPES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"entry_type must be one of {VALID_ENTRY_TYPES}")
    if payload.points <= 0:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "points must be a positive number")
    bank = db.query(Bank).filter(Bank.id == payload.bank_id, Bank.user_id == current_user.id).first()
    if not bank:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Bank not found")

    entry = reward_points_service.create_entry(
        db, current_user.id, payload.bank_id, payload.entry_type, payload.points,
        expiry_date=payload.expiry_date, description=payload.description,
    )
    return _entry_response(entry)


@router.delete("/{entry_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_reward_entry(
    entry_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_write_access),
):
    if not reward_points_service.delete_entry(db, current_user.id, entry_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Entry not found")


@router.post("/check-expiring")
def check_expiring_now(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Manually run the expiry-warning check for the caller's own entries right now."""
    return reward_points_service.check_expiring_reward_points(db, user_ids=[current_user.id])
