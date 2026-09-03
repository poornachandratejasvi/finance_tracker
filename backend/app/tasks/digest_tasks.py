"""Celery task: weekly digest, sent via the Apprise fan-out (notify_service).
Per-user try/except so one user's failure can't block others -- same
defensive shape as credit_balance_tasks.redetect_all_credit_card_balances.
"""
import json
import logging

from app.core.celery_app import celery_app

logger = logging.getLogger(__name__)


def _digest_enabled(db, user_id: int) -> bool:
    """Reads the same prefs:{uid} AppSetting JSON blob users.py's
    DEFAULT_PREFS/_prefs_key convention uses, without importing from an
    endpoints module into a task."""
    from app.models.models import AppSetting

    row = db.query(AppSetting).filter(AppSetting.key == f"prefs:{user_id}").first()
    if not row or not row.value:
        return True
    try:
        return bool(json.loads(row.value).get("digest_enabled", True))
    except (ValueError, TypeError):
        return True


@celery_app.task(name="digest.send_weekly")
def send_weekly_digest():
    from app.core.database import SessionLocal
    from app.models.models import User
    from app.services import digest_service, notify_service

    db = SessionLocal()
    sent = 0
    try:
        user_ids = [row[0] for row in db.query(User.id).all()]
        for uid in user_ids:
            try:
                if not _digest_enabled(db, uid):
                    continue
                title, body = digest_service.build_digest(db, uid)
                if not title:
                    continue
                if notify_service.send(db, uid, title, body):
                    sent += 1
            except Exception:
                logger.warning("Weekly digest failed for user %s", uid, exc_info=True)
    finally:
        db.close()
    return {"sent": sent}
