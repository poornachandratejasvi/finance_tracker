"""Celery task: the daily 'absence' notification-rule check.

Mirrors app/tasks/backup_tasks.py — runs once a day (Celery beat), and delegates
to notification_rules.run_absence_checks, which is itself idempotent per rule per
month (safe to call more than once a day without double-firing).
"""
import logging

from app.core.celery_app import celery_app

logger = logging.getLogger(__name__)


@celery_app.task(name="notifications.check_absence")
def check_absence_notifications():
    """Check every active 'absence' notification rule across all users."""
    from app.services.notification_rules import run_absence_checks

    fired = run_absence_checks()
    if fired:
        logger.info("Absence notification check: %d rule(s) fired", fired)
    return {"fired": fired}
