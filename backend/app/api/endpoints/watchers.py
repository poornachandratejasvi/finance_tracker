"""CRUD for TransactionWatcher (named recurring-transaction expectations that get a
Google Task each period and auto-complete it when a matching transaction shows
up — see app.services.transaction_hooks.check_transaction_watchers)."""
import json
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List

from app.core.database import get_db
from app.api.endpoints.auth import get_current_active_user
from app.models.models import User, TransactionWatcher
from app.schemas.watcher import WatcherCreate, WatcherUpdate, WatcherResponse
from app.services.autorules import parse_list

router = APIRouter()

VALID_FREQUENCIES = ("daily", "weekly", "monthly", "yearly")


def _dedupe(keywords) -> list:
    seen = set()
    cleaned = []
    for raw in keywords or []:
        kw = str(raw).strip()
        if not kw:
            continue
        low = kw.lower()
        if low in seen:
            continue
        seen.add(low)
        cleaned.append(kw)
    return cleaned


def _to_response(w: TransactionWatcher) -> dict:
    return {
        "id": w.id, "user_id": w.user_id, "name": w.name,
        "match_keywords": parse_list(w.match_keywords),
        "match_amount": w.match_amount,
        "frequency": w.frequency or "monthly",
        "is_active": bool(w.is_active),
        "current_period": w.current_period,
        "current_task_id": w.current_task_id,
        "cleared_at": w.cleared_at,
        "created_at": w.created_at,
    }


@router.get("/", response_model=List[WatcherResponse])
def list_watchers(db: Session = Depends(get_db), current_user: User = Depends(get_current_active_user)):
    rows = (
        db.query(TransactionWatcher)
        .filter(TransactionWatcher.user_id == current_user.id)
        .order_by(TransactionWatcher.name)
        .all()
    )
    return [_to_response(w) for w in rows]


@router.post("/", response_model=WatcherResponse, status_code=status.HTTP_201_CREATED)
def create_watcher(data: WatcherCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_active_user)):
    name = (data.name or "").strip()
    keywords = _dedupe(data.match_keywords)
    if not name:
        raise HTTPException(status_code=400, detail="Name is required")
    if not keywords:
        raise HTTPException(status_code=400, detail="At least one match keyword is required")
    frequency = (data.frequency or "monthly").lower()
    if frequency not in VALID_FREQUENCIES:
        raise HTTPException(status_code=400, detail=f"frequency must be one of {VALID_FREQUENCIES}")
    watcher = TransactionWatcher(
        user_id=current_user.id, name=name, match_keywords=json.dumps(keywords),
        match_amount=data.match_amount, frequency=frequency,
        is_active=data.is_active if data.is_active is not None else True,
    )
    db.add(watcher); db.commit(); db.refresh(watcher)
    return _to_response(watcher)


@router.put("/{watcher_id}", response_model=WatcherResponse)
def update_watcher(watcher_id: int, data: WatcherUpdate, db: Session = Depends(get_db), current_user: User = Depends(get_current_active_user)):
    watcher = db.query(TransactionWatcher).filter(
        TransactionWatcher.id == watcher_id, TransactionWatcher.user_id == current_user.id
    ).first()
    if not watcher:
        raise HTTPException(status_code=404, detail="Watcher not found")
    u = data.dict(exclude_unset=True)
    if "name" in u and u["name"]:
        watcher.name = u["name"].strip()
    if "match_keywords" in u and u["match_keywords"] is not None:
        keywords = _dedupe(u["match_keywords"])
        if not keywords:
            raise HTTPException(status_code=400, detail="At least one match keyword is required")
        watcher.match_keywords = json.dumps(keywords)
    if "match_amount" in u:
        watcher.match_amount = u["match_amount"]
    if "frequency" in u and u["frequency"] is not None:
        frequency = u["frequency"].lower()
        if frequency not in VALID_FREQUENCIES:
            raise HTTPException(status_code=400, detail=f"frequency must be one of {VALID_FREQUENCIES}")
        watcher.frequency = frequency
    if "is_active" in u and u["is_active"] is not None:
        watcher.is_active = u["is_active"]
    db.commit(); db.refresh(watcher)
    return _to_response(watcher)


@router.delete("/{watcher_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_watcher(watcher_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_active_user)):
    watcher = db.query(TransactionWatcher).filter(
        TransactionWatcher.id == watcher_id, TransactionWatcher.user_id == current_user.id
    ).first()
    if not watcher:
        raise HTTPException(status_code=404, detail="Watcher not found")
    db.delete(watcher); db.commit()
    return None


@router.get("/detect-recurring")
def detect_recurring_endpoint(
    db: Session = Depends(get_db), current_user: User = Depends(get_current_active_user)
):
    """Scan the caller's transaction history for recurring patterns (subscriptions,
    standing instructions, regular transfers) they haven't already configured a
    watcher for, so they can turn one into a watcher with one click."""
    from app.models.models import Bank
    from app.services.recurring_detection import detect_recurring

    detected = detect_recurring(db, current_user.id)
    bank_names = {b.id: b.name for b in db.query(Bank).filter(Bank.user_id == current_user.id).all()}

    existing = db.query(TransactionWatcher).filter(TransactionWatcher.user_id == current_user.id).all()
    existing_keywords = {kw.lower() for w in existing for kw in parse_list(w.match_keywords)}

    results = []
    for r in detected:
        sig_words = r["signature"].split()
        # Already covered by an existing watcher if any of its own significant
        # words already appears as a configured keyword — skip re-suggesting it.
        if any(w.lower() in existing_keywords for w in sig_words):
            continue
        results.append({
            **r,
            "bank_name": bank_names.get(r["bank_id"]),
            "suggested_keywords": sig_words,
        })
    return results


@router.post("/run-now")
def run_watchers_now(db: Session = Depends(get_db), current_user: User = Depends(get_current_active_user)):
    """Manually create this period's Google Task for any of the caller's active
    watchers that don't have one open yet — normally runs hourly via Celery beat,
    but useful to trigger immediately right after creating a watcher."""
    from app.core.time_utils import utcnow
    from app.services.backup_service import get_drive_creds
    from app.services import google_tasks_service
    from app.services.watcher_periods import period_label, period_title

    creds = get_drive_creds(db, current_user.id)
    if not creds:
        raise HTTPException(status_code=400, detail="Google Drive/Tasks not connected (Settings → Backup)")

    now = utcnow()
    watchers = db.query(TransactionWatcher).filter(
        TransactionWatcher.user_id == current_user.id, TransactionWatcher.is_active.is_(True)
    ).all()
    created = 0
    for w in watchers:
        this_period = period_label(w.frequency or "monthly", now)
        if w.current_period == this_period:
            continue
        title = f"{w.name} — {period_title(w.frequency or 'monthly', now)}"
        task_id = google_tasks_service.create_task(
            creds, title, "Auto-clears when a matching transaction appears.",
        )
        w.current_period = this_period
        w.current_task_id = task_id
        w.cleared_at = None
        created += 1
    db.commit()
    return {"created": created}
