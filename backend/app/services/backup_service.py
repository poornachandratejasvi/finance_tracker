"""Backup subsystem service.

Creates a gzipped JSON snapshot of every ORM table, stores it locally (with a
retention cap), and optionally uploads it to a dedicated Google Drive folder using
the ``drive.file`` scope.

Nothing in here calls ``datetime.now`` at import time — timestamps come from an
explicit ``stamp`` argument or :func:`app.core.time_utils.utcnow` inside the
functions — so importing this module (web / worker / beat) has no side effects.
"""
import io
import os
import gzip
import json
import logging
from typing import Optional

from google.oauth2.credentials import Credentials

from app.core.config import settings
from app.core.database import Base
from app.core.time_utils import utcnow

# Importing the models registers every table on Base.metadata so create_snapshot
# can iterate them, even if this service is imported before the models elsewhere.
import app.models.models  # noqa: F401

logger = logging.getLogger(__name__)

# drive.file limits access to files this app creates — the least privilege needed
# to write backups without seeing the rest of the user's Drive.
SCOPES = ['https://www.googleapis.com/auth/drive.file']

DRIVE_FOLDER_NAME = "FinanceTrackerBackups"
DRIVE_FOLDER_MIME = "application/vnd.google-apps.folder"
GZIP_MIME = "application/gzip"

# How many local backup files to retain (newest kept, older pruned).
LOCAL_RETENTION = 20


def backups_dir() -> str:
    """Absolute path to the local backups directory (created on demand)."""
    return os.path.join(settings.BASE_DIR, 'backups')


def create_snapshot(db, stamp: str = None):
    """Dump every ORM table to JSON and gzip it.

    Returns ``(filename, data)`` where ``data`` is the gzip-compressed bytes.
    ``stamp`` may be supplied by the caller; otherwise a UTC timestamp is used.
    """
    if not stamp:
        stamp = utcnow().strftime("%Y%m%d-%H%M%S")

    tables = {}
    for table in Base.metadata.sorted_tables:
        try:
            rows = db.execute(table.select()).mappings().all()
            tables[table.name] = [dict(row) for row in rows]
        except Exception:
            logger.warning("Failed to snapshot table %s", table.name, exc_info=True)
            tables[table.name] = []

    payload = {
        "generated_at": utcnow().isoformat(),
        "app_version": getattr(settings, "APP_VERSION", None),
        "tables": tables,
    }
    # default=str keeps datetimes/enums/Decimals serialisable without custom encoders.
    raw = json.dumps(payload, default=str, ensure_ascii=False).encode("utf-8")
    data = gzip.compress(raw)
    filename = f"finance-backup-{stamp}.json.gz"
    return filename, data


def save_local(filename: str, data: bytes) -> str:
    """Write ``data`` to the local backups dir and prune old files. Returns the path."""
    directory = backups_dir()
    os.makedirs(directory, exist_ok=True)
    path = os.path.join(directory, filename)
    with open(path, "wb") as fh:
        fh.write(data)
    _prune_local(directory, keep=LOCAL_RETENTION)
    return path


def restore_snapshot(db, data: bytes) -> dict:
    """Restore every table from a gzip snapshot produced by ``create_snapshot``.

    DESTRUCTIVE and NOT scoped to a single user — a snapshot contains every table
    for every user, so this replaces the whole application's data. Deletes all
    current rows in each backed-up table (children first, to satisfy foreign
    keys), reinserts the snapshot's rows (parents first), then resets each
    table's auto-increment sequence so future inserts don't collide with the
    restored explicit ids. Runs in a single transaction: any failure rolls back
    and leaves the live database exactly as it was.
    """
    raw = gzip.decompress(data)
    payload = json.loads(raw)
    tables_data = payload.get("tables") or {}
    if not isinstance(tables_data, dict):
        raise ValueError("Invalid backup file: missing 'tables'")

    sorted_tables = Base.metadata.sorted_tables  # parents before children
    row_counts = {}
    try:
        for table in reversed(sorted_tables):
            if table.name in tables_data:
                db.execute(table.delete())

        for table in sorted_tables:
            rows = tables_data.get(table.name)
            if not rows:
                continue
            db.execute(table.insert(), rows)
            row_counts[table.name] = len(rows)

        from sqlalchemy import text as _text
        for table in sorted_tables:
            if "id" not in table.c or table.name not in tables_data:
                continue
            db.execute(_text(
                f"SELECT setval(pg_get_serial_sequence('{table.name}', 'id'), "
                f"COALESCE((SELECT MAX(id) FROM {table.name}), 1), "
                f"(SELECT MAX(id) FROM {table.name}) IS NOT NULL)"
            ))

        db.commit()
    except Exception:
        db.rollback()
        raise

    return {
        "generated_at": payload.get("generated_at"),
        "app_version": payload.get("app_version"),
        "tables_restored": len(row_counts),
        "row_counts": row_counts,
    }


