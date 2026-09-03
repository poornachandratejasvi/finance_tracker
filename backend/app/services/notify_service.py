"""Unified outbound notification delivery via Apprise (github.com/caronc/apprise),
which supports Discord plus 100+ other services (Telegram, Slack, email, ntfy,
Pushover, Matrix, ...) through one small, testable send path.

Existing Discord-specific settings/UI keep working unchanged -- a configured
Discord webhook is simply folded in as one more Apprise target alongside
whatever extra service URLs the user adds. The tradeoff: Apprise's common
`.notify(title, body)` call is plain text across every service, so Discord's
colored rich-embed fields (amount/category/date grid) get flattened into
readable text lines instead -- the price of "works the same way for every
service" rather than "richest possible experience for one specific service".
"""
import logging
import re
from typing import List, Optional, Tuple

from sqlalchemy.orm import Session

from app.models.models import AppSetting
from app.core.crypto import encrypt_value, decrypt_value

logger = logging.getLogger(__name__)

_DISCORD_WEBHOOK_RE = re.compile(
    r"https?://(?:ptb\.|canary\.)?discord(?:app)?\.com/api/webhooks/(\d+)/([\w-]+)"
)


def _urls_key(uid: int) -> str:
    return f"notify_urls:{uid}"


def _discord_to_apprise(url: str) -> str:
    """Convert a raw Discord webhook URL into Apprise's discord:// scheme; passes
    through unchanged if it isn't a recognizable Discord webhook URL."""
    m = _DISCORD_WEBHOOK_RE.match(url.strip())
    if m:
        return f"discord://{m.group(1)}/{m.group(2)}"
    return url.strip()


def get_extra_urls(db: Session, uid: int) -> List[str]:
    """User-configured Apprise service URLs beyond the Discord webhook (Telegram,
    Slack, email, ntfy, Pushover, ...) -- one per line, encrypted at rest the same
    way the per-user Discord webhook already is."""
    row = db.query(AppSetting).filter(AppSetting.key == _urls_key(uid)).first()
    if not row or not row.value:
        return []
    try:
        raw = decrypt_value(row.value)
    except Exception:
        logger.warning("Corrupt/undecryptable notify_urls for user %s", uid, exc_info=True)
        return []
    return [line.strip() for line in raw.splitlines() if line.strip()]


def set_extra_urls(db: Session, uid: int, urls: List[str]) -> None:
    key = _urls_key(uid)
    row = db.query(AppSetting).filter(AppSetting.key == key).first()
    cleaned = [u.strip() for u in urls if u.strip()]
    if not cleaned:
        if row:
            db.delete(row)
            db.commit()
        return
    enc = encrypt_value("\n".join(cleaned))
    if row:
        row.value = enc
    else:
        db.add(AppSetting(key=key, value=enc))
    db.commit()


def _all_targets(db: Session, uid: int) -> List[str]:
    from app.services import discord_service, ntfy_service

    targets = []
    discord_url = discord_service.get_webhook(db, uid)
    if discord_url:
        targets.append(_discord_to_apprise(discord_url))
    ntfy_url = ntfy_service.to_apprise_url(uid, db=db)
    if ntfy_url:
        targets.append(ntfy_url)
    targets.extend(get_extra_urls(db, uid))
    return targets


def has_any_target(db: Session, uid: int) -> bool:
    return bool(_all_targets(db, uid))


def send(db: Session, uid: int, title: str, body: str) -> bool:
    """Best-effort fan-out to every configured target (Discord webhook + any extra
    Apprise URLs). Returns False only when nothing is configured -- like the old
    send_discord_message, this doesn't confirm actual delivery per-target, since
    Apprise's .notify() doesn't return a per-target result."""
    targets = _all_targets(db, uid)
    if not targets:
        return False
    try:
        import apprise

        a = apprise.Apprise()
        for t in targets:
            if not a.add(t):
                logger.warning("Apprise rejected notification target (masked): %s...", t[:20])
        a.notify(title=title[:256], body=body[:4000])
        return True
    except Exception:
        logger.warning("Apprise notify failed for user %s", uid, exc_info=True)
        return False


def send_test(db: Session, uid: int) -> Tuple[bool, str]:
    targets = _all_targets(db, uid)
    if not targets:
        return False, "No notification service configured."
    ok = send(
        db, uid, "Finance Tracker test",
        "✅ This is a test notification. Your notification setup is working.",
    )
    n = len(targets)
    if ok:
        return True, f"Test message sent to {n} configured service{'s' if n != 1 else ''}."
    return False, "Send failed — check Application Logs for details."
