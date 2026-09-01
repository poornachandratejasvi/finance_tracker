"""Merges tracked Package delivery dates and Subscription due-dates into one
sorted list -- the single source of truth for both the Calendar page's
GET /api/calendar endpoint and the daily due-date reminder task, so there's no
duplicated aggregation/expansion logic between the two.
"""
from datetime import timedelta
from typing import List


def expand_occurrences(due_date, recurrence: str, window_start, window_end) -> List:
    """Return every occurrence of a (possibly recurring) due_date that falls
    within [window_start, window_end]. recurrence='none' returns [due_date] if
    it's in the window (even if in the past -- an overdue one-off should still
    surface), otherwise []. weekly/monthly/yearly step forward from due_date by
    the period until the occurrence is >= window_start, then keep collecting
    while <= window_end."""
    if due_date is None:
        return []

    if recurrence == "none" or not recurrence:
        return [due_date] if window_start <= due_date <= window_end else []

    def _step(dt, n=1):
        if recurrence == "weekly":
            return dt + timedelta(days=7 * n)
        if recurrence == "monthly":
            # Add calendar months, not a fixed day count, so a 31st-of-the-month
            # due date doesn't drift earlier every cycle through 30-day months.
            month = dt.month - 1 + n
            year = dt.year + month // 12
            month = month % 12 + 1
            day = min(dt.day, [31, 29 if year % 4 == 0 and (year % 100 != 0 or year % 400 == 0) else 28,
                               31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1])
            return dt.replace(year=year, month=month, day=day)
        if recurrence == "yearly":
            try:
                return dt.replace(year=dt.year + n)
            except ValueError:
                # Feb 29 due date landing on a non-leap year.
                return dt.replace(year=dt.year + n, day=28)
        return dt

    occurrences = []
    n = 0
    occ = due_date
    # Fast-forward past occurrences before the window without emitting them.
    while occ < window_start:
        n += 1
        occ = _step(due_date, n)
        if n > 10000:  # pathological safety valve, not a real limit in practice
            return occurrences
    while occ <= window_end:
        occurrences.append(occ)
        n += 1
        occ = _step(due_date, n)
    return occurrences


def get_upcoming_items(db, user_id: int, days_ahead: int = 60) -> List[dict]:
    """Merge non-delivered Package expected-delivery-dates + expanded
    Subscription occurrences into one sorted-by-date list:
    [{type, id, date, title, subtitle, amount, link, is_overdue}, ...]."""
    from app.models.models import Package, Subscription
    from app.core.time_utils import utcnow

    now = utcnow()
    horizon = now + timedelta(days=days_ahead)
    items = []

    packages = (
        db.query(Package)
        .filter(
            Package.user_id == user_id,
            Package.status != "delivered",
            Package.expected_delivery_date.isnot(None),
            Package.expected_delivery_date <= horizon,
        )
        .all()
    )
    for p in packages:
        items.append({
            "type": "package", "id": p.id, "date": p.expected_delivery_date,
            "title": p.item_description or p.merchant or p.carrier.replace("_", " ").title(),
            "subtitle": f"{p.carrier.replace('_', ' ').title()} · {p.status.replace('_', ' ')}",
            "amount": None, "link": p.tracking_url,
            "is_overdue": p.expected_delivery_date < now,
        })

    subscriptions = db.query(Subscription).filter(Subscription.user_id == user_id, Subscription.is_active.is_(True)).all()
    for s in subscriptions:
        for occ_date in expand_occurrences(s.due_date, s.recurrence, now - timedelta(days=1), horizon):
            items.append({
                "type": "subscription", "id": s.id, "date": occ_date,
                "title": s.name, "subtitle": s.item_type,
                "amount": s.amount, "link": None,
                "is_overdue": occ_date < now,
            })

    items.sort(key=lambda i: i["date"])
    return items
