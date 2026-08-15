"""Shared hooks for every place a new Transaction row is created from a parsed
PDF/bank-statement: (1) reconcile-or-create — match against an existing
unconfirmed "alert" transaction before inserting a fresh row, so a real-time
spend alert and its later statement line don't end up double-counted, and (2)
apply a matching AutoRule (category + labels + its own Discord toggle) and fire
any matching NotificationRule (Discord/email/Google Task).

(2) was previously hand-duplicated inline in transactions.py (manual create)
and ingest.py (API/iOS-Shortcut ingest) only — the PDF/bank-statement parsing
paths (banks.py, pdfs.py, sync.py), which is how most real transactions
actually enter the app, never got it, so AutoRule labels/categories and
NotificationRule alerts silently never applied to synced/imported transactions.

Unlike those two call sites, these helpers are meant to run INSIDE a loop over
many newly-created rows in one larger transaction — so they must never call
db.rollback() (that would discard every other pending row in the same
transaction) or db.commit() (the caller decides when to commit the batch). They
only log and continue on failure.
"""
import logging
from datetime import timedelta

logger = logging.getLogger(__name__)

# How far apart a real-time alert and its later statement line can be dated and
# still be considered the same real-world transaction. Generous because a spend
# near a statement-period boundary can land a day or two off, and IST/UTC/bank
# timezone handling is inconsistent across parsers.
_RECONCILE_WINDOW_DAYS = 3
_AMOUNT_TOLERANCE = 0.01


def create_or_reconcile_transaction(db, user_id: int, bank_id: int, trans_data: dict, pdf_statement_id=None, source=None):
    """Either updates an existing unconfirmed ('alert') transaction that matches
    this statement row (same bank/user/amount/type, date within a few days) and
    marks it confirmed, or creates a brand-new Transaction. Returns
    (transaction, was_reconciled). The caller still owns db.add() for the
    brand-new case — nothing here commits or flushes on its own."""
    from app.models.models import Transaction, TransactionType
    from app.core.time_utils import utcnow

    amount = trans_data.get("amount")
    txn_date = trans_data.get("transaction_date")
    ttype = trans_data.get("transaction_type")

    pending = None
    if amount is not None and txn_date is not None and ttype in ("debit", "credit"):
        pending = (
            db.query(Transaction)
            .filter(
                Transaction.user_id == user_id,
                Transaction.bank_id == bank_id,
                Transaction.is_confirmed.is_(False),
                Transaction.transaction_type == TransactionType(ttype),
                Transaction.amount >= amount - _AMOUNT_TOLERANCE,
                Transaction.amount <= amount + _AMOUNT_TOLERANCE,
                Transaction.transaction_date >= txn_date - timedelta(days=_RECONCILE_WINDOW_DAYS),
                Transaction.transaction_date <= txn_date + timedelta(days=_RECONCILE_WINDOW_DAYS),
            )
            .first()
        )

    if pending:
        for key, value in trans_data.items():
            setattr(pending, key, value)
        pending.is_confirmed = True
        pending.confirmed_at = utcnow()
        pending.source = "pdf"
        if pdf_statement_id:
            pending.pdf_statement_id = pdf_statement_id
        return pending, True

    transaction = Transaction(
        user_id=user_id, bank_id=bank_id, pdf_statement_id=pdf_statement_id,
        **({"source": source} if source else {}), **trans_data,
    )
    db.add(transaction)

    try:
        from app.models.models import Bank
        from app.services.balance_service import adjust_credit_balance_for_new_transaction
        bank = db.query(Bank).filter(Bank.id == bank_id).first()
        if bank:
            adjust_credit_balance_for_new_transaction(bank, transaction)
    except Exception:
        logger.warning("Post-statement balance adjustment failed for bank %s", bank_id, exc_info=True)

    return transaction, False


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

    check_transaction_watchers(db, user_id, transaction)


def check_transaction_watchers(db, user_id: int, transaction) -> None:
    """If an active TransactionWatcher's keywords (and amount, when set) match
    this transaction, complete its currently-open Google Task — pending or
    confirmed both count, since this is a "did the expected transaction show up at
    all" reminder, not a reconciliation. ANY one of a watcher's keywords matching
    is enough (same semantics as NotificationRule.keywords), since a real
    recurring transfer's description often varies slightly run to run. match_amount
    exists because some recurring transfers carry no identifying name at all (e.g.
    a generic "MonthlyTrans CHARGES FOR..." IMPS description) — keyword alone would
    be too loose or, for a truly generic keyword, would never have been distinctive
    in the first place. Uses db.flush(), not db.commit(), for the same
    batch-transaction reason as the rest of this module; each matching watcher does
    one Google Tasks API call, so this is skipped entirely (a single cheap query)
    for the common case of no active watchers."""
    from app.models.models import TransactionWatcher
    from app.core.time_utils import utcnow
    from app.services.autorules import parse_list

    desc = (transaction.description or "").lower()
    if not desc:
        return
    watchers = db.query(TransactionWatcher).filter(
        TransactionWatcher.user_id == user_id,
        TransactionWatcher.is_active.is_(True),
        TransactionWatcher.current_task_id.isnot(None),
    ).all()
    for w in watchers:
        keywords = [k for k in parse_list(w.match_keywords) if k]
        if not any(kw.lower() in desc for kw in keywords):
            continue
        if w.match_amount is not None:
            if transaction.amount is None or abs(transaction.amount - w.match_amount) > 0.01:
                continue
        try:
            from app.services.backup_service import get_drive_creds
            from app.services import google_tasks_service
            creds = get_drive_creds(db, user_id)
            if not creds:
                continue
            google_tasks_service.complete_task(creds, w.current_task_id)
            w.current_task_id = None
            w.cleared_at = utcnow()
            db.flush()
        except Exception:
            logger.warning("Failed to complete Google Task for watcher %s", w.id, exc_info=True)
