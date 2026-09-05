"""Planned expenses/income: generate per-cycle PlannedItemOccurrence rows from
a recurring/one-off PlannedItem definition, and match them against real
transactions -- mirrors credit_card_bill_service.py's
find_payment_candidates/run_auto_match/confirm_payment/mark_paid_manually
shape, generalized to any account (not just a credit card) and to either
transaction direction (expense->debit, income->credit).
"""
import logging
from datetime import timedelta
from typing import List, Optional

from sqlalchemy import and_, or_
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

# A planned payment isn't tied to a billing cycle like a credit-card bill, so
# the window is asymmetric and a bit wider: often paid up to a week and a
# half early, occasionally a few days late.
_WINDOW_BEFORE_DAYS = 10
_WINDOW_AFTER_DAYS = 5
# Tolerance is relative, not a flat rupee amount -- unlike a credit-card
# statement's exact printed total, a "planned" amount is a typical/expected
# figure (rent might be exact, but a utility bill genuinely varies).
_MIN_TOLERANCE = 10.0
_TOLERANCE_PCT = 0.03


def ensure_occurrences(db: Session, planned_item, horizon_days: int = 45) -> int:
    """Generate any missing PlannedItemOccurrence rows for this item, from its
    due_date anchor up through now + horizon_days. Returns how many were
    created. Safe to call repeatedly -- deduped by (planned_item_id, due_date)."""
    from app.core.time_utils import utcnow
    from app.models.models import PlannedItemOccurrence
    from app.services.calendar_service import expand_occurrences

    if not planned_item.is_active:
        return 0

    now = utcnow()
    # Recurring items only ever generate from "recent past" forward -- an
    # old anchor due_date (e.g. set up a year ago) must not backfill every
    # historical cycle since then. A one-off ('none') item has exactly one
    # occurrence regardless of how overdue it is, so its own due_date stays
    # the window start untouched.
    if planned_item.recurrence in (None, "none"):
        window_start = planned_item.due_date
    else:
        window_start = max(planned_item.due_date, now - timedelta(days=35))
    window_end = now + timedelta(days=horizon_days)
    if window_end < window_start:
        return 0

    occurrence_dates = expand_occurrences(planned_item.due_date, planned_item.recurrence, window_start, window_end)
    if not occurrence_dates:
        return 0

    existing = {
        d for (d,) in db.query(PlannedItemOccurrence.due_date)
        .filter(PlannedItemOccurrence.planned_item_id == planned_item.id)
        .all()
    }

    created = 0
    for due_date in occurrence_dates:
        if due_date in existing:
            continue
        db.add(PlannedItemOccurrence(
            planned_item_id=planned_item.id,
            user_id=planned_item.user_id,
            due_date=due_date,
            expected_amount=planned_item.amount,
        ))
        created += 1
    if created:
        db.flush()
    return created


def find_candidates(db: Session, occurrence) -> List:
    """Transactions that could plausibly settle this occurrence, most recent
    first. Empty if there's nothing to match against yet."""
    from app.models.models import PlannedItem, Transaction, TransactionType

    if occurrence.expected_amount is None:
        return []

    planned_item = db.query(PlannedItem).filter(PlannedItem.id == occurrence.planned_item_id).first()
    if not planned_item:
        return []

    window_start = occurrence.due_date - timedelta(days=_WINDOW_BEFORE_DAYS)
    window_end = occurrence.due_date + timedelta(days=_WINDOW_AFTER_DAYS)
    tolerance = max(_MIN_TOLERANCE, abs(occurrence.expected_amount) * _TOLERANCE_PCT)
    lo, hi = occurrence.expected_amount - tolerance, occurrence.expected_amount + tolerance
    wanted_type = TransactionType.DEBIT if planned_item.direction == "expense" else TransactionType.CREDIT

    query = (
        db.query(Transaction)
        .filter(
            Transaction.user_id == occurrence.user_id,
            Transaction.transaction_type == wanted_type,
            Transaction.amount >= lo,
            Transaction.amount <= hi,
            Transaction.transaction_date >= window_start,
            Transaction.transaction_date <= window_end,
        )
    )
    if planned_item.match_hint:
        query = query.filter(Transaction.description.ilike(f"%{planned_item.match_hint}%"))

    return query.order_by(Transaction.transaction_date.desc()).all()