def _prune_local(directory: str, keep: int = LOCAL_RETENTION) -> None:
    """Keep only the ``keep`` newest backup files in ``directory``."""
    try:
        files = [
            os.path.join(directory, f)
            for f in os.listdir(directory)
            if f.startswith("finance-backup-") and f.endswith(".json.gz")
        ]
        files.sort(key=lambda p: os.path.getmtime(p), reverse=True)  # newest first
        for stale in files[keep:]:
            try:
                os.remove(stale)
            except OSError:
                logger.warning("Failed to prune old backup %s", stale, exc_info=True)
    except Exception:
        logger.warning("Backup pruning failed in %s", directory, exc_info=True)


def get_drive_creds(db, uid: int) -> Optional[dict]:
    """Read the stored offline Drive/Tasks OAuth credentials dict for a user (the
    same one connected via /api/backup/google/auth-url), or None if not connected.
    Shared accessor so other services (e.g. notification_rules) don't need to know
    the AppSetting key convention backup.py uses."""
    from app.models.models import AppSetting
    import json as _json
    row = db.query(AppSetting).filter(AppSetting.key == f"drive_creds:{uid}").first()
    if not row or not row.value:
        return None
    try:
        return _json.loads(row.value)
    except Exception:
        return None


def _build_credentials(creds_dict: dict) -> Credentials:
    """Build google Credentials from a stored dict.

    Tolerates the ``expiry`` ISO string produced by the OAuth callback (the
    Credentials constructor expects a datetime, not a string) and ignores any
    extra keys.
    """
    from datetime import datetime

    data = dict(creds_dict or {})
    expiry = data.pop("expiry", None)
    allowed = {"token", "refresh_token", "token_uri", "client_id", "client_secret", "scopes"}
    kwargs = {k: v for k, v in data.items() if k in allowed}
    creds = Credentials(**kwargs)
    if expiry:
        try:
            creds.expiry = datetime.fromisoformat(expiry)
        except Exception:
            pass
    return creds


def drive_service(creds_dict: dict):
    """Build an authenticated Drive v3 client from a stored credentials dict."""
    from googleapiclient.discovery import build
    import warnings
    warnings.filterwarnings('ignore', message='file_cache is only supported')
    return build('drive', 'v3', credentials=_build_credentials(creds_dict), cache_discovery=False)


def _refresh_if_needed(creds: Credentials, creds_dict: dict) -> None:
    """Refresh an expired access token in place and mirror the new token back into
    ``creds_dict`` so the caller can persist it."""
    try:
        if creds.expired and creds.refresh_token:
            from google.auth.transport.requests import Request as GoogleRequest
            creds.refresh(GoogleRequest())
            creds_dict["token"] = creds.token
            if creds.expiry:
                creds_dict["expiry"] = creds.expiry.isoformat()
    except Exception:
        logger.warning("Drive token refresh failed", exc_info=True)


def _ensure_folder(service, name: str = DRIVE_FOLDER_NAME) -> str:
    """Return the id of the backups folder, creating it if it does not exist."""
    safe_name = name.replace("'", "\\'")
    query = (
        f"mimeType='{DRIVE_FOLDER_MIME}' and name='{safe_name}' and trashed=false"
    )
    resp = service.files().list(
        q=query, spaces='drive', fields='files(id,name)', pageSize=1
    ).execute()
    found = resp.get('files', [])
    if found:
        return found[0]['id']
    folder = service.files().create(
        body={"name": name, "mimeType": DRIVE_FOLDER_MIME}, fields='id'
    ).execute()
    return folder['id']


def upload_to_drive(creds_dict: dict, filename: str, data: bytes) -> str:
    """Upload ``data`` into the FinanceTrackerBackups Drive folder.

    Returns the created file id. Refreshes the access token if it has expired and
    mutates ``creds_dict`` in place with the refreshed token so the caller can
    re-persist it.
    """
    from googleapiclient.discovery import build
    from googleapiclient.http import MediaIoBaseUpload
    import warnings
    warnings.filterwarnings('ignore', message='file_cache is only supported')

    creds = _build_credentials(creds_dict)
    _refresh_if_needed(creds, creds_dict)

    service = build('drive', 'v3', credentials=creds, cache_discovery=False)
    folder_id = _ensure_folder(service, DRIVE_FOLDER_NAME)

    media = MediaIoBaseUpload(io.BytesIO(data), mimetype=GZIP_MIME, resumable=False)
    metadata = {"name": filename, "parents": [folder_id]}
    created = service.files().create(
        body=metadata, media_body=media, fields='id'
    ).execute()
    return created.get('id')
