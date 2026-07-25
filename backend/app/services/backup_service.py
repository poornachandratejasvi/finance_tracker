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
