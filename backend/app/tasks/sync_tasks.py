"""Celery tasks for background Gmail sync + the scheduled-sync dispatcher."""
import logging
from datetime import datetime, timedelta
from typing import Optional

from app.core.celery_app import celery_app
from app.core.time_utils import utcnow

logger = logging.getLogger(__name__)


@celery_app.task(name="sync.run", bind=True, max_retries=2, default_retry_delay=30)
def run_sync_task(
    self,
    sync_log_id: int,
    gmail_account_id: Optional[int],
    user_id: int,
    sync_type: str,
    start_date_iso: Optional[str],
    bank_id: Optional[int] = None,
):
    """Execute a sync job. Imports run_sync lazily to avoid import cycles at worker boot."""
    # Imported here (not at module top) so importing this module for dispatch does not
    # pull in the full endpoint/service graph.
    from app.api.endpoints.sync import run_sync

    start_date = datetime.fromisoformat(start_date_iso) if start_date_iso else None
    logger.info("Celery worker running sync_log_id=%s bank_id=%s", sync_log_id, bank_id)
    run_sync(sync_log_id, gmail_account_id, user_id, sync_type, start_date, bank_id)


def _is_due(sched, now: datetime) -> bool:
    """Decide whether a schedule should fire now, using last_run_at as an idempotency
    guard (the dispatcher runs every minute).

    Catch-up: daily/weekly schedules only fire at an exact hour (or day+hour), so if
    beat/worker was down through that window (server stopped, restarted, etc.) the
    schedule would otherwise sit idle until the exact time rolls around again — up to
    a full day (or week) later. Once a schedule is overdue by more than one full period
    + a buffer, fire on the next dispatch regardless of hour, so restarting the stack
    catches up immediately instead of silently waiting.
    """
    last = sched.last_run_at
    freq = (sched.frequency or "daily").lower()
    if freq == "hourly":
        return last is None or (now - last) >= timedelta(hours=1)
    if freq == "every4h":
        return last is None or (now - last) >= timedelta(hours=4)
    if freq == "daily":
        if last is not None and (now - last) >= timedelta(hours=25):
            return True
        if now.hour != (sched.hour or 0):
            return False
        return last is None or last.date() < now.date()
    if freq == "weekly":
        if last is not None and (now - last) >= timedelta(days=7, hours=1):
            return True
        if now.isoweekday() != (sched.day_of_week or 1) or now.hour != (sched.hour or 0):
            return False
        return last is None or (now - last) >= timedelta(days=6)
    return False


@celery_app.task(name="sync.dispatch_scheduled")
def dispatch_scheduled_syncs():
    """Runs every minute (Celery beat). Enqueues syncs for users whose schedule is due,
    and takes a daily balance snapshot for net-worth history."""
    from app.core.database import SessionLocal
    from app.models.models import SyncSchedule, GmailAccount, SyncLog

    db = SessionLocal()
    dispatched = 0
    try:
        now = utcnow()
        # Reconcile any stuck jobs first (crash/restart/time-limit leftovers).
        try:
            from app.api.endpoints.sync import reap_stale_syncs
            reap_stale_syncs(db)
        except Exception:
            logger.warning("reap_stale_syncs failed in dispatcher", exc_info=True)
        schedules = db.query(SyncSchedule).filter(SyncSchedule.enabled == True).all()  # noqa: E712
        for sched in schedules:
            try:
                if not _is_due(sched, now):
                    continue
                has_account = db.query(GmailAccount.id).filter(
                    GmailAccount.user_id == sched.user_id,
                    GmailAccount.is_active == True,  # noqa: E712
                ).first()
                if not has_account:
                    # Still advance last_run so we don't retry every minute.
                    sched.last_run_at = now
                    db.commit()
                    continue
                sync_log = SyncLog(user_id=sched.user_id, sync_type="incremental", status="queued", current_step="Queued (scheduled)")
                db.add(sync_log)
                db.commit()
                db.refresh(sync_log)
                run_sync_task.apply_async(
                    args=[sync_log.id, None, sched.user_id, "incremental", None], retry=False
                )
                sched.last_run_at = now
                db.commit()
                dispatched += 1
                logger.info("Scheduled sync dispatched for user %s (log %s)", sched.user_id, sync_log.id)
            except Exception:
                db.rollback()
                logger.warning("Failed dispatching scheduled sync for user %s", getattr(sched, "user_id", "?"), exc_info=True)

        _take_balance_snapshots(db, now)
    finally:
        db.close()
    return {"dispatched": dispatched}


def _take_balance_snapshots(db, now: datetime) -> None:
    """Once per day per user, snapshot aggregate balances for net-worth history."""
    from sqlalchemy import func
    from app.models.models import Bank, BalanceSnapshot, User

    today = now.strftime("%Y-%m-%d")
    try:
        user_ids = [row[0] for row in db.query(User.id).all()]
        for uid in user_ids:
            exists = db.query(BalanceSnapshot.id).filter(
                BalanceSnapshot.user_id == uid, BalanceSnapshot.snapshot_date == today
            ).first()
            if exists:
                continue
            savings = float(db.query(func.coalesce(func.sum(Bank.current_balance), 0.0)).filter(
                Bank.user_id == uid, Bank.bank_type != "credit", Bank.current_balance.isnot(None)
            ).scalar() or 0.0)
            credit = float(db.query(func.coalesce(func.sum(Bank.current_balance), 0.0)).filter(
                Bank.user_id == uid, Bank.bank_type == "credit", Bank.current_balance.isnot(None)
            ).scalar() or 0.0)
            db.add(BalanceSnapshot(
                user_id=uid, snapshot_date=today,
                savings_total=savings, credit_total=credit, net_worth=savings - credit,
            ))
        db.commit()
    except Exception:
        db.rollback()
        logger.warning("Failed taking balance snapshots", exc_info=True)
