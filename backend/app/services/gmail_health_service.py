"""Gmail account health monitoring.

Reactive checks already existed (banks.py's /gmail-accounts/status, run whenever
the user happens to open that page, and sync.py flipping is_active off mid-sync
on invalid_grant) — but nothing proactively watched these tokens, so a broken
connection could sit silently for days until someone noticed missing data. This
adds a periodic Celery-beat check that fires Discord + creates a Google Task the
moment a connection actually breaks (idempotent per outage via
reauth_notified_at), reusing the exact same channels the notification-rules
engine uses.
"""
import json
import logging

from google.auth.transport.requests import Request as GoogleRequest

from app.core.time_utils import utcnow
from app.models.models import GmailAccount
from app.services.gmail_service import credentials_from_dict, GmailService
from app.services import discord_service, google_tasks_service
from app.services.backup_service import get_drive_creds

logger = logging.getLogger(__name__)


def _fire(db, uid: int, subject: str, body: str) -> dict:
    """Fan out to Discord + a Google Task, reporting each channel's outcome
    independently — same pattern as notification_rules._fire."""
    result = {}
    try:
        sent = discord_service.send_discord_message(db, uid, subject, body)
        result["discord"] = "sent" if sent else "no webhook configured"
    except Exception as e:
        result["discord"] = f"failed: {str(e)[:150]}"
    try:
        creds = get_drive_creds(db, uid)
        if not creds:
            result["task"] = "Google Drive/Tasks not connected (Settings → Backup)"
        else:
            task_id = google_tasks_service.create_task(creds, subject, body)
            result["task"] = f"created (id {task_id})"
    except Exception as e:
        result["task"] = f"failed: {str(e)[:150]}"
    return result


def check_account_health(db, account: GmailAccount) -> dict:
    """Validate one account's stored credentials in place. Mutates
    is_active/last_error/last_checked_at on the account (caller commits).

    IMPORTANT: only a genuine 'invalid_grant' (the refresh token itself is dead —
    revoked, expired, etc.) or missing credentials counts as a real failure that
    deactivates the account. Any other exception, or a reachable-but-empty
    profile response, is treated as TRANSIENT (network blip, momentary API
    hiccup) and does NOT flip is_active — this exact distinction was already
    hard-learned once in banks.py's original reactive status check ("transient
    failures must NOT deactivate the account — that was a cause of 'sync finds
    no accounts'"), so it's preserved here rather than re-broken.

    Returns {healthy: bool, error: str|None, transient: bool}. 'healthy' mirrors
    the (possibly unchanged) is_active for transient cases, so callers can tell
    "still fine" from "genuinely just broke" without inspecting the account.
    """
    account.last_checked_at = utcnow()

    creds_dict = json.loads(account.credentials) if isinstance(account.credentials, str) else account.credentials
    if not creds_dict:
        account.is_active = False
        account.last_error = "No stored credentials"
        return {"healthy": False, "error": account.last_error, "transient": False}

    try:
        creds = credentials_from_dict(creds_dict)
        if creds.expired and creds.refresh_token:
            creds.refresh(GoogleRequest())

        # Persist the (possibly refreshed) token so the next check/sync reuses it.
        account.credentials = json.dumps({
            'token': creds.token,
            'refresh_token': creds.refresh_token,
            'token_uri': creds.token_uri,
            'client_id': creds.client_id,
            'client_secret': creds.client_secret,
            'scopes': list(creds.scopes) if creds.scopes else None,
            'expiry': creds.expiry.isoformat() if creds.expiry else None,
        })

        email = GmailService().test_connection(creds)
        if email:
            account.is_active = True
            account.last_error = None
            return {"healthy": True, "error": None, "transient": False}

        account.last_error = "Transient: reachable but the profile fetch returned nothing"
        return {"healthy": account.is_active, "error": account.last_error, "transient": True}
    except Exception as exc:
        msg = str(exc)
        if 'invalid_grant' in msg:
            account.is_active = False
            account.last_error = msg[:500]
            return {"healthy": False, "error": account.last_error, "transient": False}
        logger.warning("Transient Gmail health-check error for %s: %s", account.email, exc)
        account.last_error = f"Transient: {msg[:400]}"
        return {"healthy": account.is_active, "error": account.last_error, "transient": True}


def run_health_checks(db=None) -> int:
    """Celery beat entrypoint: check every Gmail account. Notifies once per
    continuous outage (reauth_notified_at guards against re-notifying every tick;
    it's cleared the moment the account is healthy again so a FUTURE outage
    notifies fresh). Returns how many accounts newly triggered a notification."""
    own_db = db is None
    if own_db:
        from app.core.database import SessionLocal
        db = SessionLocal()
    notified = 0
    try:
        accounts = db.query(GmailAccount).all()
        for account in accounts:
            try:
                result = check_account_health(db, account)
                if result["healthy"]:
                    account.reauth_notified_at = None
                elif result["transient"]:
                    pass  # not a real outage — never notify or touch the guard for these
                elif not account.reauth_notified_at:
                    subject = f"⚠️ Gmail account needs reauthorization: {account.email}"
                    body = (
                        f"The stored Gmail connection for {account.email} stopped working:\n"
                        f"{account.last_error or 'unknown error'}\n\n"
                        f"Reconnect it from Settings → Gmail Accounts."
                    )
                    _fire(db, account.user_id, subject, body)
                    account.reauth_notified_at = utcnow()
                    notified += 1
                db.commit()
            except Exception:
                logger.warning("Health check failed for Gmail account %s", account.id, exc_info=True)
                db.rollback()
    finally:
        if own_db:
            db.close()
    return notified


def send_test_health_notification(db, account: GmailAccount) -> dict:
    """Manual 'send test notification' button — fires every channel with a canned
    message regardless of actual health, so the user can confirm delivery works."""
    subject = f"🧪 Test: Gmail health notification for {account.email}"
    body = f"This is a test of the Gmail-health alert channels for {account.email}."
    return _fire(db, account.user_id, subject, body)
