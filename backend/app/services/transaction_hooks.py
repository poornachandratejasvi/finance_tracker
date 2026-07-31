"""Shared post-create hook for every place a new Transaction row is created:
applies a matching AutoRule (category + labels + its own Discord toggle) and
fires any matching NotificationRule (Discord/email/Google Task).

Previously this logic was hand-duplicated inline in transactions.py (manual
create) and ingest.py (API/iOS-Shortcut ingest) only — the PDF/bank-statement
parsing paths (banks.py, pdfs.py, sync.py), which is how most real transactions
actually enter the app, never got it, so AutoRule labels/categories and
NotificationRule alerts silently never applied to synced/imported transactions.

Unlike those two call sites, this helper is meant to run INSIDE a loop over many
newly-created rows in one larger transaction — so it must never call
db.rollback() (that would discard every other pending row in the same
transaction) or db.commit() (the caller decides when to commit the batch). It
only logs and continues on failure.
"""
import logging

logger = logging.getLogger(__name__)


def apply_auto_rules_and_notify(db, user_id: int, transaction) -> None:
    # apply_rule() creates TransactionLabel rows keyed on transaction.id — which is
    # still None until the INSERT is actually flushed (callers just did db.add()).
    # Flushing here (not committing) assigns the id within the current transaction
    # without ending it, so the caller's batch commit/rollback semantics are
    # unaffected.
    if transaction.id is None:
        db.flush()

    ttype = (
        transaction.transaction_type.value
        if hasattr(transaction.transaction_type, "value")
        else str(transaction.transaction_type)
    )

    try:
        from app.services.autorules import get_active_rules, match_rule, apply_rule
        rule = match_rule(transaction.description, ttype, get_active_rules(db, user_id))
        if rule:
            if apply_rule(db, transaction, rule):
                db.flush()
            if rule.notify_discord:
                from app.services import discord_service
                discord_service.send_rule_match_notification(db, user_id, transaction, rule)
    except Exception:
        logger.warning("AutoRule apply failed for a transaction", exc_info=True)

    try:
        from app.services.notification_rules import check_match
        check_match(db, user_id, transaction)
    except Exception:
        logger.warning("Notification rule check failed for a transaction", exc_info=True)
