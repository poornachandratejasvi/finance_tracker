"""Savings goals CRUD + progress, plus round-up savings (round each new debit
transaction up to the nearest configurable amount and sweep the difference
into a goal). This is pure bookkeeping -- no real money moves anywhere,
consistent with the rest of this app never touching actual bank rails."""
import math
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional
from datetime import datetime, timedelta

from app.core.database import get_db
from app.core.time_utils import utcnow
from app.api.endpoints.auth import get_current_active_user, require_write_access
from app.models.models import User, SavingsGoal, SavingsGoalContribution, Transaction, TransactionType, Bank

router = APIRouter()


class GoalCreate(BaseModel):
    name: str
    target_amount: float
    current_amount: float = 0.0
    target_date: Optional[str] = None
    color: Optional[str] = "#4e79a7"
    roundup_enabled: bool = False
    roundup_to: int = 10
    monthly_target: Optional[float] = None


class GoalUpdate(BaseModel):
    name: Optional[str] = None
    target_amount: Optional[float] = None
    current_amount: Optional[float] = None
    target_date: Optional[str] = None
    color: Optional[str] = None
    is_active: Optional[bool] = None
    roundup_enabled: Optional[bool] = None
    roundup_to: Optional[int] = None
    monthly_target: Optional[float] = None


def _parse_date(s: Optional[str]) -> Optional[datetime]:
    if not s:
        return None
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00")).replace(tzinfo=None)
    except (ValueError, TypeError):
        return None


def _month_bounds(now: datetime = None):
    now = now or utcnow()
    start = datetime(now.year, now.month, 1)
    end = datetime(now.year + 1, 1, 1) if now.month == 12 else datetime(now.year, now.month + 1, 1)
    return start, end


def _this_month_saved(db: Session, goal_id: int) -> float:
    start, end = _month_bounds()
    return float(
        db.query(func.coalesce(func.sum(SavingsGoalContribution.amount), 0.0))
        .filter(
            SavingsGoalContribution.goal_id == goal_id,
            SavingsGoalContribution.contributed_at >= start,
            SavingsGoalContribution.contributed_at < end,
        ).scalar() or 0.0
    )


def _to_dict(db: Session, g: SavingsGoal) -> dict:
    pct = round((g.current_amount / g.target_amount) * 100, 1) if g.target_amount else 0.0
    this_month_saved = round(_this_month_saved(db, g.id), 2) if g.monthly_target else None
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
        "roundup_enabled": g.roundup_enabled,
        "roundup_to": g.roundup_to,
        "monthly_target": g.monthly_target,
        "this_month_saved": this_month_saved,
        "monthly_target_met": (this_month_saved >= g.monthly_target) if g.monthly_target else None,
        "created_at": g.created_at.isoformat() + "Z" if g.created_at else None,
    }


@router.get("/")
def list_goals(db: Session = Depends(get_db), current_user: User = Depends(get_current_active_user)):
    rows = db.query(SavingsGoal).filter(SavingsGoal.user_id == current_user.id).order_by(SavingsGoal.created_at.desc()).all()
    return [_to_dict(db, g) for g in rows]


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
        roundup_enabled=payload.roundup_enabled,
        roundup_to=payload.roundup_to or 10,
        monthly_target=payload.monthly_target,
    )
    db.add(g)
    db.commit()
    db.refresh(g)
    return _to_dict(db, g)


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
    if payload.roundup_enabled is not None:
        g.roundup_enabled = payload.roundup_enabled
    if payload.roundup_to is not None:
        g.roundup_to = payload.roundup_to
    if payload.monthly_target is not None:
        g.monthly_target = payload.monthly_target
    g.updated_at = utcnow()
    db.commit()
    db.refresh(g)
    return _to_dict(db, g)


class ContributeRequest(BaseModel):
    amount: float


@router.post("/{goal_id}/contribute")
def contribute_to_goal(
    goal_id: int, payload: ContributeRequest,
    db: Session = Depends(get_db), current_user: User = Depends(require_write_access),
):
    """Manually record money saved toward this goal -- adds to current_amount
    and logs a SavingsGoalContribution so it counts toward monthly_target."""
    if payload.amount <= 0:
        raise HTTPException(status_code=400, detail="Amount must be greater than zero.")
    g = db.query(SavingsGoal).filter(SavingsGoal.id == goal_id, SavingsGoal.user_id == current_user.id).first()
    if not g:
        raise HTTPException(status_code=404, detail="Goal not found")
    g.current_amount = round((g.current_amount or 0.0) + payload.amount, 2)
    g.updated_at = utcnow()
    db.add(SavingsGoalContribution(goal_id=g.id, user_id=current_user.id, amount=payload.amount, source="manual"))
    db.commit()
    db.refresh(g)
    return _to_dict(db, g)


