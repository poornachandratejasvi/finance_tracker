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

import httpx
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


def get_webhook(db: Session, uid: int) -> Optional[str]:
    row = db.query(AppSetting).filter(AppSetting.key == _webhook_key(uid)).first()
    if not row or not row.value:
        return None
    try:
        return decrypt_value(row.value)
    except Exception:
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
    url = get_webhook(db, uid)
    if not url:
        return False, "No Discord webhook configured."
    try:
        r = httpx.post(url, json={"content": "✅ Finance Tracker: this is a test notification. Your webhook is working."}, timeout=10)
        r.raise_for_status()
        return True, "Test message sent."
    except Exception as e:
        return False, str(e)[:200]


def send_rule_match_notification(db: Session, uid: int, transaction, rule) -> bool:
    """Best-effort: post a message about a transaction that matched a rule with
    notify_discord=True. Never raises — failures are logged and swallowed so a
    Discord outage can't break transaction creation/ingestion."""
    url = get_webhook(db, uid)
    if not url:
        return False
    try:
        amount_str = _format_amount(transaction.amount, transaction.transaction_type)
        desc = (transaction.description or "").strip()[:200]
        date_str = transaction.transaction_date.strftime("%Y-%m-%d %H:%M") if transaction.transaction_date else ""
        embed = {
            "title": f"🔔 Rule matched: {rule.name}",
            "color": 0x1AA565,
            "fields": [
                {"name": "Amount", "value": amount_str, "inline": True},
                {"name": "Category", "value": transaction.category or "—", "inline": True},
                {"name": "Date", "value": date_str, "inline": True},
                {"name": "Description", "value": desc or "—", "inline": False},
            ],
        }
        r = httpx.post(url, json={"embeds": [embed]}, timeout=10)
        r.raise_for_status()
        return True
    except Exception as e:
        logger.info("Discord notification failed for rule %s: %s", getattr(rule, "id", "?"), str(e)[:150])
        return False
