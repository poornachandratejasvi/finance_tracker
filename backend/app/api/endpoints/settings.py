from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
import os
import json

from app.core.database import get_db
from app.core.time_utils import utcnow
from app.api.endpoints.auth import get_current_active_user
from app.models.models import User, SyncSchedule, Budget
from app.services.discord_notifier import discord_notifier
from app.services import budget_service

router = APIRouter()

# ──────────────────────────────────────────────────────────────────────────────
# In-process key-value store for settings that don't need a DB migration
# ──────────────────────────────────────────────────────────────────────────────
_settings_store: Dict[str, Any] = {}


def _load_settings_file() -> Dict[str, Any]:
    path = os.getenv("SETTINGS_FILE", "/app/data/app_settings.json")
    if os.path.exists(path):
        try:
            with open(path) as f:
                return json.load(f)
        except Exception:
            pass
    return {}


def _save_settings_file(data: Dict[str, Any]) -> None:
    path = os.getenv("SETTINGS_FILE", "/app/data/app_settings.json")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    try:
        with open(path, "w") as f:
            json.dump(data, f, indent=2, default=str)
    except Exception:
        pass


# Load on startup
_settings_store.update(_load_settings_file())


class WebhookURL(BaseModel):
    webhook_url: str


def _get_app_setting(db: Session, key: str, default: str = "") -> str:
    from app.models.models import AppSetting
    row = db.query(AppSetting).filter(AppSetting.key == key).first()
    return (row.value if row and row.value else default)


def _set_app_setting(db: Session, key: str, value: str) -> None:
    from app.models.models import AppSetting
    row = db.query(AppSetting).filter(AppSetting.key == key).first()
    if not row:
        row = AppSetting(key=key)
        db.add(row)
    row.value = value
    db.commit()


@router.get("/discord-webhook")
def get_discord_webhook(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    """Get current Discord webhook URL (DB-persisted, env as fallback)."""
    webhook_url = _get_app_setting(db, "discord_webhook_url", os.getenv('DISCORD_WEBHOOK_URL', ''))
    return {"webhook_url": webhook_url}


@router.post("/discord-webhook")
def save_discord_webhook(
    webhook_data: WebhookURL,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    """Save the Discord webhook URL to the DB so the sync worker and beat scheduler
    (separate processes) all use it, and it survives restarts."""
    _set_app_setting(db, "discord_webhook_url", webhook_data.webhook_url or "")
    # Update the in-process notifier immediately.
    discord_notifier.webhook_url = webhook_data.webhook_url or ""
    discord_notifier._cached_at = 0.0
    return {
        "success": True,
        "message": "Discord webhook saved.",
        "webhook_url": (webhook_data.webhook_url[:50] + "...") if len(webhook_data.webhook_url or "") > 50 else webhook_data.webhook_url,
    }


@router.post("/discord-webhook/test")
def test_discord_webhook(
    current_user: User = Depends(get_current_active_user)
):
    """Send test notification to Discord"""
    try:
        if not discord_notifier.enabled:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Discord webhook not configured. Please set webhook URL first."
            )
        
        success = discord_notifier.send_notification(
            title="🧪 Test Notification",
            description=f"This is a test notification from Finance Tracker!\n\nTriggered by: **{current_user.username}**",
            color=0x00ff00  # Green
        )
        
        if success:
            return {
                "success": True,
                "message": "Test notification sent successfully! Check your Discord channel."
            }
        else:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to send test notification. Check webhook URL and try again."
            )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to send test notification: {str(e)}"
        )


# ──────────────────────────────────────────────────────────────────────────────
# Paperless-ngx -- archive scanned receipts there instead of this app trying to
# be its own document store. See app.services.paperless_service.
# ──────────────────────────────────────────────────────────────────────────────
class PaperlessConfig(BaseModel):
    base_url: str
    api_token: Optional[str] = None  # omit to leave an already-saved token untouched


@router.get("/paperless-config")
def get_paperless_config(db: Session = Depends(get_db), current_user: User = Depends(get_current_active_user)):
    from app.services import paperless_service
    return paperless_service.get_config(db)


