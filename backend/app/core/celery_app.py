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
        "app.tasks.dedupe_tasks", "app.tasks.paperless_tasks", "app.tasks.ai_categorize_tasks",
        "app.tasks.stale_pending_tasks", "app.tasks.goal_sweep_tasks",
        "app.tasks.shipment_sync_tasks", "app.tasks.package_tracker_tasks", "app.tasks.calendar_reminder_tasks",
        "app.tasks.credit_card_bill_tasks",
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
    # Auto-merges and soft-deletes duplicate transactions (see
    # duplicate_resolution_service.py) -- the real-time SMS/alert/ingest dedupe
    # guard already stops most NEW duplicates at creation time, so this is a daily
    # safety-net sweep for the cases it can't see (a row already confirmed before
    # a later real-time source reports the same purchase) plus ongoing cleanup,
    # not the only time duplicates get resolved -- soft-deleted via the Recycle
    # Bin, so a wrong call is a restore away, not gone for good.
    "auto-resolve-duplicates": {
        "task": "transactions.auto_resolve_duplicates_all",
        "schedule": 24 * 60 * 60.0,
    },
    # Same "AI Categorize" a person could click manually, run for every user who
    # has an AI provider configured, so a new merchant no keyword rule recognizes
    # gets a real category (and a remembered rule + retroactive backfill, see
    # autorules.remember_category) without anyone needing to trigger it. Skips
    # users with no AI provider set up entirely -- see ai_service.is_configured.
    "ai-auto-categorize": {
        "task": "ai.auto_categorize_all",
        "schedule": 24 * 60 * 60.0,
    },
    # A pending (is_confirmed=False) transaction from a real-time alert/SMS/
    # Shortcut source is meant to be confirmed once the real statement arrives
    # and matches it (create_or_reconcile_transaction) -- but nothing ever
    # resolves one that never gets a match (a date/amount just outside
    # tolerance, a statement that never got parsed, etc), so it sits "Pending"
    # forever with no action ever taken. After a generous grace period the
    # money movement is certain either way (the bank already alerted on it) --
    # only whether it got double-checked against a statement line was ever in
    # question -- so auto-confirm anything this stale instead of leaving it as
    # a permanent, unresolvable nag. See app.tasks.stale_pending_tasks.
    "auto-confirm-stale-pending": {
        "task": "transactions.auto_confirm_stale_pending",
        "schedule": 24 * 60 * 60.0,
    },
    # Round-up savings already has an explicit per-goal opt-in (SavingsGoal.
    # roundup_enabled) -- this just runs the existing sweep-roundups action for
    # every goal that has it turned on, instead of someone needing to click it
    # per goal. Pure bookkeeping, already idempotent (roundup_swept flags each
    # transaction it touches). Predictive sweep is deliberately NOT automated
    # here -- see app.tasks.goal_sweep_tasks's docstring for why.
    "goals-auto-sweep-roundups": {
        "task": "goals.auto_sweep_roundups",
        "schedule": 24 * 60 * 60.0,
    },
    # Shipment-tracking emails (Amazon.in/Flipkart/courier confirmations) -- not
    # as latency-critical as bank alerts, so a lighter cadence than alert-email-sync.
    "shipment-email-sync": {
        "task": "shipments.sync_all",
        "schedule": 30 * 60.0,
    },
    # Live carrier-tracker refresh (community/unofficial endpoints) -- polled
    # gently to avoid drawing attention/rate-limits; email parsing already gives
    # same-day status for most updates, this just fills gaps it can't cover
    # (in-transit scan events with no corresponding email).
    "package-tracker-refresh": {
        "task": "packages.refresh_active",
        "schedule": 6 * 60 * 60.0,
    },
    # Package/subscription due-date reminders -- daily is enough lead time
    # without spamming; idempotent per item via last_reminder_sent_for.
    "calendar-reminders-daily": {
        "task": "calendar.check_upcoming",
        "schedule": 24 * 60 * 60.0,
    },
    # Credit-card bill due-date reminders -- daily is enough lead time for the
    # 5-day-before window without spamming; idempotent per due date.
    "credit-card-bill-reminders-daily": {
        "task": "credit_card_bills.check_reminders",
        "schedule": 24 * 60 * 60.0,
    },
}
