"""Detect and auto-resolve duplicate transactions: combine an EXACT pass
(date+amount+description all equal) with a FUZZY cross-source pass (same
bank/type, amount within a cent, date within a few days, description
ignored -- what actually catches a purchase recorded once by a real-time
source (Gmail alert/SMS/Shortcut ingest) and again by a PDF statement or a
different sync, since each parser formats the description differently).

Unlike the old "Solve Duplicities" review dialog, this doesn't wait for a
person to tick boxes: a found group is merged (useful fields/labels filled
into the best-provenance row from the others) and the rest are soft-deleted
-- landing in the Recycle Bin, restorable for 30 days, same as any other
delete. That Recycle Bin IS the "confirm if it's a duplicate or not"
section: duplicates are assumed correct by default, and wrong calls get
fixed by restoring there rather than by pre-approving every group first.

Shares its priority/tolerance constants with the real-time SMS/alert/ingest
dedupe guard in transaction_hooks.py, so "is this a duplicate" means the
same thing whether it's caught at creation time or by this later sweep.
"""
import json
import logging

from app.core.time_utils import utcnow
from app.services import audit_service
from app.services.transaction_hooks import _SOURCE_PRIORITY, _RECONCILE_WINDOW_DAYS, _AMOUNT_TOLERANCE

logger = logging.getLogger(__name__)


def _keeper_rank(t) -> int:
    # A confirmed row (real statement, or already reconciled -- see
    # create_or_reconcile_transaction, which always sets source="pdf" on
    # reconciliation) always outranks any still-pending real-time source,
    # regardless of _SOURCE_PRIORITY. A manually-created row is excluded from
    # this boost even though it's *born* confirmed (transactions.py's
    # create_transaction always sets is_confirmed=True for source="manual") --
    # that flag carries no real signal there, since it was never cross-checked
    # against anything. Without this carve-out a stray manual re-entry (e.g.
    # the iOS "Add Transaction" Shortcut's offline-queue fallback re-submitting
    # something a Gmail alert already caught) would always win the merge, the
    # opposite of the intended Gmail-wins-first priority below.
    if t.is_confirmed and t.source != "manual":
        return 1000
    return _SOURCE_PRIORITY.get(t.source, 0)


def find_duplicate_groups(db, user_id: int) -> list:
    """Returns a list of groups, each a list of Transaction ORM objects sorted
    keeper-first (best provenance, then earliest id)."""
    from sqlalchemy import func
    from app.models.models import Transaction

    # Excludes already soft-deleted rows throughout -- without this, a pair
    # resolved by a previous run keeps getting "re-resolved" by every later
    # sweep (nothing here is a no-op against an already-merged loser: the
    # merge unconditionally overwrites deleted_at to *now*), indefinitely
    # postponing its actual Recycle Bin purge date.
    exact_rows = db.query(
        func.date(Transaction.transaction_date).label("d"),
        Transaction.amount,
        func.lower(Transaction.description).label("desc"),
        func.array_agg(Transaction.id).label("ids"),
    ).filter(
        Transaction.user_id == user_id,
        Transaction.deleted_at.is_(None),
    ).group_by(
        func.date(Transaction.transaction_date), Transaction.amount, func.lower(Transaction.description),
    ).having(func.count(Transaction.id) > 1).all()

    groups = []
    exact_matched_ids = set()
    for row in exact_rows:
        txns = db.query(Transaction).filter(Transaction.id.in_(row.ids)).all()
        txns.sort(key=lambda t: (-_keeper_rank(t), t.id))
        groups.append(txns)
        exact_matched_ids.update(row.ids)

    all_txns = (
        db.query(Transaction)
        .filter(
            Transaction.user_id == user_id, Transaction.amount.isnot(None), Transaction.transaction_date.isnot(None),
            Transaction.deleted_at.is_(None),
        )
        .order_by(Transaction.bank_id, Transaction.transaction_type, Transaction.transaction_date)
        .all()
    )
    buckets = {}
    for t in all_txns:
        buckets.setdefault((t.bank_id, t.transaction_type), []).append(t)

    seen_in_fuzzy = set()
    for txns in buckets.values():
        n = len(txns)
        for i in range(n):
            a = txns[i]
            if a.id in exact_matched_ids or a.id in seen_in_fuzzy:
                continue
            cluster = [a]
            for j in range(i + 1, n):
                b = txns[j]
                if (b.transaction_date - a.transaction_date).days > _RECONCILE_WINDOW_DAYS:
                    break
                if b.id in exact_matched_ids or b.id in seen_in_fuzzy:
                    continue
                if abs(b.amount - a.amount) <= _AMOUNT_TOLERANCE:
                    cluster.append(b)
            if len(cluster) < 2:
                continue
            # Only the cross-source/cross-confirmation pattern this is meant to catch --
            # a cluster where every row shares the same (source, is_confirmed) is more
            # likely two genuinely separate same-amount purchases, not a duplicate.
            if len({(t.source, t.is_confirmed) for t in cluster}) < 2:
                continue
            cluster.sort(key=lambda t: (-_keeper_rank(t), t.id))
            for t in cluster:
                seen_in_fuzzy.add(t.id)
            groups.append(cluster)

    return groups


