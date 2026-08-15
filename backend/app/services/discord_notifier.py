import os
import time
import logging
from typing import Optional

logger = logging.getLogger(__name__)

WEBHOOK_SETTING_KEY = "discord_webhook_url"


class DiscordNotifier:
    """Discord webhook integration for Finance Tracker notifications.

    The webhook URL is stored in the DB (AppSetting) so every process — web, Celery
    worker, and beat — uses the same value and it survives restarts. The env var
    DISCORD_WEBHOOK_URL still works as a fallback/override.
    """

    _CACHE_TTL = 30  # seconds

    def __init__(self, webhook_url: Optional[str] = None):
        self._env_webhook = webhook_url or os.getenv('DISCORD_WEBHOOK_URL') or ''
        self.webhook_url = self._env_webhook
        self._cached_at = 0.0

    def _refresh_webhook(self) -> None:
        """Load the webhook from the DB (cached briefly). Env var takes precedence."""
        if self._env_webhook:
            self.webhook_url = self._env_webhook
            return
        now = time.time()
        if now - self._cached_at < self._CACHE_TTL:
            return
        self._cached_at = now
        try:
            from app.core.database import SessionLocal
            from app.models.models import AppSetting
            db = SessionLocal()
            try:
                row = db.query(AppSetting).filter(AppSetting.key == WEBHOOK_SETTING_KEY).first()
                self.webhook_url = (row.value if row else '') or ''
            finally:
                db.close()
        except Exception:
            logger.debug("Could not load Discord webhook from DB", exc_info=True)

    @property
    def enabled(self) -> bool:
        self._refresh_webhook()
        return bool(self.webhook_url)

    def send_notification(self, title: str, description: str, color: int = 0x00ff00, fields: list = None):
        """
        Send a sync-lifecycle/budget-alert notification via Apprise -- fans out to
        this instance's Discord webhook plus any other Apprise service URLs the
        app owner has configured (Settings -> Automation -> Notifications; see
        notify_service.py). This class has no per-user concept (it's a
        module-level singleton predating multi-service support), so it treats
        user id 1 as the app owner, matching this app's existing documented
        single-user-in-practice assumption elsewhere.

        Args:
            title: Notification title
            description: Notification description
            color: unused (kept for call-site compatibility -- Apprise's common
                notify() has no per-service color/embed concept)
            fields: List of {"name": "...", "value": "...", "inline": bool} dicts,
                flattened into plain text lines in the body
        """
        if not self.enabled:
            return False

        try:
            import apprise
            from app.services.notify_service import _discord_to_apprise, get_extra_urls
            from app.core.database import SessionLocal

            body_lines = [description]
            for f in (fields or []):
                body_lines.append(f"{f.get('name', '')}: {f.get('value', '')}")
            body = "\n".join(body_lines)

            a = apprise.Apprise()
            a.add(_discord_to_apprise(self.webhook_url))
            db = SessionLocal()
            try:
                for url in get_extra_urls(db, uid=1):
                    a.add(url)
            finally:
                db.close()

            return a.notify(title=title[:256], body=body[:4000])

        except Exception as e:
            logger.warning("Failed to send notification: %s", e, exc_info=True)
            return False
    
    def notify_new_data(self, bank_name: str, transaction_count: int, pdf_file: str = None):
        """Notify about new data fetched"""
        fields = [
            {"name": "Bank", "value": bank_name, "inline": True},
            {"name": "Transactions", "value": str(transaction_count), "inline": True}
        ]
        
        if pdf_file:
            fields.append({"name": "Source", "value": pdf_file, "inline": False})
        
        self.send_notification(
            title="📊 New Data Fetched",
            description=f"Successfully fetched new data from {bank_name}",
            color=0x00ff00,  # Green
            fields=fields
        )
    
    def notify_error(self, bank_name: str, error_message: str, operation: str = "sync"):
        """Notify about errors"""
        self.send_notification(
            title="❌ Error Occurred",
            description=f"Error during {operation} for {bank_name}",
            color=0xff0000,  # Red
            fields=[
                {"name": "Bank", "value": bank_name, "inline": True},
                {"name": "Operation", "value": operation, "inline": True},
                {"name": "Error", "value": error_message[:1000], "inline": False}
            ]
        )
    
    def notify_sync_started(self, bank_name: str):
        """Notify when sync starts"""
        self.send_notification(
            title="🔄 Sync Started",
            description=f"Started syncing data for {bank_name}",
            color=0xffff00,  # Yellow
            fields=[
                {"name": "Bank", "value": bank_name, "inline": True},
                {"name": "Status", "value": "In Progress", "inline": True}
            ]
        )
    
    def notify_sync_completed(self, bank_name: str, new_transactions: int, total_transactions: int):
        """Notify when sync completes"""
        self.send_notification(
            title="✅ Sync Completed",
            description=f"Sync completed for {bank_name}",
            color=0x00ff00,  # Green
            fields=[
                {"name": "Bank", "value": bank_name, "inline": True},
                {"name": "New Transactions", "value": str(new_transactions), "inline": True},
                {"name": "Total Transactions", "value": str(total_transactions), "inline": True}
            ]
        )


# Global instance
discord_notifier = DiscordNotifier()
