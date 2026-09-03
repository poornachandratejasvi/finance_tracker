"""Detect recurring transactions (subscriptions, standing instructions, regular
transfers) from transaction history, so a user can turn a detected pattern into a
TransactionWatcher with one click instead of hand-picking a keyword/amount.

Real bank descriptions are noisy (reference numbers, UPI handles, bank codes) —
grouping on the raw string never matches. Instead each description is reduced to
a "signature": its alphabetic tokens, longest-first, with common banking noise
words stripped. Two transactions from the same recurring source usually share
most of their significant words even when reference numbers differ.
"""
import json
import logging
import re
from collections import defaultdict
from statistics import median

logger = logging.getLogger(__name__)

_NOISE_TOKENS = {
    "UPI", "NEFT", "IMPS", "RTGS", "TRANSFER", "PAYMENT", "PAID", "PAY",
    "TXN", "REF", "TO", "FROM", "BANK", "THE", "AND", "FOR", "VIA", "CHARGES",
    "CHARGE", "ACCOUNT", "ATM", "WITHDRAWAL", "DEPOSIT", "CR", "DR", "INR", "RS",
    "OKAXIS", "OKICICI", "OKHDFCBANK", "OKSBI", "YBL", "YESB", "ICIC", "HDFC",
    "SBIN", "UTIB", "P2A", "P2M",
}


def _signature(description: str) -> str:
    tokens = re.findall(r"[A-Za-z]{3,}", (description or "").upper())
    significant = sorted({
        t for t in tokens
        if t not in _NOISE_TOKENS and len(set(t)) > 1  # drop masked-digit runs like "XXXXXXXXXX"
    })
    return " ".join(significant[:6])


# (name, min days, max days) — median gap between consecutive occurrences.
_FREQ_BANDS = [
    ("daily", 1, 3),
    ("weekly", 5, 10),
    ("monthly", 25, 35),
    ("yearly", 350, 380),
]


def _classify(days: float):
    for name, lo, hi in _FREQ_BANDS:
        if lo <= days <= hi:
            return name
    return None


def detect_recurring(db, user_id: int, min_occurrences: int = 3, lookback_days: int = 730) -> list:
    """Return detected recurring patterns, most-occurrences first. Never raises —
    a bad description or edge case just gets excluded rather than blowing up the
    whole scan."""
    from app.models.models import Transaction
    from app.core.time_utils import utcnow
    from datetime import timedelta

    cutoff = utcnow() - timedelta(days=lookback_days)
    txns = (
        db.query(Transaction)
        .filter(Transaction.user_id == user_id, Transaction.transaction_date >= cutoff)
        .order_by(Transaction.transaction_date)
        .all()
    )

    groups = defaultdict(list)
    for t in txns:
        sig = _signature(t.description)
        if not sig or t.amount is None:
            continue
        groups[(t.bank_id, sig, round(t.amount, 2))].append(t)

    results = []
    for (bank_id, sig, amount), items in groups.items():
        if len(items) < min_occurrences:
            continue
        items.sort(key=lambda t: t.transaction_date)
        gaps = [(items[i + 1].transaction_date - items[i].transaction_date).days for i in range(len(items) - 1)]
        if not gaps:
            continue
        freq = _classify(median(gaps))
        if not freq:
            continue
        # A real recurring transfer/subscription often has skipped or late periods
        # (a missed month, a payment that landed a few days off) — requiring near-
        # perfect regularity rejects perfectly real patterns. The median already
        # anchors the frequency; here we just need most gaps to agree with it.
        consistent = sum(1 for g in gaps if _classify(g) == freq)
        if consistent < max(2, len(gaps) * 0.5):
            continue
        ttype = items[-1].transaction_type
        results.append({
            "bank_id": bank_id,
            "signature": sig,
            "sample_description": items[-1].description,
            "amount": amount,
            "transaction_type": ttype.value if hasattr(ttype, "value") else str(ttype),
            "frequency": freq,
            "occurrences": len(items),
            "first_date": items[0].transaction_date,
            "last_date": items[-1].transaction_date,
            "median_gap_days": round(median(gaps), 1),
        })

    results.sort(key=lambda r: -r["occurrences"])
    return results


_PRICE_CHANGE_THRESHOLD_PCT = 2.0  # ignore rounding noise below this
# A genuine "price went up" pattern (subscription, rent, gym...) has a STABLE
# amount before the jump -- confirmed via live testing against real transaction
# history that skipping this check floods results with ordinary variable-amount
# recurring payments (e.g. frequent UPI transfers to the same person/merchant
# for different purchases each time), which "jump" constantly by construction
# and have nothing to do with a price increase. Coefficient of variation
# (stdev/mean) of the amounts BEFORE the latest one must be low for this to
# count as a real baseline worth comparing against.
_STABLE_BASELINE_CV = 0.10


