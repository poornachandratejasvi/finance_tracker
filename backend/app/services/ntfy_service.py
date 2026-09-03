"""ntfy (https://ntfy.sh, or a self-hosted server) push notifications.

Delivered through the same Apprise fan-out as everything else (see
notify_service.py) -- this module just gives ntfy its own friendly config
(server URL + topic + optional auth) instead of requiring the user to
hand-write an Apprise URL, the same trade a dedicated Discord webhook field
makes over the generic "Other notification services" box.

Config is stored per-user as one encrypted JSON blob (server_url, topic,
token, username, password), the same at-rest encryption discord_service.py's
webhook URL uses.
"""
import json
import logging
from typing import Optional
from urllib.parse import quote, urlsplit

from sqlalchemy.orm import Session

from app.models.models import AppSetting
from app.core.crypto import encrypt_value, decrypt_value

logger = logging.getLogger(__name__)

_DEFAULT_SERVER = "ntfy.sh"


def _config_key(uid: int) -> str:
    return f"ntfy_config:{uid}"


def get_config(db: Session, uid: int) -> Optional[dict]:
    """Returns {server_url, topic, token, username, has_password} or None if
    unconfigured. The raw password is never returned to the client -- same
    convention as Paperless's api_token (write-only once set)."""
    row = db.query(AppSetting).filter(AppSetting.key == _config_key(uid)).first()
    if not row or not row.value:
        return None
    try:
        data = json.loads(decrypt_value(row.value))
    except Exception:
        logger.warning("Corrupt/undecryptable ntfy config for user %s", uid, exc_info=True)
        return None
    return {
        "server_url": data.get("server_url") or _DEFAULT_SERVER,
        "topic": data.get("topic") or "",
        "token": data.get("token") or "",
        "username": data.get("username") or "",
        "has_password": bool(data.get("password")),
    }


def _get_raw_config(db: Session, uid: int) -> Optional[dict]:
    row = db.query(AppSetting).filter(AppSetting.key == _config_key(uid)).first()
    if not row or not row.value:
        return None
    try:
        return json.loads(decrypt_value(row.value))
    except Exception:
        return None


def set_config(
    db: Session, uid: int,
    server_url: Optional[str], topic: Optional[str],
    token: Optional[str] = None, username: Optional[str] = None, password: Optional[str] = None,
) -> None:
    """Blank topic clears the whole config (nothing to notify without a topic).
    token/username/password of None leave any already-saved value untouched
    (so re-saving just the server URL doesn't wipe stored credentials) --
    pass an empty string explicitly to clear one of them."""
    key = _config_key(uid)
    row = db.query(AppSetting).filter(AppSetting.key == key).first()
    if not (topic or "").strip():
        if row:
            db.delete(row)
            db.commit()
        return

    existing = _get_raw_config(db, uid) or {}
    data = {
        "server_url": (server_url or "").strip() or _DEFAULT_SERVER,
        "topic": topic.strip(),
        "token": existing.get("token", "") if token is None else token.strip(),
        "username": existing.get("username", "") if username is None else username.strip(),
        "password": existing.get("password", "") if password is None else password,
    }
    enc = encrypt_value(json.dumps(data))
    if row:
        row.value = enc
    else:
        db.add(AppSetting(key=key, value=enc))
    db.commit()


def has_config(db: Session, uid: int) -> bool:
    cfg = get_config(db, uid)
    return bool(cfg and cfg.get("topic"))


def to_apprise_url(uid: int, db: Session = None, raw: Optional[dict] = None) -> Optional[str]:
    """Builds an Apprise ntfy:// (or ntfys://) URL from the stored config.

    Confirmed against the installed apprise version's NotifyNtfy templates:
      {schema}://{host}/{topic}
      {schema}://{user}:{password}@{host}/{topic}
      {schema}://{token}@{host}/{topic}
    where schema is 'ntfy' for a plain-http server, 'ntfys' for https
    (including the ntfy.sh default). A bare topic with no host at all
    (ntfys://topic) also works and is what's used for the ntfy.sh default.
    """
    data = raw if raw is not None else (_get_raw_config(db, uid) if db is not None else None)
    if not data or not data.get("topic"):
        return None

    topic = quote(data["topic"].strip(), safe="")
    server_url = (data.get("server_url") or _DEFAULT_SERVER).strip()

    if server_url.lower() in (_DEFAULT_SERVER, f"https://{_DEFAULT_SERVER}", f"http://{_DEFAULT_SERVER}"):
        return f"ntfys://{topic}"

    parsed = urlsplit(server_url if "//" in server_url else f"//{server_url}")
    scheme = "ntfy" if parsed.scheme == "http" else "ntfys"
    host = parsed.netloc or parsed.path
    if not host:
        return f"ntfys://{topic}"

    token = (data.get("token") or "").strip()
    username = (data.get("username") or "").strip()
    password = data.get("password") or ""
    if token:
        auth = f"{quote(token, safe='')}@"
    elif username:
        auth = f"{quote(username, safe='')}:{quote(password, safe='')}@" if password else f"{quote(username, safe='')}@"
    else:
        auth = ""

    return f"{scheme}://{auth}{host}/{topic}"


def send_test(db: Session, uid: int) -> tuple:
    """Sends a test notification to ntfy specifically (not the full Apprise
    fan-out) so a broken ntfy config doesn't get masked by Discord or another
    service happening to succeed."""
    url = to_apprise_url(uid, db=db)
    if not url:
        return False, "ntfy isn't configured yet -- set a topic first."
    try:
        import apprise

        a = apprise.Apprise()
        if not a.add(url):
            return False, "Apprise rejected this ntfy configuration -- check the server URL and topic."
        ok = a.notify(title="Finance Tracker test", body="✅ ntfy is working.")
        return (True, "Test notification sent.") if ok else (False, "Send failed -- check the server URL, topic, and auth.")
    except Exception as e:
        logger.warning("ntfy test notification failed for user %s", uid, exc_info=True)
        return False, f"Send failed: {str(e)[:150]}"
