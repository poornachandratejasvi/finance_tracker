"""Backup endpoints: local + Google Drive snapshots of the whole database.

All per-user state lives in the existing AppSetting key/value table (no new models):

    backup_cfg:{uid}   JSON {enabled, frequency, destination, last_run_at}
    backup_hist:{uid}  JSON list of {filename, size, destination, drive_file_id, created_at}
    drive_creds:{uid}  JSON Google OAuth credentials for Drive uploads

The Google OAuth callback is intentionally NOT behind get_current_active_user:
Google redirects the browser there with no bearer token, so trust is established
by the signed state (reused from the oauth module) which binds the flow to a user.
Every other route requires an authenticated active user.
"""
import os
import json
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse, RedirectResponse
from sqlalchemy.orm import Session
from pydantic import BaseModel

from google_auth_oauthlib.flow import Flow

from app.core.database import get_db
from app.core.config import settings
from app.core.time_utils import utcnow
from app.api.endpoints.auth import get_current_active_user
# Reuse the signed, user-bound OAuth state helpers from the oauth module.
from app.api.endpoints.oauth import _make_oauth_state, _read_oauth_state
from app.models.models import User, AppSetting
from app.services import backup_service

router = APIRouter()
logger = logging.getLogger(__name__)

DRIVE_SCOPES = ['https://www.googleapis.com/auth/drive.file']

VALID_FREQUENCIES = ("hourly", "daily", "weekly")
VALID_DESTINATIONS = ("local", "drive")

DEFAULT_CFG = {
    "enabled": False,
    "frequency": "daily",
    "destination": "local",
    "last_run_at": None,
}

# Cap the stored history so the AppSetting value cannot grow without bound.
HISTORY_CAP = 100


# ──────────────────────────────────────────────────────────────────────────────
# AppSetting JSON key/value helpers
# ──────────────────────────────────────────────────────────────────────────────
def _cfg_key(uid: int) -> str:
    return f"backup_cfg:{uid}"


def _hist_key(uid: int) -> str:
    return f"backup_hist:{uid}"


def _creds_key(uid: int) -> str:
    return f"drive_creds:{uid}"


def _get_json(db: Session, key: str, default=None):
    row = db.query(AppSetting).filter(AppSetting.key == key).first()
    if not row or not row.value:
        return default
    try:
        return json.loads(row.value)
    except Exception:
        logger.warning("Corrupt JSON in AppSetting %s", key, exc_info=True)
        return default


def _set_json(db: Session, key: str, value) -> None:
    row = db.query(AppSetting).filter(AppSetting.key == key).first()
    if not row:
        row = AppSetting(key=key)
        db.add(row)
    row.value = json.dumps(value, default=str)
    db.commit()


def _delete_key(db: Session, key: str) -> bool:
    row = db.query(AppSetting).filter(AppSetting.key == key).first()
    if row:
        db.delete(row)
        db.commit()
        return True
    return False


def _get_cfg(db: Session, uid: int) -> dict:
    """Return the user's backup config merged over the defaults."""
    merged = dict(DEFAULT_CFG)
    stored = _get_json(db, _cfg_key(uid), None)
    if isinstance(stored, dict):
        merged.update(stored)
    return merged


def _get_history(db: Session, uid: int) -> list:
    hist = _get_json(db, _hist_key(uid), [])
    return hist if isinstance(hist, list) else []


def _drive_connected(db: Session, uid: int) -> bool:
    creds = _get_json(db, _creds_key(uid), None)
    return isinstance(creds, dict) and bool(creds)


