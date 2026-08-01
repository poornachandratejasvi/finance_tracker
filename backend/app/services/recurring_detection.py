"""Detect recurring transactions (subscriptions, standing instructions, regular
transfers) from transaction history, so a user can turn a detected pattern into a
TransactionWatcher with one click instead of hand-picking a keyword/amount.

Real bank descriptions are noisy (reference numbers, UPI handles, bank codes) —
grouping on the raw string never matches. Instead each description is reduced to
a "signature": its alphabetic tokens, longest-first, with common banking noise
words stripped. Two transactions from the same recurring source usually share
most of their significant words even when reference numbers differ.
"""
import re
from collections import defaultdict
from statistics import median

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
        })

    results.sort(key=lambda r: -r["occurrences"])
    return results
