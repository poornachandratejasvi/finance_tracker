"""Budget spend computation + threshold alerts."""
import logging
from datetime import datetime

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.time_utils import utcnow
from app.models.models import Budget, Transaction, TransactionType
from app.services.discord_notifier import discord_notifier

logger = logging.getLogger(__name__)


def _month_bounds(now: datetime = None):
    now = now or utcnow()
    start = datetime(now.year, now.month, 1)
    end = datetime(now.year + 1, 1, 1) if now.month == 12 else datetime(now.year, now.month + 1, 1)
    return start, end, f"{now.year:04d}-{now.month:02d}"


def _spent(db: Session, user_id: int, category: str, start: datetime, end: datetime) -> float:
    return float(
        db.query(func.coalesce(func.sum(Transaction.amount), 0.0)).filter(
            Transaction.user_id == user_id,
            Transaction.transaction_type == TransactionType.DEBIT,
            Transaction.category == category,
            Transaction.transaction_date >= start,
            Transaction.transaction_date < end,
        ).scalar() or 0.0
    )


def compute_status(db: Session, user_id: int) -> dict:
    """Return current-month spend vs limit for each of the user's budgets."""
    start, end, period = _month_bounds()
    out = []
    total_limit = 0.0
    total_spent = 0.0
    for b in db.query(Budget).filter(Budget.user_id == user_id).order_by(Budget.category).all():
        spent = _spent(db, user_id, b.category, start, end)
        pct = round((spent / b.monthly_limit) * 100, 1) if b.monthly_limit > 0 else 0.0
        total_limit += b.monthly_limit or 0.0
        total_spent += spent
        out.append({
            "id": b.id,
            "category": b.category,
            "monthly_limit": round(b.monthly_limit, 2),
            "alert_at_pct": b.alert_at_pct,
            "spent": round(spent, 2),
            "remaining": round((b.monthly_limit or 0) - spent, 2),
            "pct": pct,
            "over": spent > (b.monthly_limit or 0),
        })
    return {
        "period": period,
        "budgets": out,
        "total_limit": round(total_limit, 2),
        "total_spent": round(total_spent, 2),
    }


def check_and_alert(db: Session, user_id: int) -> int:
    """Send a Discord alert for any budget past its threshold (once per month per budget).
    Returns the number of alerts sent."""
    if not discord_notifier.enabled:
        return 0
    start, end, period = _month_bounds()
    sent = 0
    for b in db.query(Budget).filter(Budget.user_id == user_id).all():
        if not b.monthly_limit or b.monthly_limit <= 0:
            continue
        spent = _spent(db, user_id, b.category, start, end)
        pct = (spent / b.monthly_limit) * 100
        if pct >= (b.alert_at_pct or 80) and b.last_alerted_period != period:
            try:
                discord_notifier.send_notification(
                    title="💸 Budget Alert",
                    description=f"**{b.category}** — spent ₹{spent:,.0f} of ₹{b.monthly_limit:,.0f} ({pct:.0f}%) this month.",
                    color=0xE15759 if spent > b.monthly_limit else 0xEDC948,
                )
                b.last_alerted_period = period
                sent += 1
            except Exception:
                logger.warning("Failed to send budget alert for user %s / %s", user_id, b.category, exc_info=True)
    if sent:
        db.commit()
    return sent
