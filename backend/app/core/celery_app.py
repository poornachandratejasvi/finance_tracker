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
    include=[
        "app.tasks.sync_tasks", "app.tasks.backup_tasks", "app.tasks.notification_tasks",
        "app.tasks.gmail_health_tasks", "app.tasks.alert_sync_tasks", "app.tasks.credit_balance_tasks",
        "app.tasks.watcher_tasks", "app.tasks.reward_points_tasks", "app.tasks.subscription_reminder_tasks",
        "app.tasks.budget_alert_tasks", "app.tasks.balance_alert_tasks", "app.tasks.recycle_bin_tasks",
    ],
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
    # Real-time spend/credit alert emails — checked often since the whole point
    # is near-real-time visibility well before the monthly statement PDF arrives.
    "alert-email-sync": {
        "task": "alerts.sync_all",
        "schedule": 15 * 60.0,
    },
    # Keeps credit-card outstanding balances fresh without anyone needing to
    # remember to click "Redetect Credit Balances" — a no-op ("unchanged") if
    # the latest statement hasn't changed, and skips any card the user has
    # manually set (balance_source='manual') so it never overwrites that.
    "credit-balance-redetect": {
        "task": "credit_balance.redetect_all",
        "schedule": 24 * 60 * 60.0,
    },
    # Flags credit cards with no transaction in 60+ days: Discord notification, a
    # visible Jobs-page entry, and a one-time balance reset to 0 (see
    # credit_balance_tasks.notify_stale_credit_cards for the self-limiting guard).
    "credit-balance-stale-check": {
        "task": "credit_balance.notify_stale_cards",
        "schedule": 24 * 60 * 60.0,
    },
    # Creates each active TransactionWatcher's Google Task for its current period
    # (daily/weekly/monthly/yearly) — hourly, not pinned to exact boundaries, so a
    # daily/weekly watcher's task shows up promptly and a missed run self-heals.
    "watcher-monthly-tasks": {
        "task": "watchers.create_monthly_tasks",
        "schedule": 60 * 60.0,
    },
    # Reward points don't change minute-to-minute, and an expiry is always weeks
    # out by the time it's first crossed a warning threshold -- once a day is
    # plenty (same cadence as the other credit-card checks above).
    "reward-points-expiry-check": {
        "task": "reward_points.check_expiring",
        "schedule": 24 * 60 * 60.0,
    },
    # Subscription/bill renewal reminders -- a predicted due date only ever moves
    # by a day or so between runs, so once a day is enough lead time without
    # spamming; idempotency is per predicted due date (see recurring_detection.py).
    "subscription-renewal-reminders": {
        "task": "subscriptions.check_upcoming_renewals",
        "schedule": 24 * 60 * 60.0,
    },
    # Covers ingestion paths (manual/SMS/PDF-import/Shortcuts) that never trigger
    # the Gmail-sync-tail budget check in sync.py -- idempotent per user per month.
    "budget-alerts-daily": {
        "task": "budgets.check_all_alerts",
        "schedule": 24 * 60 * 60.0,
    },
    # Balance is only ever updated by a sync/redetect event, not continuously --
    # hourly is a cheap safety margin that still notices a breach promptly.
    "balance-alerts-hourly": {
        "task": "balance_alerts.check_all",
        "schedule": 60 * 60.0,
    },
    # Recycle Bin: a deleted transaction is restorable for 30 days, then hard-purged.
    # Once a day is plenty since the grace window is measured in days, not hours.
    "recycle-bin-purge": {
        "task": "recycle_bin.purge_expired",
        "schedule": 24 * 60 * 60.0,
    },
}
