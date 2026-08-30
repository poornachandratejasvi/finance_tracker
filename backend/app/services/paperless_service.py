"""Paperless-ngx integration: archive a scanned receipt as a searchable,
OCR'd document there instead of this app trying to be its own document store,
and link it back to the transaction it belongs to.

Configured globally (Settings -> External Accounts -> Paperless-ngx), not
per-user -- this app is single-user in practice (same shortcut Discord's
legacy webhook key already takes, see discord_service.py) and Paperless-ngx
is meant to be one shared document store for the household, not a per-user
account.
"""
import logging
from typing import Optional, Tuple

import httpx
from sqlalchemy.orm import Session

from app.models.models import AppSetting
from app.core.crypto import encrypt_value, decrypt_value

logger = logging.getLogger(__name__)

_BASE_URL_KEY = "paperless_base_url"
_TOKEN_KEY = "paperless_api_token"


def set_config(db: Session, base_url: Optional[str], api_token: Optional[str] = None) -> None:
    """api_token=None leaves the stored token untouched (so re-saving just the
    URL doesn't require re-entering the token); api_token="" clears it."""
    base_url = (base_url or "").strip().rstrip("/")
    row = db.query(AppSetting).filter(AppSetting.key == _BASE_URL_KEY).first()
    if not base_url:
        if row:
            db.delete(row)
    elif row:
        row.value = base_url
    else:
        db.add(AppSetting(key=_BASE_URL_KEY, value=base_url))

    if api_token is not None:
        token_row = db.query(AppSetting).filter(AppSetting.key == _TOKEN_KEY).first()
        if not api_token:
            if token_row:
                db.delete(token_row)
        else:
            enc = encrypt_value(api_token.strip())
            if token_row:
                token_row.value = enc
            else:
                db.add(AppSetting(key=_TOKEN_KEY, value=enc))
    db.commit()


def get_config(db: Session) -> dict:
    """Status for the Settings UI -- never returns the token itself, just
    whether one is stored."""
    base_row = db.query(AppSetting).filter(AppSetting.key == _BASE_URL_KEY).first()
    _, token = _get_creds(db)
    return {"base_url": base_row.value if base_row else None, "has_token": bool(token)}


def _get_creds(db: Session) -> Tuple[Optional[str], Optional[str]]:
    base_row = db.query(AppSetting).filter(AppSetting.key == _BASE_URL_KEY).first()
    token_row = db.query(AppSetting).filter(AppSetting.key == _TOKEN_KEY).first()
    if not base_row or not base_row.value or not token_row or not token_row.value:
        return None, None
    try:
        token = decrypt_value(token_row.value)
    except Exception:
        return base_row.value, None
    return base_row.value, token


def is_configured(db: Session) -> bool:
    base_url, token = _get_creds(db)
    return bool(base_url and token)


def test_connection(db: Session) -> bool:
    base_url, token = _get_creds(db)
    if not base_url or not token:
        return False
    try:
        r = httpx.get(f"{base_url}/api/", headers={"Authorization": f"Token {token}"}, timeout=10)
        return r.status_code == 200
    except Exception:
        logger.warning("Paperless-ngx connection test failed", exc_info=True)
        return False


def upload_document(db: Session, file_bytes: bytes, filename: str, title: Optional[str] = None) -> Optional[str]:
    """Submits a document to Paperless-ngx's consume pipeline. Returns the
    async task ID Paperless immediately hands back -- the document itself is
    OCR'd/indexed in the background, sometimes taking well past what an HTTP
    request should block for. See resolve_document_id() to turn this into a
    real document ID once processing finishes (app.tasks.paperless_tasks)."""
    base_url, token = _get_creds(db)
    if not base_url or not token:
        return None
    try:
        files = {"document": (filename, file_bytes)}
        data = {"title": title} if title else {}
        r = httpx.post(
            f"{base_url}/api/documents/post_document/",
            headers={"Authorization": f"Token {token}"},
            files=files, data=data, timeout=60,
        )
        r.raise_for_status()
        task_id = r.text.strip().strip('"')
        return task_id or None
    except Exception:
        logger.warning("Paperless-ngx upload failed", exc_info=True)
        return None


def resolve_document_id(db: Session, task_id: str) -> Optional[int]:
    """Polls Paperless's task-status endpoint once. Returns the resulting
    document ID if the consume task finished successfully, None otherwise
    (still running, or failed -- caller decides whether to retry)."""
    base_url, token = _get_creds(db)
    if not base_url or not token:
        return None
    try:
        r = httpx.get(
            f"{base_url}/api/tasks/", params={"task_id": task_id},
            headers={"Authorization": f"Token {token}"}, timeout=15,
        )
        r.raise_for_status()
        results = r.json()
        if not results:
            return None
        task = results[0]
        if task.get("status") == "SUCCESS":
            return task.get("related_document")
        if task.get("status") == "FAILURE":
            logger.warning("Paperless-ngx consume task %s failed: %s", task_id, task.get("result"))
        return None
    except Exception:
        logger.warning("Paperless-ngx task poll failed", exc_info=True)
        return None


def document_url(db: Session, document_id: Optional[int]) -> Optional[str]:
    if not document_id:
        return None
    base_url, _ = _get_creds(db)
    if not base_url:
        return None
    return f"{base_url}/documents/{document_id}/"
