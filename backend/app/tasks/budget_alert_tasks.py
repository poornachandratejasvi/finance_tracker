"""Celery task: daily budget-threshold alert check for every user.

budget_service.check_and_alert was previously only invoked at the tail of a
Gmail sync run (sync.py), so a budget threshold crossed by a manually-entered,
SMS-ingested, PDF-imported, or Shortcuts-ingested transaction never got an alert
unless a Gmail sync happened to run afterward. This periodic task covers every
ingestion path; check_and_alert is itself idempotent per month per budget
(last_alerted_period), so running it daily (or from a sync too) never double-fires.
"""
import logging

from app.core.celery_app import celery_app

logger = logging.getLogger(__name__)


@celery_app.task(name="budgets.check_all_alerts")
def check_all_budget_alerts():
    from app.core.database import SessionLocal
    from app.models.models import User
    from app.services.budget_service import check_and_alert

    db = SessionLocal()
    total_sent = 0
    try:
        user_ids = [row[0] for row in db.query(User.id).all()]
        for uid in user_ids:
            try:
                total_sent += check_and_alert(db, uid)
            except Exception:
                logger.warning("Budget alert check failed for user %s", uid, exc_info=True)
    finally:
        db.close()

    if total_sent:
        logger.info("Budget alerts: %d sent", total_sent)
    return {"sent": total_sent}