@router.delete("/{goal_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_goal(goal_id: int, db: Session = Depends(get_db), current_user: User = Depends(require_write_access)):
    g = db.query(SavingsGoal).filter(SavingsGoal.id == goal_id, SavingsGoal.user_id == current_user.id).first()
    if not g:
        raise HTTPException(status_code=404, detail="Goal not found")
    db.delete(g)
    db.commit()


def _roundup_amount(amount: float, to: int) -> float:
    """The spare change from rounding amount up to the nearest `to` (e.g. amount=243,
    to=10 -> 7). Already-round amounts contribute 0, not a full `to` extra."""
    if to <= 0:
        return 0.0
    rounded = math.ceil(amount / to) * to
    return round(rounded - amount, 2)


def _unswept_debits(db: Session, user_id: int):
    return (
        db.query(Transaction)
        .filter(
            Transaction.user_id == user_id,
            Transaction.transaction_type == TransactionType.DEBIT,
            Transaction.roundup_swept.isnot(True),
        )
        .all()
    )


@router.get("/{goal_id}/roundup-preview")
def roundup_preview(goal_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_active_user)):
    """How much would sweeping right now add -- read-only, doesn't mark anything swept."""
    g = db.query(SavingsGoal).filter(SavingsGoal.id == goal_id, SavingsGoal.user_id == current_user.id).first()
    if not g:
        raise HTTPException(status_code=404, detail="Goal not found")
    txns = _unswept_debits(db, current_user.id)
    total = round(sum(_roundup_amount(t.amount, g.roundup_to) for t in txns), 2)
    return {"pending_amount": total, "transaction_count": len(txns), "roundup_to": g.roundup_to}


@router.post("/{goal_id}/sweep-roundups")
def sweep_roundups(goal_id: int, db: Session = Depends(get_db), current_user: User = Depends(require_write_access)):
    """Round every not-yet-swept debit up to the goal's roundup_to and add the
    spare change to current_amount, marking those transactions swept so a
    second sweep (or another goal's sweep) never double-counts them."""
    g = db.query(SavingsGoal).filter(SavingsGoal.id == goal_id, SavingsGoal.user_id == current_user.id).first()
    if not g:
        raise HTTPException(status_code=404, detail="Goal not found")
    txns = _unswept_debits(db, current_user.id)
    total = 0.0
    for t in txns:
        total += _roundup_amount(t.amount, g.roundup_to)
        t.roundup_swept = True
    total = round(total, 2)
    g.current_amount = round((g.current_amount or 0.0) + total, 2)
    g.updated_at = utcnow()
    if total > 0:
        db.add(SavingsGoalContribution(goal_id=g.id, user_id=current_user.id, amount=total, source="roundup"))
    db.commit()
    db.refresh(g)
    return {"swept_amount": total, "transaction_count": len(txns), "goal": _to_dict(db, g)}


def _safe_to_save(db: Session, user_id: int) -> dict:
    """'Safe to save' = liquid (savings-type account) balance minus a buffer equal
    to the trailing 3-month average monthly debit spend -- a simple, transparent
    forecast (no per-merchant recurring-pattern modeling) of what's needed to
    cover the upcoming month's bills, so only genuine surplus gets swept."""
    liquid_balance = float(
        db.query(func.coalesce(func.sum(Bank.current_balance), 0.0))
        .filter(Bank.user_id == user_id, Bank.bank_type == "savings", Bank.is_active == True)  # noqa: E712
        .scalar() or 0.0
    )
    since = utcnow() - timedelta(days=90)
    total_debit_90d = float(
        db.query(func.coalesce(func.sum(Transaction.amount), 0.0))
        .filter(
            Transaction.user_id == user_id,
            Transaction.transaction_type == TransactionType.DEBIT,
            Transaction.transaction_date >= since,
        ).scalar() or 0.0
    )
    avg_monthly_spend = round(total_debit_90d / 3, 2)
    safe_to_save = round(max(0.0, liquid_balance - avg_monthly_spend), 2)
    return {
        "liquid_balance": round(liquid_balance, 2),
        "avg_monthly_spend": avg_monthly_spend,
        "safe_to_save": safe_to_save,
    }


@router.get("/predictive-sweep-preview")
def predictive_sweep_preview(db: Session = Depends(get_db), current_user: User = Depends(get_current_active_user)):
    """How much could safely be swept into savings right now -- read-only."""
    return _safe_to_save(db, current_user.id)


class PredictiveSweepRequest(BaseModel):
    amount: Optional[float] = None  # defaults to the full computed safe_to_save if omitted


@router.post("/{goal_id}/predictive-sweep")
def predictive_sweep(
    goal_id: int, payload: PredictiveSweepRequest = PredictiveSweepRequest(),
    db: Session = Depends(get_db), current_user: User = Depends(require_write_access),
):
    """Sweep the computed (or a user-chosen, capped) surplus into a goal's
    current_amount -- pure bookkeeping, same as round-up sweeps; no real money
    moves. Limited to once per calendar month per goal (last_predictive_sweep_period)
    since the underlying balances/forecast don't themselves change when you sweep,
    so a second click would otherwise double-count the same surplus."""
    g = db.query(SavingsGoal).filter(SavingsGoal.id == goal_id, SavingsGoal.user_id == current_user.id).first()
    if not g:
        raise HTTPException(status_code=404, detail="Goal not found")

    period = utcnow().strftime("%Y-%m")
    if g.last_predictive_sweep_period == period:
        raise HTTPException(status_code=400, detail="Already swept into this goal this month.")

    computed = _safe_to_save(db, current_user.id)
    amount = computed["safe_to_save"] if payload.amount is None else max(0.0, min(payload.amount, computed["safe_to_save"]))
    if amount <= 0:
        return {"swept_amount": 0.0, "goal": _to_dict(db, g), **computed}

    g.current_amount = round((g.current_amount or 0.0) + amount, 2)
    g.last_predictive_sweep_period = period
    g.updated_at = utcnow()
    db.add(SavingsGoalContribution(goal_id=g.id, user_id=current_user.id, amount=round(amount, 2), source="predictive_sweep"))
    db.commit()
    db.refresh(g)
    return {"swept_amount": round(amount, 2), "goal": _to_dict(db, g), **computed}