def _apply_match(occurrence, transaction_id: int) -> None:
    occurrence.matched_transaction_id = transaction_id
    occurrence.status = "matched"


def run_auto_match(db: Session, occurrence, commit: bool = True) -> bool:
    """Attempt to auto-resolve one occurrence. Returns True if it (already
    was, or just got) matched/closed. Never overwrites an existing match.
    commit=False for callers that are themselves mid-way through a larger,
    not-yet-committed unit of work (see try_automatch_for_transaction)."""
    if occurrence.status in ("matched", "closed"):
        return True

    candidates = find_candidates(db, occurrence)
    if len(candidates) == 1:
        _apply_match(occurrence, candidates[0].id)
        if commit:
            db.commit()
        return True
    return False


def try_automatch_for_transaction(db: Session, transaction) -> bool:
    """Called right after a new transaction is added to the session (but not
    necessarily committed yet -- see the callers in transaction_hooks.py/
    transactions.py/ingest.py/alert_sync_service.py, which own the eventual
    commit) -- checks whether it unambiguously resolves any of this user's
    still-open occurrences whose match window covers this transaction's date.
    Does not generate new occurrences (that's ensure_occurrences' job, run
    separately/periodically) and never commits -- only flushes so the new
    transaction's id and row are visible to this function's own query.
    Best-effort: never raises."""
    from app.models.models import PlannedItemOccurrence

    try:
        if transaction.transaction_date is None or transaction.amount is None:
            return False
        db.flush()  # assigns transaction.id and makes the row visible to the query below
        window_start = transaction.transaction_date - timedelta(days=_WINDOW_AFTER_DAYS)
        window_end = transaction.transaction_date + timedelta(days=_WINDOW_BEFORE_DAYS)
        occurrences = (
            db.query(PlannedItemOccurrence)
            .filter(
                PlannedItemOccurrence.user_id == transaction.user_id,
                PlannedItemOccurrence.status == "open",
                PlannedItemOccurrence.due_date >= window_start,
                PlannedItemOccurrence.due_date <= window_end,
            )
            .all()
        )
        matched_any = False
        for occurrence in occurrences:
            candidates = find_candidates(db, occurrence)
            if len(candidates) == 1:
                _apply_match(occurrence, candidates[0].id)
                matched_any = True
        return matched_any
    except Exception:
        logger.warning("Planned-item auto-match failed for transaction %s", getattr(transaction, "id", None), exc_info=True)
        return False


def confirm_match(db: Session, occurrence, transaction_id: int) -> None:
    """User-confirmed mapping -- picking a transaction as this occurrence's settlement."""
    occurrence.matched_transaction_id = transaction_id
    occurrence.status = "matched"
    db.commit()


def close_occurrence(db: Session, occurrence) -> None:
    """No matching transaction exists (e.g. paid cash) -- close without one."""
    from app.core.time_utils import utcnow

    occurrence.status = "closed"
    occurrence.closed_at = utcnow()
    occurrence.matched_transaction_id = None
    db.commit()


def sync_all(db: Session, user_id: int) -> dict:
    """Ensure occurrences exist and re-run auto-match for every active
    PlannedItem a user has -- the daily safety-net task, also usable as the
    lazy per-request sync behind GET /planned-items."""
    from app.models.models import PlannedItem, PlannedItemOccurrence
    from app.core.time_utils import utcnow

    items = db.query(PlannedItem).filter(PlannedItem.user_id == user_id, PlannedItem.is_active == True).all()  # noqa: E712
    created = 0
    matched = 0
    for item in items:
        created += ensure_occurrences(db, item)
    db.commit()

    now = utcnow()
    open_occurrences = (
        db.query(PlannedItemOccurrence)
        .filter(
            PlannedItemOccurrence.user_id == user_id,
            PlannedItemOccurrence.status == "open",
            PlannedItemOccurrence.due_date <= now + timedelta(days=45),
        )
        .all()
    )
    for occurrence in open_occurrences:
        if run_auto_match(db, occurrence):
            matched += 1

    return {"occurrences_created": created, "occurrences_matched": matched}