# ──────────────────────────────────────────────────────────────────────────────
# Shared backup logic (imported by the Celery dispatcher too)
# ──────────────────────────────────────────────────────────────────────────────
def perform_backup(db: Session, user_id: int, destination: Optional[str] = None) -> dict:
    """Create a snapshot, always save it locally, optionally upload to Drive, and
    record a history entry (newest first). Returns the created history entry.

    Drive upload failures do not fail the backup — the local copy is always kept and
    the entry records the destination that actually succeeded.
    """
    cfg = _get_cfg(db, user_id)
    dest = (destination or cfg.get("destination") or "local").lower()

    filename, data = backup_service.create_snapshot(db)
    backup_service.save_local(filename, data)
    size = len(data)

    drive_file_id = None
    actual_dest = "local"
    if dest == "drive":
        creds = _get_json(db, _creds_key(user_id), None)
        if isinstance(creds, dict) and creds:
            try:
                drive_file_id = backup_service.upload_to_drive(creds, filename, data)
                actual_dest = "drive"
                # upload_to_drive may refresh the access token in place; persist it.
                _set_json(db, _creds_key(user_id), creds)
            except Exception:
                logger.warning(
                    "Drive upload failed for user %s; kept local copy", user_id, exc_info=True
                )
        else:
            logger.info("Drive requested for user %s but not connected; local only", user_id)

    entry = {
        "filename": filename,
        "size": size,
        "destination": actual_dest,
        "drive_file_id": drive_file_id,
        "created_at": utcnow().isoformat(),
    }

    history = _get_history(db, user_id)
    history.insert(0, entry)  # newest first
    _set_json(db, _hist_key(user_id), history[:HISTORY_CAP])
    return entry


# ──────────────────────────────────────────────────────────────────────────────
# Request models
# ──────────────────────────────────────────────────────────────────────────────
class RunRequest(BaseModel):
    destination: Optional[str] = None  # 'local' | 'drive' — overrides config


class ConfigUpdate(BaseModel):
    enabled: Optional[bool] = None
    frequency: Optional[str] = None
    destination: Optional[str] = None


