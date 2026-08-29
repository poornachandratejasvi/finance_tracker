"""Records an immutable trail of transaction edits/deletes (TransactionAuditLog)
so a category/amount correction or a deletion can always be reconstructed later --
important for tax or business-expense record-keeping, where "what did this row
say before" needs a real answer, not just the current state.
"""
import json
from datetime import datetime

from sqlalchemy.orm import Session

from app.models.models import TransactionAuditLog

TRACKED_FIELDS = [
    "description", "amount", "transaction_type", "category",
    "transaction_date", "notes", "from_account", "to_account",
]


def _serialize(value):
    if isinstance(value, datetime):
        return value.isoformat()
    if hasattr(value, "value"):  # enum (e.g. TransactionType)
        return value.value
    return value


def record_update(db: Session, transaction, update_data: dict) -> None:
    """Call BEFORE mutating `transaction` with `update_data` -- diffs against the
    still-current values. No-ops (writes nothing) if nothing tracked actually changed."""
    changes = {}
    for field, new_value in update_data.items():
        if field not in TRACKED_FIELDS:
            continue
        old_s = _serialize(getattr(transaction, field, None))
        new_s = _serialize(new_value)
        if old_s != new_s:
            changes[field] = {"old": old_s, "new": new_s}
    if not changes:
        return
    db.add(TransactionAuditLog(
        user_id=transaction.user_id,
        transaction_id=transaction.id,
        action="updated",
        changes=json.dumps(changes),
    ))


def record_delete(db: Session, transaction) -> None:
    """Call BEFORE db.delete(transaction) -- snapshots every tracked field plus
    bank_id, since a deleted row's whole point is to outlive `transaction`."""
    snapshot = {f: _serialize(getattr(transaction, f, None)) for f in TRACKED_FIELDS}
    snapshot["bank_id"] = transaction.bank_id
    db.add(TransactionAuditLog(
        user_id=transaction.user_id,
        transaction_id=transaction.id,
        action="deleted",
        changes=json.dumps(snapshot),
    ))
