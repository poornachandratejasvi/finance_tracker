"""Celery task: the scheduled-backup dispatcher.

Mirrors app/tasks/sync_tasks.py::dispatch_scheduled_syncs — it runs every minute
(Celery beat), iterates every user's backup config stored in the AppSetting table,
and runs a backup for the ones whose schedule is due, using last_run_at as an
idempotency guard.

Heavy imports (DB session, models, the endpoint's shared logic) are done lazily
inside the task so importing this module for registration does not pull in the full
endpoint/service graph at worker boot.
"""
import logging
from datetime import datetime, timedelta

from app.core.celery_app import celery_app
from app.core.time_utils import utcnow

logger = logging.getLogger(__name__)


def _parse_last_run(cfg: dict):
    """Parse last_run_at (ISO string) from a config dict, tolerating bad/missing values."""
    raw = cfg.get("last_run_at")
    if not raw:
        return None
    try:
        return datetime.fromisoformat(raw)
    except Exception:
        return None


def _is_due(cfg: dict, now: datetime) -> bool:
    """Decide whether a backup config should fire now, using last_run_at as an
    idempotency guard (the dispatcher runs every minute). Minute resolution: a run
    is due once enough time has elapsed since the previous run."""
    last = _parse_last_run(cfg)
    freq = (cfg.get("frequency") or "daily").lower()
    if freq == "hourly":
        return last is None or (now - last) >= timedelta(hours=1)
    if freq == "daily":
        return last is None or (now - last) >= timedelta(days=1)
    if freq == "weekly":
        return last is None or (now - last) >= timedelta(days=7)
    return False


@celery_app.task(name="backup.dispatch_scheduled")
def dispatch_scheduled_backups():
    """Run due backups for every user with an enabled schedule."""
    from app.core.database import SessionLocal
    from app.models.models import AppSetting, User
    from app.api.endpoints.backup import perform_backup, _get_cfg, _set_json, _cfg_key

    db = SessionLocal()
    dispatched = 0
    try:
        now = utcnow()
        rows = db.query(AppSetting).filter(AppSetting.key.like("backup_cfg:%")).all()
        for row in rows:
            try:
                uid = int(row.key.split(":", 1)[1])
            except (ValueError, IndexError):
                continue
            try:
                cfg = _get_cfg(db, uid)
                if not cfg.get("enabled"):
                    continue
                if not _is_due(cfg, now):
                    continue
                # Skip configs whose user no longer exists.
                if not db.query(User.id).filter(User.id == uid).first():
                    continue

                perform_backup(db, uid)

                # Advance the idempotency guard so we don't rerun every minute.
                cfg["last_run_at"] = now.isoformat()
                _set_json(db, _cfg_key(uid), cfg)
                dispatched += 1
                logger.info("Scheduled backup completed for user %s", uid)
            except Exception:
                db.rollback()
                logger.warning("Failed scheduled backup for user %s", uid, exc_info=True)
    finally:
        db.close()
    return {"dispatched": dispatched}