def detect_price_changes(db, user_id: int, lookback_days: int = 730) -> list:
    """Flag a recurring pattern whose latest occurrence costs more than its
    prior history -- e.g. a subscription that silently went ₹199 -> ₹249.

    Deliberately a SEPARATE grouping pass from detect_recurring, not a
    modification of it: detect_recurring groups by (bank_id, signature,
    round(amount, 2)) -- amount is part of its key, so a pattern whose amount
    changes is already split into two smaller groups there, and its returned
    dict never keeps each occurrence's individual amount. Changing that
    grouping would also affect check_upcoming_renewals's pattern_key/reminder
    dedup, which round(amount, 2) too -- too risky to touch in place. This
    function re-groups by (bank_id, signature) ONLY (no amount in the key),
    so an amount-drift series is seen as one pattern instead of two."""
    from app.models.models import Transaction
    from app.core.time_utils import utcnow
    from datetime import timedelta

    cutoff = utcnow() - timedelta(days=lookback_days)
    txns = (
        db.query(Transaction)
        .filter(Transaction.user_id == user_id, Transaction.transaction_date >= cutoff, Transaction.amount.isnot(None))
        .order_by(Transaction.transaction_date)
        .all()
    )

    groups = defaultdict(list)
    for t in txns:
        sig = _signature(t.description)
        if not sig:
            continue
        groups[(t.bank_id, sig)].append(t)

    results = []
    for (bank_id, sig), items in groups.items():
        if len(items) < 3:
            continue
        items.sort(key=lambda t: t.transaction_date)
        gaps = [(items[i + 1].transaction_date - items[i].transaction_date).days for i in range(len(items) - 1)]
        if not gaps or not _classify(median(gaps)):
            continue  # not actually a recurring cadence, just coincidental same-signature charges

        current_amount = items[-1].amount
        prior_amounts = [t.amount for t in items[:-1]]
        previous_amount = median(prior_amounts)
        if previous_amount <= 0:
            continue

        # Reject anything whose "before" amounts weren't actually stable --
        # otherwise a naturally variable-amount series (frequent payments to
        # the same person/merchant that just happen to differ each time)
        # constantly looks like a "price increase" against its own median.
        if len(prior_amounts) >= 2:
            baseline_mean = sum(prior_amounts) / len(prior_amounts)
            baseline_variance = sum((a - baseline_mean) ** 2 for a in prior_amounts) / len(prior_amounts)
            baseline_cv = (baseline_variance ** 0.5) / baseline_mean if baseline_mean else float("inf")
            if baseline_cv > _STABLE_BASELINE_CV:
                continue

        change_pct = round((current_amount - previous_amount) / previous_amount * 100, 1)
        if change_pct <= _PRICE_CHANGE_THRESHOLD_PCT:
            continue

        results.append({
            "bank_id": bank_id,
            "signature": sig,
            "sample_description": items[-1].description,
            "previous_amount": round(previous_amount, 2),
            "current_amount": round(current_amount, 2),
            "change_pct": change_pct,
            "last_date": items[-1].transaction_date,
            "occurrences": len(items),
        })

    results.sort(key=lambda r: -r["change_pct"])
    return results


def _reminder_key(uid: int) -> str:
    return f"recurring_reminders_sent:{uid}"


def check_upcoming_renewals(db, user_id: int, days_ahead: int = 2) -> int:
    """Notify (via the same Discord/Apprise fan-out as budget alerts) about any
    detected recurring DEBIT (subscription/bill) whose predicted next charge falls
    within `days_ahead` days. Idempotent per predicted due date -- once notified
    for a given pattern + due date, it won't fire again until the next cycle's due
    date changes. Returns the number of reminders sent."""
    from app.models.models import AppSetting
    from app.core.time_utils import utcnow
    from datetime import timedelta
    from app.services.discord_notifier import discord_notifier

    if not discord_notifier.enabled:
        return 0

    row = db.query(AppSetting).filter(AppSetting.key == _reminder_key(user_id)).first()
    sent_map = {}
    if row and row.value:
        try:
            sent_map = json.loads(row.value)
        except (ValueError, TypeError):
            sent_map = {}

    now = utcnow()
    horizon = now + timedelta(days=days_ahead)
    sent = 0

    try:
        patterns = detect_recurring(db, user_id)
    except Exception:
        logger.warning("Recurring-renewal reminder scan failed for user %s", user_id, exc_info=True)
        return 0

    for p in patterns:
        if p["transaction_type"] != "debit":
            continue
        next_due = p["last_date"] + timedelta(days=p["median_gap_days"])
        if not (now <= next_due <= horizon):
            continue
        pattern_key = f"{p['bank_id']}:{p['signature']}:{round(p['amount'], 2)}"
        due_str = next_due.strftime("%Y-%m-%d")
        if sent_map.get(pattern_key) == due_str:
            continue  # already reminded for this exact due date
        try:
            discord_notifier.send_notification(
                title="📅 Upcoming Bill/Subscription",
                description=f"**{p['sample_description']}** — ₹{p['amount']:,.0f} expected around {due_str} "
                            f"({p['frequency']}).",
                color=0x4E79A7,
            )
            sent_map[pattern_key] = due_str
            sent += 1
        except Exception:
            logger.warning("Failed to send renewal reminder for user %s / %s", user_id, pattern_key, exc_info=True)

    if sent:
        payload = json.dumps(sent_map)
        if row:
            row.value = payload
        else:
            db.add(AppSetting(key=_reminder_key(user_id), value=payload))
        db.commit()
    return sent
