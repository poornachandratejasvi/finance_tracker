"""Discord webhook notifications for matched Automatic Rules.

A rule with ``notify_discord=True`` sends a message to the user's configured
Discord webhook whenever a NEW transaction matches its keywords (real-time
creation/ingestion only — bulk "apply to existing records" never notifies, to
avoid spamming a channel with hundreds of historical matches at once).

The webhook URL is stored per-user, encrypted at rest, the same way AI provider
API keys are (AppSetting + app.core.crypto).
"""
import logging
from typing import Optional, Tuple

from sqlalchemy.orm import Session

from app.models.models import AppSetting
from app.core.crypto import encrypt_value, decrypt_value

logger = logging.getLogger(__name__)


def _webhook_key(uid: int) -> str:
    return f"discord_webhook:{uid}"


def set_webhook(db: Session, uid: int, url: Optional[str]) -> None:
    key = _webhook_key(uid)
    row = db.query(AppSetting).filter(AppSetting.key == key).first()
    if not url:
        if row:
            db.delete(row)
            db.commit()
        return
    enc = encrypt_value(url.strip())
    if row:
        row.value = enc
    else:
        db.add(AppSetting(key=key, value=enc))
    db.commit()

    # Mirror into the legacy global key too, so sync-lifecycle notifications
    # (discord_notifier.py) immediately pick up the same webhook instead of
    # needing to be configured a second time on the Automation page. Safe
    # because this app is single-user in practice (no per-user global setting
    # collision) — if that ever changes, this global key should be retired.
    legacy_row = db.query(AppSetting).filter(AppSetting.key == _LEGACY_GLOBAL_KEY).first()
    if not legacy_row:
        legacy_row = AppSetting(key=_LEGACY_GLOBAL_KEY)
        db.add(legacy_row)
    legacy_row.value = url.strip()
    db.commit()


_LEGACY_GLOBAL_KEY = "discord_webhook_url"  # set via Settings -> External Accounts -> Discord
                                            # (also used directly by discord_notifier.py for
                                            # sync-lifecycle notifications)


def get_webhook(db: Session, uid: int) -> Optional[str]:
    row = db.query(AppSetting).filter(AppSetting.key == _webhook_key(uid)).first()
    if row and row.value:
        try:
            return decrypt_value(row.value)
        except Exception:
            pass
    # Fall back to the legacy global webhook so a webhook configured there also
    # powers AutoRule/NotificationRule/Gmail-health alerts without needing to be
    # set twice. Plaintext (unlike the per-user key) — that's how it's stored today.
    legacy = db.query(AppSetting).filter(AppSetting.key == _LEGACY_GLOBAL_KEY).first()
    if legacy and legacy.value:
        return legacy.value
    return None


def has_webhook(db: Session, uid: int) -> bool:
    return bool(get_webhook(db, uid))


def _format_amount(amount, ttype) -> str:
    sign = "+" if str(ttype).lower() in ("credit", "transactiontype.credit") else "-"
    try:
        return f"{sign}₹{float(amount):,.2f}"
    except (TypeError, ValueError):
        return f"{sign}{amount}"


def send_test_message(db: Session, uid: int) -> Tuple[bool, str]:
    """Delegates to notify_service (Apprise) so this test covers every configured
    target (Discord webhook + any extra Apprise service URLs), not just Discord."""
    from app.services import notify_service
    return notify_service.send_test(db, uid)


def send_discord_message(db: Session, uid: int, title: str, description: str) -> bool:
    """Best-effort, transaction-agnostic notification — used by notification rules
    (both 'match' and 'absence' triggers, the latter having no specific transaction
    to describe). Returns False if nothing is configured. Despite the name (kept
    for the many existing call sites), this now fans out via notify_service
    (Apprise) to the Discord webhook plus any other configured service."""
    from app.services import notify_service
    return notify_service.send(db, uid, title, description)


def send_rule_match_notification(db: Session, uid: int, transaction, rule) -> bool:
    """Best-effort: notify about a transaction that matched a rule with
    notify_discord=True. Never raises — failures are logged and swallowed so a
    notification-service outage can't break transaction creation/ingestion."""
    from app.services import notify_service

    try:
        amount_str = _format_amount(transaction.amount, transaction.transaction_type)
        desc = (transaction.description or "").strip()[:200]
        date_str = transaction.transaction_date.strftime("%Y-%m-%d %H:%M") if transaction.transaction_date else ""
        body = (
            f"Amount: {amount_str}\n"
            f"Category: {transaction.category or '—'}\n"
            f"Date: {date_str}\n"
            f"Description: {desc or '—'}"
        )
        return notify_service.send(db, uid, f"🔔 Rule matched: {rule.name}", body)
    except Exception as e:
        logger.info("Rule-match notification failed for rule %s: %s", getattr(rule, "id", "?"), str(e)[:150])
        return False