# ──────────────────────────────────────────────────────────────────────────────
# Routes
# ──────────────────────────────────────────────────────────────────────────────
@router.get("/status")
def backup_status(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Overall backup status: Drive connection, latest backup, and config."""
    uid = current_user.id
    history = _get_history(db, uid)
    return {
        "drive_connected": _drive_connected(db, uid),
        "last_backup": history[0] if history else None,
        "config": _get_cfg(db, uid),
    }


@router.post("/run")
def run_backup(
    payload: Optional[RunRequest] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Run a backup now. Optional body {destination} overrides the saved config."""
    dest = payload.destination if payload else None
    if dest is not None and dest.lower() not in VALID_DESTINATIONS:
        raise HTTPException(status_code=400, detail="Invalid destination")
    try:
        return perform_backup(db, current_user.id, destination=dest)
    except Exception as exc:
        logger.error("Manual backup failed for user %s: %s", current_user.id, exc, exc_info=True)
        raise HTTPException(status_code=500, detail="Backup failed")


class DriveTokenRunRequest(BaseModel):
    access_token: str  # short-lived GIS access token (drive.file scope) from the browser


@router.post("/run-drive-token")
def run_backup_with_drive_token(
    payload: DriveTokenRunRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Client-ID-only Drive backup: the browser obtains a short-lived Drive access
    token via Google Identity Services and posts it here; the server uploads the
    snapshot with it. No client secret / credentials.json / refresh token involved."""
    if not payload.access_token:
        raise HTTPException(status_code=400, detail="Missing Google access token")
    filename, data = backup_service.create_snapshot(db)
    backup_service.save_local(filename, data)
    try:
        drive_file_id = backup_service.upload_to_drive({"token": payload.access_token}, filename, data)
    except Exception as exc:
        logger.error("Drive (token) upload failed for user %s: %s", current_user.id, exc, exc_info=True)
        raise HTTPException(status_code=502, detail=f"Drive upload failed: {str(exc)[:150]}")
    entry = {
        "filename": filename,
        "size": len(data),
        "destination": "drive",
        "drive_file_id": drive_file_id,
        "created_at": utcnow().isoformat(),
    }
    history = _get_history(db, current_user.id)
    history.insert(0, entry)
    _set_json(db, _hist_key(current_user.id), history[:HISTORY_CAP])
    return entry


@router.get("/history")
def backup_history(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Return the user's backup history, newest first."""
    return _get_history(db, current_user.id)


@router.get("/download/{filename}")
def download_backup(
    filename: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Download a local backup file. Rejects path traversal and only serves files
    recorded in the requesting user's own history."""
    if (
        not filename
        or "/" in filename
        or "\\" in filename
        or os.path.sep in filename
        or (os.path.altsep and os.path.altsep in filename)
        or ".." in filename
    ):
        raise HTTPException(status_code=400, detail="Invalid filename")

    # Only allow files that belong to this user (prevents cross-user access to the
    # shared backups directory).
    owned = any(e.get("filename") == filename for e in _get_history(db, current_user.id))
    path = os.path.join(backup_service.backups_dir(), filename)
    if not owned or not os.path.isfile(path):
        raise HTTPException(status_code=404, detail="Backup not found")

    return FileResponse(path, media_type="application/gzip", filename=filename)


@router.get("/config")
def get_config(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    return _get_cfg(db, current_user.id)


@router.put("/config")
def update_config(
    payload: ConfigUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Merge the provided fields into the saved config (preserves last_run_at)."""
    updates = payload.dict(exclude_unset=True)
    if "frequency" in updates and updates["frequency"] not in VALID_FREQUENCIES:
        raise HTTPException(status_code=400, detail="Invalid frequency")
    if "destination" in updates and updates["destination"] not in VALID_DESTINATIONS:
        raise HTTPException(status_code=400, detail="Invalid destination")

    cfg = _get_cfg(db, current_user.id)
    cfg.update(updates)
    _set_json(db, _cfg_key(current_user.id), cfg)
    return cfg


# ──────────────────────────────────────────────────────────────────────────────
# Google Drive OAuth
# ──────────────────────────────────────────────────────────────────────────────
def _credentials_path() -> str:
    return os.path.join(settings.BASE_DIR, 'credentials', 'credentials.json')


@router.get("/google/auth-url")
def google_auth_url(
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """Build the Drive OAuth consent URL. 503 if credentials.json is missing."""
    credentials_path = _credentials_path()
    if not os.path.exists(credentials_path):
        raise HTTPException(
            status_code=503,
            detail="Google Drive backup is not configured (credentials.json missing).",
        )
    try:
        flow = Flow.from_client_secrets_file(
            credentials_path,
            scopes=DRIVE_SCOPES,
            redirect_uri=f"{settings.BACKEND_URL}/api/backup/google/callback",
        )
        # Signed state binds this flow to the current user (CSRF protection).
        state = _make_oauth_state(current_user.id)
        authorization_url, _ = flow.authorization_url(
            access_type='offline',
            include_granted_scopes='true',
            prompt='consent',
            state=state,
        )
        return {"auth_url": authorization_url, "configured": True}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("Failed to build Drive auth URL: %s", exc, exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to build Drive auth URL")


@router.get("/google/callback")
def google_callback(code: str, state: str, db: Session = Depends(get_db)):
    """Handle the Drive OAuth callback. Trust comes from the signed state, not a
    bearer token (Google calls this directly)."""
    try:
        user_id = _read_oauth_state(state)
    except ValueError:
        logger.warning("Rejected Drive OAuth callback with invalid/expired state")
        return RedirectResponse(
            url=f"{settings.FRONTEND_URL}/settings?error=invalid_state", status_code=302
        )

    try:
        flow = Flow.from_client_secrets_file(
            _credentials_path(),
            scopes=DRIVE_SCOPES,
            redirect_uri=f"{settings.BACKEND_URL}/api/backup/google/callback",
            state=state,
        )
        flow.fetch_token(code=code)
        creds = flow.credentials
        creds_dict = {
            'token': creds.token,
            'refresh_token': creds.refresh_token,
            'token_uri': creds.token_uri,
            'client_id': creds.client_id,
            'client_secret': creds.client_secret,
            'scopes': creds.scopes,
            'expiry': creds.expiry.isoformat() if creds.expiry else None,
        }
        _set_json(db, _creds_key(user_id), creds_dict)
        return RedirectResponse(
            url=f"{settings.FRONTEND_URL}/settings?drive_connected=1", status_code=302
        )
    except Exception as exc:
        logger.error("Drive OAuth callback failed: %s", exc, exc_info=True)
        return RedirectResponse(
            url=f"{settings.FRONTEND_URL}/settings?error=drive_failed", status_code=302
        )


@router.post("/google/disconnect")
def google_disconnect(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Forget the stored Drive credentials for the current user."""
    _delete_key(db, _creds_key(current_user.id))
    return {"success": True, "drive_connected": False}
