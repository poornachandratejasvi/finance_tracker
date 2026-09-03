"""Celery task: daily anomaly push via the Apprise fan-out. See anomaly_service.py."""
import logging

from app.core.celery_app import celery_app

logger = logging.getLogger(__name__)


@celery_app.task(name="anomalies.check_daily")
def check_daily_anomalies():
    from app.core.database import SessionLocal
    from app.models.models import User
    from app.services import anomaly_service, notify_service

    db = SessionLocal()
    sent = 0
    try:
        for uid in [row[0] for row in db.query(User.id).all()]:
            try:
                found = anomaly_service.detect_recent_anomalies(db, uid)
                if not found:
                    continue
                lines = [f"₹{a['amount']:,.0f} — {a['description'] or 'no description'} ({a['date']})" for a in found]
                title = f"⚠️ {len(found)} unusual transaction(s) today"
                body = "\n".join(lines)
                if notify_service.send(db, uid, title, body):
                    sent += 1
            except Exception:
                logger.warning("Anomaly check failed for user %s", uid, exc_info=True)
    finally:
        db.close()
    return {"sent": sent}
