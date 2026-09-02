"""Celery task: periodic credit-card outstanding-balance redetection.

Previously `redetect_credit_card_balance`/`redetect_all_credit_balances`
(credit_balance_service.py) only ever ran when a user clicked "Redetect Credit
Balances" on the Banks page — so a card's balance could silently go stale for
months if nobody remembered to click it (regex-first, AI-fallback re-parse of
the latest statement; a no-op/'unchanged' result if nothing new has arrived,
so running this often is cheap).
"""
import logging

from app.core.celery_app import celery_app

logger = logging.getLogger(__name__)


@celery_app.task(name="credit_balance.redetect_all")
def redetect_all_credit_card_balances():
    """Re-derive the Total Amount Due for every credit-card account, for every
    user, from each card's latest statement."""
    from app.core.database import SessionLocal
    from app.models.models import Bank
    from app.services.credit_balance_service import redetect_credit_card_balance

    db = SessionLocal()
    updated = 0
    try:
        # 'manual' cards are deliberately skipped — a user-entered outstanding
        # amount must stick until they either edit it again or explicitly click
        # "Redetect Credit Balances" (which resets it back to 'auto').
        banks = db.query(Bank).filter(Bank.bank_type == "credit", Bank.balance_source != "manual").all()
        for bank in banks:
            try:
                report = redetect_credit_card_balance(db, bank.user_id, bank, use_ai=True)
                if report.get("source") not in ("unchanged", "no_pdf"):
                    updated += 1
                # redetect_credit_card_balance only mutates the in-memory ORM
                # objects (Bank.current_balance, CreditCardBill upserts) --
                # this task's own SessionLocal never had a commit, so none of
                # it was actually being persisted before. Commit per-bank so
                # one bank's failure below can't roll back an already-good one.
                db.commit()
            except Exception:
                logger.warning("Credit balance redetect failed for bank %s", bank.id, exc_info=True)
                db.rollback()
    finally:
        db.close()

    if updated:
        logger.info("Credit balance redetect: %d card(s) updated", updated)
    return {"updated": updated}


# A card with no activity in this long is most likely paid off/unused rather than
# still carrying its last-seen due amount — treat it as a heuristic fallback, not a
# replacement for real statement data (redetect_all above still wins if a genuine
# statement is newer).
_STALE_DAYS = 60


def check_stale_credit_cards(db, user_ids=None):
    """Flag credit cards with no transaction in _STALE_DAYS+: notify Discord, log a
    visible entry on the Jobs page, and zero the outstanding balance.

    Self-limiting rather than a repeating nag — once current_balance is 0 there's
    nothing left to correct, so a card is only ever notified once per staleness
    episode (new activity or a manual edit both naturally reset it).

    user_ids: restrict to these users' banks (used by the manual "check now" API
    endpoint); None checks every user's banks (used by the periodic beat task)."""
    from datetime import timedelta

    from sqlalchemy import func

    from app.core.time_utils import utcnow
    from app.models.models import Bank, Transaction, SyncLog
    from app.services import discord_service

    flagged = 0
    # 'manual' cards are skipped for the same reason as the redetect task above —
    # a user-entered balance sticks until they touch it again.
    query = db.query(Bank).filter(Bank.bank_type == "credit", Bank.balance_source != "manual")
    if user_ids is not None:
        query = query.filter(Bank.user_id.in_(user_ids))
    banks = query.all()
    cutoff = utcnow() - timedelta(days=_STALE_DAYS)
    for bank in banks:
        # NOT `if not bank.current_balance` — that's also True for None, but a
        # None current_balance makes the UI fall back to computed_balance (a
        # lifetime transactions sum), which for an old dormant card is usually
        # a large stale non-zero figure. Only an *explicit* 0.0 means there's
        # nothing left to fix here.
        if bank.current_balance == 0.0:
            continue
        last_txn = (
            db.query(func.max(Transaction.transaction_date))
            .filter(Transaction.bank_id == bank.id, Transaction.user_id == bank.user_id)
            .scalar()
        )
        last_activity = last_txn or bank.created_at
        if last_activity and last_activity > cutoff:
            continue  # recent activity — not stale

        old_balance = bank.current_balance
        old_balance_str = f"{old_balance:,.2f}" if old_balance is not None else "not set (was estimated from transaction history)"
        bank.current_balance = 0.0
        bank.balance_updated_at = utcnow()
        db.add(SyncLog(
            user_id=bank.user_id, sync_type="balance_check", status="partial",
            current_bank=bank.name,
            current_step=f"No transactions in {_STALE_DAYS}+ days — balance reset from "
                          f"{old_balance_str} to 0.00",
            started_at=utcnow(), completed_at=utcnow(),
        ))
        db.commit()
        try:
            discord_service.send_discord_message(
                db, bank.user_id,
                f"{bank.name}: balance reset to 0",
                f"No transactions detected on {bank.name} in over {_STALE_DAYS} days "
                f"(was {old_balance_str}). Assumed paid off/unused and reset to 0 — "
                f"edit the balance manually if that's wrong.",
            )
        except Exception:
            logger.warning("Discord notify failed for stale card %s", bank.id, exc_info=True)
        flagged += 1

    if flagged:
        logger.info("Stale credit card check: %d card(s) flagged and zeroed", flagged)
    return {"flagged": flagged}


@celery_app.task(name="credit_balance.notify_stale_cards")
def notify_stale_credit_cards():
    """Periodic (all-users) entry point — see check_stale_credit_cards for the logic."""
    from app.core.database import SessionLocal

    db = SessionLocal()
    try:
        return check_stale_credit_cards(db)
    finally:
        db.close()
