"""Deeper spending insights beyond the existing comparison/cashflow endpoints
in analytics.py: category trend lines, a simple spend forecast, and
day-of-week spending patterns.

Deliberately pure aggregation + plain-Python math (no numpy/scipy) -- this is
an honest, simple recency-weighted projection, not a real time-series model.
Self-contained (doesn't import from app.api.endpoints.analytics) to avoid a
circular import, since analytics.py's new endpoints call into this module.
"""
from collections import defaultdict
from datetime import datetime, timedelta
from typing import Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.models import Transaction, Bank, TransactionType
from app.services.currency_service import get_rate_map


def _effective_currency():
    return func.coalesce(Transaction.currency_code, Bank.currency_code, 'INR')


def _month_bucket_expr():
    # String bucket (not a raw timestamp) -- mirrors analytics.py's
    # _bucket_expr, which uses to_char for the same "avoid driver-specific
    # datetime hydration" reason.
    return func.to_char(func.date_trunc('month', Transaction.transaction_date), 'YYYY-MM-01')


def _add_months(dt: datetime, n: int) -> datetime:
    month = dt.month - 1 + n
    year = dt.year + month // 12
    month = month % 12 + 1
    return dt.replace(year=year, month=month, day=1, hour=0, minute=0, second=0, microsecond=0)


def _month_labels(months: int) -> list:
    """Oldest-to-newest 'YYYY-MM-01' labels, including the current (possibly
    partial) month as the last entry."""
    now = datetime.utcnow()
    this_month = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    start = _add_months(this_month, -(months - 1))
    return [_add_months(start, i).strftime('%Y-%m-01') for i in range(months)]


def category_trends(db: Session, user_id: int, months: int = 6) -> dict:
    """Per-category monthly debit totals for the last `months` months, each
    with a change_pct (earliest vs latest month that actually has spend),
    sorted by the biggest movers first -- powers the "trending categories" UI."""
    months = max(2, min(months, 12))
    labels = _month_labels(months)
    range_start = datetime.strptime(labels[0], '%Y-%m-%d')

    rate_map = get_rate_map(db, user_id)
    bucket = _month_bucket_expr()

    rows = (
        db.query(
            bucket.label('month'),
            func.coalesce(Transaction.category, 'Unknown').label('category'),
            _effective_currency().label('code'),
            func.sum(Transaction.amount).label('amt'),
        )
        .outerjoin(Bank, Transaction.bank_id == Bank.id)
        .filter(
            Transaction.user_id == user_id,
            Transaction.transaction_type == TransactionType.DEBIT,
            Transaction.transaction_date >= range_start,
        )
        .group_by('month', 'category', _effective_currency())
        .all()
    )

    by_category: dict = defaultdict(lambda: defaultdict(float))
    for month, category, code, amt in rows:
        base = float(amt or 0) * rate_map.get(code or 'INR', 1.0)
        by_category[category][month] += base

    categories = []
    for name, month_amounts in by_category.items():
        monthly = [round(month_amounts.get(m, 0.0), 2) for m in labels]
        nonzero = [v for v in monthly if v > 0]
        change_pct = None
        if len(nonzero) >= 2 and nonzero[0] > 0:
            change_pct = round(((nonzero[-1] - nonzero[0]) / nonzero[0]) * 100, 1)
        categories.append({
            "category": name,
            "monthly": monthly,
            "total": round(sum(monthly), 2),
            "change_pct": change_pct,
        })

    categories.sort(key=lambda c: abs(c["change_pct"]) if c["change_pct"] is not None else -1, reverse=True)

    return {"months": labels, "categories": categories}


def _weighted_forecast(values: list) -> Optional[float]:
    """A simple recency-weighted average of whatever non-zero recent data
    points exist -- most recent months weighted higher. Not a regression."""
    nonzero = [v for v in values if v]
    if not nonzero:
        return None
    weights = list(range(1, len(nonzero) + 1))  # oldest=1 ... newest=len
    return sum(v * w for v, w in zip(nonzero, weights)) / sum(weights)


def spending_forecast(db: Session, user_id: int) -> dict:
    """Projects next month's total spend (and the top 5 categories') from a
    recency-weighted average of the last 6 COMPLETE months -- the current
    partial month is excluded from the projection basis but reported
    separately as "so far"."""
    trends = category_trends(db, user_id, months=7)  # 6 complete + current
    complete_totals_by_month = [0.0] * (len(trends["months"]) - 1)
    for cat in trends["categories"]:
        for i, v in enumerate(cat["monthly"][:-1]):
            complete_totals_by_month[i] += v

    overall_forecast = _weighted_forecast(complete_totals_by_month)
    complete_count = sum(1 for v in complete_totals_by_month if v > 0)
    if complete_count >= 4:
        confidence = "high"
    elif complete_count >= 2:
        confidence = "medium"
    else:
        confidence = "low"

    top_categories = sorted(trends["categories"], key=lambda c: c["total"], reverse=True)[:5]
    category_forecasts = []
    for cat in top_categories:
        forecast = _weighted_forecast(cat["monthly"][:-1])
        if forecast is None:
            continue
        category_forecasts.append({"category": cat["category"], "forecast_amount": round(forecast, 2)})

    current_month_so_far = round(sum(c["monthly"][-1] for c in trends["categories"]), 2) if trends["categories"] else 0.0

    return {
        "forecast_amount": round(overall_forecast, 2) if overall_forecast is not None else None,
        "current_month_so_far": current_month_so_far,
        "confidence": confidence,
        "categories": category_forecasts,
    }


_WEEKDAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]


def spending_patterns(db: Session, user_id: int, days: int = 180) -> dict:
    """Average/total debit spend by day-of-week over the last N days -- a
    "you spend most on Fridays" style call-out."""
    since = datetime.utcnow() - timedelta(days=days)
    rate_map = get_rate_map(db, user_id)

    rows = (
        db.query(
            func.extract('isodow', Transaction.transaction_date).label('dow'),  # 1=Mon .. 7=Sun
            _effective_currency().label('code'),
            Transaction.amount,
        )
        .outerjoin(Bank, Transaction.bank_id == Bank.id)
        .filter(
            Transaction.user_id == user_id,
            Transaction.transaction_type == TransactionType.DEBIT,
            Transaction.transaction_date >= since,
        )
        .all()
    )

    totals = defaultdict(float)
    counts = defaultdict(int)
    for dow, code, amt in rows:
        base = float(amt or 0) * rate_map.get(code or 'INR', 1.0)
        idx = int(dow) - 1
        totals[idx] += base
        counts[idx] += 1

    weeks = max(1.0, days / 7.0)
    pattern = [
        {
            "day": name,
            "total": round(totals.get(i, 0.0), 2),
            "average": round(totals.get(i, 0.0) / weeks, 2),
            "count": counts.get(i, 0),
        }
        for i, name in enumerate(_WEEKDAY_NAMES)
    ]

    busiest = max(pattern, key=lambda p: p["total"]) if any(p["total"] for p in pattern) else None

    return {"pattern": pattern, "busiest_day": busiest["day"] if busiest else None}
