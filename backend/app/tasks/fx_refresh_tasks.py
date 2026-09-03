"""Celery task: daily FX rate auto-refresh for every user's non-manual
Currency rows. See fx_refresh_service.py."""
import logging

from app.core.celery_app import celery_app

logger = logging.getLogger(__name__)


@celery_app.task(name="currencies.refresh_rates")
def refresh_all_rates():
    from app.core.database import SessionLocal
    from app.models.models import User
    from app.services import fx_refresh_service

    db = SessionLocal()
    total = 0
    try:
        for uid in [row[0] for row in db.query(User.id).all()]:
            try:
                total += fx_refresh_service.refresh_rates(db, uid)
            except Exception:
                logger.warning("FX refresh failed for user %s", uid, exc_info=True)
                db.rollback()
    finally:
        db.close()
    if total:
        logger.info("FX rate refresh: %d currency row(s) updated", total)
    return {"updated": total}
