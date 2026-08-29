"""Celery task: hourly balance threshold check for every user."""
import logging

from app.core.celery_app import celery_app

logger = logging.getLogger(__name__)


@celery_app.task(name="balance_alerts.check_all")
def check_all_balance_alerts():
    from app.core.database import SessionLocal
    from app.models.models import User
    from app.services.balance_alert_service import check_balance_alerts

    db = SessionLocal()
    total_sent = 0
    try:
        user_ids = [row[0] for row in db.query(User.id).all()]
        for uid in user_ids:
            try:
                total_sent += check_balance_alerts(db, uid)
            except Exception:
                logger.warning("Balance alert check failed for user %s", uid, exc_info=True)
    finally:
        db.close()

    if total_sent:
        logger.info("Balance alerts: %d sent", total_sent)
    return {"sent": total_sent}
