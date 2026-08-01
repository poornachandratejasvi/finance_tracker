"""Gmail Accounts — moved here from banks.py (was a tab on the Banks page,
now its own Settings tab) plus new health-monitoring surface: per-account
last_checked_at/last_error, a manual re-check, a test-notification button for
the Discord/Google-Task alert channels the periodic health check uses (see
gmail_health_service.py + tasks/gmail_health_tasks.py), and a credentials.json
upload so the server's Google OAuth client can be configured from the UI
instead of copying the file onto the server by hand.
"""
import os
import json
import logging
from typing import List

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.config import settings
from app.api.endpoints.auth import get_current_active_user
from app.models.models import User, UserRole, GmailAccount
from app.schemas.bank import GmailAccountResponse
from app.services.gmail_health_service import check_account_health, send_test_health_notification

router = APIRouter()
logger = logging.getLogger(__name__)


def _require_admin(current_user: User) -> None:
    if current_user.role != UserRole.ADMIN:
        raise HTTPException(status_code=403, detail="Admin access required")


@router.get("/", response_model=List[GmailAccountResponse])
def list_gmail_accounts(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    return db.query(GmailAccount).filter(GmailAccount.user_id == current_user.id).all()


@router.get("/status")
def get_gmail_accounts_status(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Validate every account and return live status (used by the Settings panel
    on load, and by the sync page to warn before a sync that has nothing to sync
    from)."""
    accounts = db.query(GmailAccount).filter(GmailAccount.user_id == current_user.id).all()
    results = []
    for account in accounts:
        result = check_account_health(db, account)
        if result["healthy"]:
            account.reauth_notified_at = None
            account_status = "connected"
        elif result["transient"]:
            account_status = "error"
        else:
            account_status = "reauth_required"
        results.append({
            "id": account.id,
            "email": account.email,
            "is_active": account.is_active,
            "last_synced": account.last_synced,
            "created_at": account.created_at,
            "last_checked_at": account.last_checked_at,
            "last_error": account.last_error,
            "status": account_status,
        })
    db.commit()
    return {"accounts": results, "total": len(results)}


@router.post("/sync-alerts-now")
def sync_alerts_now(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Manually check for new real-time bank spend/credit alert emails right
    now, instead of waiting for the next 15-minute beat tick — creates
    'Pending' transactions from any new alerts found (see alert_sync_service.py)."""
    from datetime import timedelta
    from app.core.time_utils import utcnow
    from app.models.models import Bank
    from app.services.alert_sync_service import sync_alert_emails

    accounts = db.query(GmailAccount).filter(GmailAccount.user_id == current_user.id).all()
    banks = db.query(Bank).filter(Bank.user_id == current_user.id).all()
    if not accounts or not banks:
        return {"created": 0}

    total_created = 0
    for account in accounts:
        try:
            total_created += sync_alert_emails(db, account, banks, after_date=utcnow() - timedelta(days=2))
        except Exception:
            logger.warning("Manual alert-email sync failed for account %s", account.id, exc_info=True)
    return {"created": total_created}


@router.post("/{account_id}/check-now", response_model=GmailAccountResponse)
def check_gmail_account_now(
    account_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Manually re-verify one account's token right now (instead of waiting for
    the next periodic beat check)."""
    account = db.query(GmailAccount).filter(
        GmailAccount.id == account_id, GmailAccount.user_id == current_user.id
    ).first()
    if not account:
        raise HTTPException(status_code=404, detail="Gmail account not found")
    check_account_health(db, account)
    if account.is_active:
        account.reauth_notified_at = None
    db.commit()
    db.refresh(account)
    return account


@router.post("/{account_id}/test-notification")
def test_gmail_notification(
    account_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Fire the Discord + Google Task channels with a canned message so the user
    can confirm the health-alert pathway actually works, without needing the
    account to be genuinely broken."""
    account = db.query(GmailAccount).filter(
        GmailAccount.id == account_id, GmailAccount.user_id == current_user.id
    ).first()
    if not account:
        raise HTTPException(status_code=404, detail="Gmail account not found")
    return {"result": send_test_health_notification(db, account)}


@router.delete("/{account_id}", status_code=204)
def disconnect_gmail_account(
    account_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Forget a Gmail account entirely (its BankEmail history is kept — only the
    OAuth connection itself is removed)."""
    account = db.query(GmailAccount).filter(
        GmailAccount.id == account_id, GmailAccount.user_id == current_user.id
    ).first()
    if not account:
        raise HTTPException(status_code=404, detail="Gmail account not found")
    db.delete(account)
    db.commit()
    return None


# ──────────────────────────────────────────────────────────────────────────────
# credentials.json upload — lets an admin configure the app's Google OAuth
# client from the UI instead of copying the file onto the server by hand.
# ──────────────────────────────────────────────────────────────────────────────
def _credentials_path() -> str:
    return os.path.join(settings.BASE_DIR, 'credentials', 'credentials.json')


@router.get("/google-credentials/status")
def google_credentials_status(current_user: User = Depends(get_current_active_user)):
    path = _credentials_path()
    if not os.path.exists(path):
        return {"configured": False}
    try:
        with open(path, encoding='utf-8') as f:
            data = json.load(f)
        kind = next(iter(data.keys()), None)
        block = data.get(kind, {}) if kind else {}
        client_id = block.get('client_id', '')
        return {
            "configured": True,
            "client_type": kind,
            "client_id_preview": f"{client_id[:24]}…" if client_id else None,
            "redirect_uris": block.get('redirect_uris', []),
        }
    except Exception:
        return {"configured": True, "client_type": None, "error": "credentials.json exists but failed to parse"}


@router.post("/google-credentials")
async def upload_google_credentials(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_active_user),
):
    """Replace credentials.json (admin-only). Validated as real Google OAuth
    client JSON before being written — a bad upload must not silently break
    every Google integration (Gmail + Drive + Tasks all share this one file)."""
    _require_admin(current_user)
    raw = await file.read()
    try:
        parsed = json.loads(raw)
        kind = next(iter(parsed.keys()), None)
        if kind not in ("installed", "web"):
            raise ValueError("expected a top-level 'installed' or 'web' key")
        if not parsed[kind].get("client_id") or not parsed[kind].get("client_secret"):
            raise ValueError("missing client_id/client_secret")
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Not a valid Google OAuth credentials.json: {exc}")

    path = _credentials_path()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'wb') as f:
        f.write(raw)
    logger.info("credentials.json replaced via Settings upload (type=%s)", kind)

    try:
        from app.main import _validate_google_config
        _validate_google_config()
    except Exception:
        logger.warning("Post-upload credentials.json validation failed", exc_info=True)

    return {"success": True, "client_type": kind}
