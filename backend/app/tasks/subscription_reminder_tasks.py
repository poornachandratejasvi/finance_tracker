"""Celery task: daily check for upcoming subscription/bill renewals.

Mirrors credit_balance_tasks.py's per-user fan-out — recurring_detection has no
per-user "rule" row to iterate (unlike NotificationRule), so this walks every
user id directly.
"""
import logging

from app.core.celery_app import celery_app

logger = logging.getLogger(__name__)


@celery_app.task(name="subscriptions.check_upcoming_renewals")
def check_upcoming_renewals():
    """For every user, notify about any detected recurring bill/subscription due
    to charge again within the next couple of days."""
    from app.core.database import SessionLocal
    from app.models.models import User
    from app.services.recurring_detection import check_upcoming_renewals as _check

    db = SessionLocal()
    total_sent = 0
    try:
        user_ids = [row[0] for row in db.query(User.id).all()]
        for uid in user_ids:
            try:
                total_sent += _check(db, uid)
            except Exception:
                logger.warning("Renewal reminder check failed for user %s", uid, exc_info=True)
    finally:
        db.close()

    if total_sent:
        logger.info("Subscription renewal reminders: %d sent", total_sent)
    return {"sent": total_sent}