@router.post("/paperless-config")
def save_paperless_config(
    data: PaperlessConfig,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    from app.services import paperless_service
    paperless_service.set_config(db, data.base_url, data.api_token)
    return paperless_service.get_config(db)


@router.post("/paperless-config/test")
def test_paperless_config(db: Session = Depends(get_db), current_user: User = Depends(get_current_active_user)):
    from app.services import paperless_service
    if not paperless_service.is_configured(db):
        raise HTTPException(status_code=400, detail="Paperless-ngx isn't configured yet -- set the URL and API token first.")
    if not paperless_service.test_connection(db):
        raise HTTPException(status_code=400, detail="Couldn't reach Paperless-ngx with those settings -- check the URL and token.")
    return {"success": True, "message": "Connected to Paperless-ngx successfully."}


# ──────────────────────────────────────────────────────────────────────────────
# Extra notification services (Apprise) -- Discord (above) is one target among
# many; these are any other Apprise-supported service URLs (Telegram, Slack,
# email, ntfy, Pushover, ...). See app.services.notify_service.
# ──────────────────────────────────────────────────────────────────────────────
class NotifyURLs(BaseModel):
    urls: List[str] = []


@router.get("/notify-urls")
def get_notify_urls(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    from app.services import notify_service
    return {"urls": notify_service.get_extra_urls(db, current_user.id)}


@router.post("/notify-urls")
def save_notify_urls(
    payload: NotifyURLs,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Save extra Apprise service URLs, e.g. tgram://bottoken/ChatID,
    mailto://user:pass@gmail.com, ntfy://topic. One entry per service; see
    github.com/caronc/apprise#popular-notification-services for the full list
    and URL format per service."""
    from app.services import notify_service
    notify_service.set_extra_urls(db, current_user.id, payload.urls)
    return {"success": True, "count": len(notify_service.get_extra_urls(db, current_user.id))}


@router.post("/notify-urls/test")
def test_notify_urls(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Send a test notification to every configured target (Discord webhook +
    any extra Apprise URLs)."""
    from app.services import notify_service
    ok, message = notify_service.send_test(db, current_user.id)
    if not ok:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=message)
    return {"success": True, "message": message}


# ──────────────────────────────────────────────────────────────────────────────
# Scheduled Sync Settings
# ──────────────────────────────────────────────────────────────────────────────

class ScheduleSettings(BaseModel):
    enabled: bool = False
    frequency: str = "daily"   # hourly, every4h, daily, weekly
    hour: int = 9              # 0-23 — used for daily/weekly
    day_of_week: int = 1       # 1=Monday … 7=Sunday — used for weekly
    notify_on_completion: bool = True
    auto_generate_csv: bool = False
    csv_email_on_sync: bool = False


@router.get("/schedule")
def get_schedule(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    sched = db.query(SyncSchedule).filter(SyncSchedule.user_id == current_user.id).first()
    if not sched:
        return ScheduleSettings().dict()
    return {
        "enabled": sched.enabled,
        "frequency": sched.frequency,
        "hour": sched.hour,
        "day_of_week": sched.day_of_week,
        "notify_on_completion": sched.notify_on_completion,
        "auto_generate_csv": sched.auto_generate_csv,
        "csv_email_on_sync": sched.csv_email_on_sync,
        "last_run_at": sched.last_run_at.isoformat() + "Z" if sched.last_run_at else None,
    }


@router.post("/schedule")
def save_schedule(
    payload: ScheduleSettings,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Persist the per-user auto-sync schedule (read by the Celery beat dispatcher)."""
    sched = db.query(SyncSchedule).filter(SyncSchedule.user_id == current_user.id).first()
    if not sched:
        sched = SyncSchedule(user_id=current_user.id)
        db.add(sched)
    sched.enabled = payload.enabled
    sched.frequency = payload.frequency
    sched.hour = payload.hour
    sched.day_of_week = payload.day_of_week
    sched.notify_on_completion = payload.notify_on_completion
    sched.auto_generate_csv = payload.auto_generate_csv
    sched.csv_email_on_sync = payload.csv_email_on_sync
    db.commit()
    return {"success": True, **payload.dict()}


# ──────────────────────────────────────────────────────────────────────────────
# Budget Alerts Settings
# ──────────────────────────────────────────────────────────────────────────────

class BudgetEntry(BaseModel):
    category: str
    monthly_limit: float
    alert_at_pct: int = 80  # send alert when this % is spent


class BudgetSettings(BaseModel):
    budgets: List[BudgetEntry] = []
    alert_email: str = ""
    discord_alerts: bool = True


def _budget_prefs_key(user_id: int) -> str:
    return f"budget_prefs:{user_id}"


@router.get("/budgets")
def get_budgets(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    rows = db.query(Budget).filter(Budget.user_id == current_user.id).order_by(Budget.category).all()
    prefs = _settings_store.get(_budget_prefs_key(current_user.id), {})
    return {
        "budgets": [
            {"category": b.category, "monthly_limit": b.monthly_limit, "alert_at_pct": b.alert_at_pct}
            for b in rows
        ],
        "alert_email": prefs.get("alert_email", ""),
        "discord_alerts": prefs.get("discord_alerts", True),
    }


@router.post("/budgets")
def save_budgets(
    payload: BudgetSettings,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Replace the user's budgets. Preserves the per-category monthly-alert guard for
    categories that already existed."""
    existing = {b.category: b for b in db.query(Budget).filter(Budget.user_id == current_user.id).all()}
    seen = set()
    for entry in payload.budgets:
        seen.add(entry.category)
        b = existing.get(entry.category)
        if not b:
            b = Budget(user_id=current_user.id, category=entry.category)
            db.add(b)
        b.monthly_limit = entry.monthly_limit
        b.alert_at_pct = entry.alert_at_pct
    for cat, b in existing.items():
        if cat not in seen:
            db.delete(b)
    db.commit()
    _settings_store[_budget_prefs_key(current_user.id)] = {
        "alert_email": payload.alert_email,
        "discord_alerts": payload.discord_alerts,
    }
    _save_settings_file(_settings_store)
    return {"success": True, **payload.dict()}


@router.get("/budgets/status")
def get_budget_status(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Current-month spend vs limit per budgeted category."""
    return budget_service.compute_status(db, current_user.id)


# ──────────────────────────────────────────────────────────────────────────────
# App-level system info
# ──────────────────────────────────────────────────────────────────────────────
@router.get("/system-info")
def get_system_info(current_user: User = Depends(get_current_active_user)):
    import multiprocessing
    from app.core.config import settings as app_settings
    return {
        "cpu_count": multiprocessing.cpu_count(),
        "max_workers": app_settings.MAX_WORKERS,
        "app_version": app_settings.APP_VERSION,
    }

