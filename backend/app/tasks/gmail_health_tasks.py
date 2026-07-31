"""Celery task: periodic Gmail account health check (see gmail_health_service.py).

Mirrors notification_tasks.py's shape — a thin task wrapper delegating to the
actual (idempotent) service logic.
"""
import logging

from app.core.celery_app import celery_app

logger = logging.getLogger(__name__)


@celery_app.task(name="gmail.check_health")
def check_gmail_health():
    """Check every stored Gmail account's token health across all users."""
    from app.services.gmail_health_service import run_health_checks

    notified = run_health_checks()
    if notified:
        logger.info("Gmail health check: %d account(s) newly flagged", notified)
    return {"notified": notified}
