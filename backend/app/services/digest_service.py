"""Builds the weekly digest -- spend recap, upcoming items, net worth delta,
and any newly-flagged subscription price increases -- sent via the same
Apprise fan-out (Discord/ntfy/...) everything else already uses.
"""
import logging
from collections import defaultdict
from datetime import timedelta

logger = logging.getLogger(__name__)


def build_digest(db, user_id: int):
    """Returns (title, body) for this user's weekly digest, or (None, None) if
    there's genuinely nothing to say (no transactions, no upcoming items)."""
    from app.core.time_utils import utcnow
    from app.models.models import Transaction, BalanceSnapshot
    from app.services.calendar_service import get_upcoming_items
    from app.services.recurring_detection import detect_price_changes

    now = utcnow()
    week_ago = now - timedelta(days=7)

    txns = (
        db.query(Transaction)
        .filter(Transaction.user_id == user_id, Transaction.transaction_type == "debit", Transaction.transaction_date >= week_ago)
        .all()
    )
    by_category = defaultdict(float)
    for t in txns:
        by_category[t.category or "Uncategorized"] += t.amount or 0.0
    total_spent = sum(by_category.values())
    top_categories = sorted(by_category.items(), key=lambda kv: -kv[1])[:5]

    upcoming = get_upcoming_items(db, user_id, days_ahead=14, days_back=0)

    try:
        price_changes = detect_price_changes(db, user_id)
    except Exception:
        logger.warning("Price-change detection failed in digest for user %s", user_id, exc_info=True)
        price_changes = []

    # Net worth delta: existing bank-only net_worth field (unchanged meaning,
    # see BalanceSnapshot's docstring/comment) -- compare today's snapshot
    # against the closest one at least ~6 days old.
    snaps = (
        db.query(BalanceSnapshot)
        .filter(BalanceSnapshot.user_id == user_id)
        .order_by(BalanceSnapshot.snapshot_date.desc())
        .limit(14)
        .all()
    )
    net_worth_delta = None
    if len(snaps) >= 2:
        latest = snaps[0]
        older = next((s for s in snaps[1:] if s.snapshot_date <= (now - timedelta(days=6)).strftime("%Y-%m-%d")), snaps[-1])
        if older is not latest:
            net_worth_delta = (latest.net_worth or 0.0) - (older.net_worth or 0.0)

    if not txns and not upcoming and not price_changes:
        return None, None

    lines = []
    lines.append(f"Spent this week: Rs.{total_spent:,.0f}")
    for cat, amt in top_categories:
        lines.append(f"  - {cat}: Rs.{amt:,.0f}")

    if net_worth_delta is not None:
        sign = "+" if net_worth_delta >= 0 else "-"
        lines.append(f"\nNet worth change (7d): {sign}Rs.{abs(net_worth_delta):,.0f}")

    if upcoming:
        lines.append("\nUpcoming (next 14 days):")
        for item in upcoming[:10]:
            date_str = item["date"].strftime("%d %b") if hasattr(item["date"], "strftime") else str(item["date"])
            amount_str = f" - Rs.{item['amount']:,.0f}" if item.get("amount") else ""
            overdue = " (OVERDUE)" if item.get("is_overdue") else ""
            lines.append(f"  - {date_str}: {item['title']}{amount_str}{overdue}")

    if price_changes:
        lines.append("\nPrice increases detected:")
        for p in price_changes[:5]:
            lines.append(
                f"  - {p['sample_description']}: Rs.{p['previous_amount']:,.0f} -> Rs.{p['current_amount']:,.0f} "
                f"(+{p['change_pct']:.0f}%)"
            )

    title = f"Weekly digest - Rs.{total_spent:,.0f} spent"
    body = "\n".join(lines)
    return title, body