def _merge_fields(keeper, loser) -> None:
    if (not keeper.category or keeper.category.strip().lower() == "uncategorized") and loser.category:
        keeper.category = loser.category
    if loser.notes:
        if not keeper.notes:
            keeper.notes = loser.notes
        elif loser.notes not in keeper.notes:
            keeper.notes = f"{keeper.notes}\n{loser.notes}"
    if keeper.reference_number is None and loser.reference_number:
        keeper.reference_number = loser.reference_number
    if keeper.from_account is None and loser.from_account:
        keeper.from_account = loser.from_account
    if keeper.to_account is None and loser.to_account:
        keeper.to_account = loser.to_account
    if keeper.balance is None and loser.balance is not None:
        keeper.balance = loser.balance
    if loser.custom_fields:
        try:
            loser_extra = json.loads(loser.custom_fields)
            keeper_extra = json.loads(keeper.custom_fields) if keeper.custom_fields else {}
            merged = {**loser_extra, **keeper_extra}  # keeper wins on key conflicts
            keeper.custom_fields = json.dumps(merged) if merged else None
        except (ValueError, TypeError):
            pass


def _merge_labels(db, keeper, loser) -> None:
    from app.models.models import TransactionLabel

    existing = {tl.label_id for tl in keeper.transaction_labels}
    for tl in list(loser.transaction_labels):
        if tl.label_id not in existing:
            db.add(TransactionLabel(transaction_id=keeper.id, label_id=tl.label_id))
            existing.add(tl.label_id)


def merge_duplicate_group(db, group: list):
    """group[0] is the keeper; the rest are absorbed into it (category/notes/
    labels/reference/account fields filled in wherever the keeper is missing
    them) then soft-deleted -- reversible via the Recycle Bin like any other
    delete, not gone for good. Returns the keeper."""
    keeper, losers = group[0], group[1:]
    for loser in losers:
        _merge_fields(keeper, loser)
        _merge_labels(db, keeper, loser)
        audit_service.record_delete(db, loser)
        loser.deleted_at = utcnow()
        loser.is_duplicate = True
        loser.duplicate_group_id = f"merged-into-{keeper.id}"
    keeper.is_duplicate = False
    db.flush()
    return keeper


def resolve_duplicates_for_user(db, user_id: int) -> dict:
    groups = find_duplicate_groups(db, user_id)
    merged = 0
    for group in groups:
        merge_duplicate_group(db, group)
        merged += len(group) - 1
    if groups:
        db.commit()
    return {"groups_resolved": len(groups), "transactions_merged": merged}
