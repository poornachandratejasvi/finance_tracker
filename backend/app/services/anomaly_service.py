"""Daily anomaly push -- a scheduled counterpart to GET /api/ai/anomalies.

Deliberately NOT a reuse of that endpoint's logic: it re-scans the whole
trailing 90 days on every call, which is fine for an on-demand pull but wrong
for a daily push (the same large transaction would get flagged again every
day it's still inside the 90-day window, with no dedup mechanism). Instead,
the baseline (mean/std) is computed from the trailing 90 days EXCLUDING the
last 1 day, and only the last 1 day's transactions are checked against it --
non-overlapping by construction, so no dedup table is needed.

Statistical only, never the AI/LLM path -- the AI anomaly check costs real
API tokens per call and is meant to be a manual, opt-in pull today; an
unattended daily job silently spending AI credits for every user would be a
surprise cost, not a free win.
"""
from datetime import timedelta


def detect_recent_anomalies(db, user_id: int) -> list:
    from app.models.models import Transaction, TransactionType
    from app.core.time_utils import utcnow

    now = utcnow()
    baseline_start = now - timedelta(days=90)
    window_start = now - timedelta(days=1)

    baseline_txns = (
        db.query(Transaction)
        .filter(
            Transaction.user_id == user_id, Transaction.transaction_type == TransactionType.DEBIT,
            Transaction.transaction_date >= baseline_start, Transaction.transaction_date < window_start,
        )
        .all()
    )
    if len(baseline_txns) < 5:
        return []  # not enough history for a meaningful mean/std

    amounts = [t.amount for t in baseline_txns]
    mean = sum(amounts) / len(amounts)
    variance = sum((a - mean) ** 2 for a in amounts) / len(amounts)
    threshold = mean + 2 * (variance ** 0.5)

    recent_txns = (
        db.query(Transaction)
        .filter(
            Transaction.user_id == user_id, Transaction.transaction_type == TransactionType.DEBIT,
            Transaction.transaction_date >= window_start,
        )
        .all()
    )
    return [
        {
            "description": t.description, "amount": t.amount,
            "date": t.transaction_date.strftime("%Y-%m-%d"),
            "reason": f"Unusually large (> mean+2σ ≈ {round(threshold, 0)})",
        }
        for t in recent_txns if t.amount > threshold
    ]
