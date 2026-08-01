"""Celery task: Google Task creation for transaction watchers.

Runs several times a day (cheap, idempotent) rather than pinned to exact period
boundaries, so a missed beat run self-heals on the next tick instead of skipping
a whole daily/weekly/monthly/yearly period.
"""
import logging

from app.core.celery_app import celery_app

logger = logging.getLogger(__name__)


@celery_app.task(name="watchers.create_monthly_tasks")
def create_monthly_watcher_tasks():
    """For every active TransactionWatcher whose open task isn't for the current
    period yet (daily/weekly/monthly/yearly, per its own frequency), create a new
    Google Task and record it as open. Skips watchers whose user hasn't connected
    Drive/Tasks (Settings -> Backup)."""
    from app.core.database import SessionLocal
    from app.core.time_utils import utcnow
    from app.models.models import TransactionWatcher
    from app.services.backup_service import get_drive_creds
    from app.services import google_tasks_service
    from app.services.watcher_periods import period_label, period_title

    db = SessionLocal()
    created = 0
    try:
        now = utcnow()
        watchers = db.query(TransactionWatcher).filter(TransactionWatcher.is_active.is_(True)).all()
        for w in watchers:
            this_period = period_label(w.frequency or "monthly", now)
            if w.current_period == this_period:
                continue  # already has an open task for this period
            creds = get_drive_creds(db, w.user_id)
            if not creds:
                logger.info("Watcher %s: Drive/Tasks not connected, skipping", w.id)
                continue
            title = f"{w.name} — {period_title(w.frequency or 'monthly', now)}"
            try:
                task_id = google_tasks_service.create_task(
                    creds, title, "Auto-clears when a matching transaction appears.",
                )
            except Exception:
                logger.warning("Watcher %s: failed to create Google Task", w.id, exc_info=True)
                continue
            w.current_period = this_period
            w.current_task_id = task_id
            w.cleared_at = None
            db.commit()
            created += 1
    finally:
        db.close()

    if created:
        logger.info("Created %d watcher task(s)", created)
    return {"created": created}
