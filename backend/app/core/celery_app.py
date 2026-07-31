"""Celery application.

Broker and result backend both use Redis (already provisioned in docker-compose).
Start a worker with:

    celery -A app.core.celery_app:celery_app worker --loglevel=info
"""
from celery import Celery

from app.core.config import settings

celery_app = Celery(
    "finance_tracker",
    broker=settings.REDIS_URL,
    backend=settings.REDIS_URL,
    include=["app.tasks.sync_tasks", "app.tasks.backup_tasks", "app.tasks.notification_tasks", "app.tasks.gmail_health_tasks"],
)

celery_app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    task_track_started=True,
    task_time_limit=1800,        # hard limit: 30 min
    task_soft_time_limit=1740,   # soft limit: 29 min
    worker_max_tasks_per_child=50,
    broker_connection_retry_on_startup=True,
    timezone="UTC",
    enable_utc=True,
)

# Periodic scheduler (run by the `beat` service): check every minute whether any user's
# auto-sync schedule is due, and take daily balance snapshots.
celery_app.conf.beat_schedule = {
    "auto-sync-dispatch": {
        "task": "sync.dispatch_scheduled",
        "schedule": 60.0,
    },
    "auto-backup-dispatch": {
        "task": "backup.dispatch_scheduled",
        "schedule": 60.0,
    },
    # 'Absence' notification rules only need checking once a day (they fire at most
    # once per calendar month per rule, guarded by last_triggered_month) — every few
    # hours is a cheap safety margin against a missed run, not a tighter real check.
    "notification-absence-check": {
        "task": "notifications.check_absence",
        "schedule": 4 * 60 * 60.0,
    },
    # Gmail refresh tokens can be revoked/expired independently of the app's own
    # credentials.json (e.g. the OAuth consent screen being in "Testing" status
    # expires them after 7 days) — check every couple hours so a broken connection
    # is caught quickly rather than silently going stale for days.
    "gmail-health-check": {
        "task": "gmail.check_health",
        "schedule": 2 * 60 * 60.0,
    },
}
