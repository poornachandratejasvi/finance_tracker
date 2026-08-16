"""Savings goals CRUD + progress."""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional
from datetime import datetime

from app.core.database import get_db
from app.core.time_utils import utcnow
from app.api.endpoints.auth import get_current_active_user, require_write_access
from app.models.models import User, SavingsGoal

router = APIRouter()


class GoalCreate(BaseModel):
    name: str
    target_amount: float
    current_amount: float = 0.0
    target_date: Optional[str] = None
    color: Optional[str] = "#4e79a7"


class GoalUpdate(BaseModel):
    name: Optional[str] = None
    target_amount: Optional[float] = None
    current_amount: Optional[float] = None
    target_date: Optional[str] = None
    color: Optional[str] = None
    is_active: Optional[bool] = None


def _parse_date(s: Optional[str]) -> Optional[datetime]:
    if not s:
        return None
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00")).replace(tzinfo=None)
    except (ValueError, TypeError):
        return None


def _to_dict(g: SavingsGoal) -> dict:
    pct = round((g.current_amount / g.target_amount) * 100, 1) if g.target_amount else 0.0
    return {
        "id": g.id,
        "name": g.name,
        "target_amount": g.target_amount,
        "current_amount": g.current_amount,
        "remaining": round((g.target_amount or 0) - (g.current_amount or 0), 2),
        "pct": min(100.0, pct),
        "target_date": g.target_date.isoformat() + "Z" if g.target_date else None,
        "color": g.color,
        "is_active": g.is_active,
        "created_at": g.created_at.isoformat() + "Z" if g.created_at else None,
    }


@router.get("/")
def list_goals(db: Session = Depends(get_db), current_user: User = Depends(get_current_active_user)):
    rows = db.query(SavingsGoal).filter(SavingsGoal.user_id == current_user.id).order_by(SavingsGoal.created_at.desc()).all()
    return [_to_dict(g) for g in rows]


@router.post("/", status_code=status.HTTP_201_CREATED)
def create_goal(payload: GoalCreate, db: Session = Depends(get_db), current_user: User = Depends(require_write_access)):
    g = SavingsGoal(
        user_id=current_user.id,
        name=payload.name,
        target_amount=payload.target_amount,
        current_amount=payload.current_amount or 0.0,
        target_date=_parse_date(payload.target_date),
        color=payload.color or "#4e79a7",
        is_active=True,
    )
    db.add(g)
    db.commit()
    db.refresh(g)
    return _to_dict(g)


@router.put("/{goal_id}")
def update_goal(goal_id: int, payload: GoalUpdate, db: Session = Depends(get_db), current_user: User = Depends(require_write_access)):
    g = db.query(SavingsGoal).filter(SavingsGoal.id == goal_id, SavingsGoal.user_id == current_user.id).first()
    if not g:
        raise HTTPException(status_code=404, detail="Goal not found")
    if payload.name is not None:
        g.name = payload.name
    if payload.target_amount is not None:
        g.target_amount = payload.target_amount
    if payload.current_amount is not None:
        g.current_amount = payload.current_amount
    if payload.target_date is not None:
        g.target_date = _parse_date(payload.target_date)
    if payload.color is not None:
        g.color = payload.color
    if payload.is_active is not None:
        g.is_active = payload.is_active
    g.updated_at = utcnow()
    db.commit()
    db.refresh(g)
    return _to_dict(g)


@router.delete("/{goal_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_goal(goal_id: int, db: Session = Depends(get_db), current_user: User = Depends(require_write_access)):
    g = db.query(SavingsGoal).filter(SavingsGoal.id == goal_id, SavingsGoal.user_id == current_user.id).first()
    if not g:
        raise HTTPException(status_code=404, detail="Goal not found")
    db.delete(g)
    db.commit()
