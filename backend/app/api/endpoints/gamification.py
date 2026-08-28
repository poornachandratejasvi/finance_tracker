"""Zero-spend streaks -- a lightweight engagement feature computed entirely
from existing transaction history, no new tables. A "zero-spend day" is a
calendar day with no debit transaction at all (kept simple and unambiguous,
rather than trying to classify "essential" vs "discretionary" spending,
which would need a per-category judgement call this app doesn't make
anywhere else)."""
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from sqlalchemy import func

from app.core.database import get_db
from app.api.endpoints.auth import get_current_active_user
from app.models.models import User, Transaction, TransactionType

router = APIRouter()

# (threshold_days, label) -- longest-streak-ever badges, ascending.
_BADGES = [
    (3, "3-Day Spark"),
    (7, "1-Week Streak"),
    (14, "2-Week Streak"),
    (30, "1-Month Streak"),
    (90, "Quarter Master"),
    (180, "Half-Year Hero"),
    (365, "Full-Year Legend"),
]


@router.get("/streaks")
def zero_spend_streaks(
    lookback_days: int = Query(180, ge=7, le=730),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    since = datetime.utcnow() - timedelta(days=lookback_days - 1)
    since_day = since.replace(hour=0, minute=0, second=0, microsecond=0)

    rows = (
        db.query(func.to_char(Transaction.transaction_date, 'YYYY-MM-DD').label('day'))
        .filter(
            Transaction.user_id == current_user.id,
            Transaction.transaction_type == TransactionType.DEBIT,
            Transaction.transaction_date >= since_day,
        )
        .distinct()
        .all()
    )
    spend_days = {r.day for r in rows}

    today = datetime.utcnow().date()
    days = [(since_day.date() + timedelta(days=i)) for i in range(lookback_days)]

    longest = 0
    current_run = 0
    for d in days:
        if d.strftime('%Y-%m-%d') not in spend_days:
            current_run += 1
            longest = max(longest, current_run)
        else:
            current_run = 0

    # Current streak: the run of zero-spend days ending exactly at today,
    # walked backwards independently of the lookback window's start.
    current_streak = 0
    d = today
    while d.strftime('%Y-%m-%d') not in spend_days and d >= days[0]:
        current_streak += 1
        d -= timedelta(days=1)

    earned_badges = [label for threshold, label in _BADGES if longest >= threshold]
    next_badge = next(((threshold, label) for threshold, label in _BADGES if longest < threshold), None)

    return {
        "current_streak": current_streak,
        "longest_streak": longest,
        "lookback_days": lookback_days,
        "badges": earned_badges,
        "next_badge": {"days_needed": next_badge[0] - longest, "label": next_badge[1]} if next_badge else None,
    }
