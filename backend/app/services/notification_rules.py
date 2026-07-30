"""NotificationRule engine: two trigger types fanned out to any combination of
Discord / email / a Google Task.

- 'match'   — a NEW transaction (real-time, on create/ingest) matches the rule's
              keywords (+ optional record_type, + optional specific account).
- 'absence' — by a configurable day of the current month, NO transaction matching
              the rule has appeared yet this month (e.g. "alert me if the Nokia
              salary from ABC bank hasn't shown up by the 28th"). Checked once a
              day by the Celery beat dispatcher; fires at most once per month per
              rule (idempotency via last_triggered_month).

This is intentionally separate from AutoRule (which stays focused on
categorization + its simple existing Discord-only notify_discord toggle) — this
engine is for richer, multi-channel monitoring/alerting.
"""
import logging
from typing import List, Optional

from sqlalchemy.orm import Session

from app.core.time_utils import utcnow
from app.models.models import NotificationRule, Transaction, TransactionType, User
from app.services.autorules import parse_list
from app.services import discord_service, email_service, google_tasks_service
from app.services.backup_service import get_drive_creds

logger = logging.getLogger(__name__)


def get_active_rules(db: Session, user_id: int, trigger_type: Optional[str] = None) -> List[NotificationRule]:
    q = db.query(NotificationRule).filter(
        NotificationRule.user_id == user_id, NotificationRule.is_active.is_(True)
    )
    if trigger_type:
        q = q.filter(NotificationRule.trigger_type == trigger_type)
    return q.all()


def _record_type_matches(rule: NotificationRule, ttype_value: Optional[str]) -> bool:
    """Hard scope filter (not part of the AND/OR condition combination) — same
    semantics as autorules.match_rule: only debit/credit are actually filtered;
    'any'/'transfer' impose no constraint here."""
    rt = (rule.record_type or "any").lower()
    if rt in ("debit", "credit") and (ttype_value or "") != rt:
        return False
    return True


def _keyword_result(rule: NotificationRule, description: Optional[str]) -> Optional[bool]:
    """None means 'no keyword condition configured' (excluded from combination)."""
    kws = [k.strip().upper() for k in parse_list(rule.keywords) if k and k.strip()]
    if not kws:
        return None
    matched = any(kw in (description or "").upper() for kw in kws)
    return (not matched) if rule.keyword_negate else matched


def _amount_result(rule: NotificationRule, amount: Optional[float]) -> Optional[bool]:
    """None means 'no amount condition configured' (excluded from combination)."""
    op = (rule.amount_operator or "none").lower()
    if op == "none" or rule.amount_value is None:
        return None
    if amount is None:
        matched = False
    elif op == "eq":
        matched = abs(amount - rule.amount_value) < 0.005
    elif op == "gte":
        matched = amount >= rule.amount_value
    elif op == "lte":
        matched = amount <= rule.amount_value
    elif op == "between":
        hi = rule.amount_value_max if rule.amount_value_max is not None else rule.amount_value
        lo, hi = sorted((rule.amount_value, hi))
        matched = lo <= amount <= hi
    else:
        return None
    return (not matched) if rule.amount_negate else matched


def rule_condition_matches(rule: NotificationRule, description: Optional[str], amount: Optional[float]) -> bool:
    """Evaluate the keyword condition and the amount condition (each independently
    negatable via keyword_negate/amount_negate) and combine them via
    condition_logic ('and'/'or') when BOTH are configured; if only one is
    configured, that one alone decides. A rule with neither condition configured
    never matches — the create/update endpoint requires at least one."""
    results = [r for r in (_keyword_result(rule, description), _amount_result(rule, amount)) if r is not None]
    if not results:
        return False
    if len(results) == 1:
        return results[0]
    return any(results) if (rule.condition_logic or "and").lower() == "or" else all(results)


def _fire(db: Session, uid: int, rule: NotificationRule, subject: str, body: str) -> dict:
    """Fan out to whichever channels the rule has enabled. Never raises — each
    channel's failure is caught and reported individually so one broken channel
    (e.g. no SMTP configured) doesn't hide the others' results."""
    result = {}
    if rule.notify_discord:
        try:
            sent = discord_service.send_discord_message(db, uid, subject, body)
            result["discord"] = "sent" if sent else "no webhook configured"
        except Exception as e:
            result["discord"] = f"failed: {str(e)[:150]}"
    if rule.notify_email:
        try:
            to = rule.email_to
            if not to:
                user = db.query(User).filter(User.id == uid).first()
                to = user.email if user else None
            email_service.send_email(to, subject, body)
            result["email"] = f"sent to {to}"
        except Exception as e:
            result["email"] = f"failed: {str(e)[:150]}"
    if rule.notify_task:
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


def check_match(db: Session, uid: int, transaction) -> None:
    """Real-time hook: called right after a transaction is created/ingested. Fires
    every active 'match' rule whose keywords/record_type/account match it."""
    rules = get_active_rules(db, uid, trigger_type="match")
    if not rules:
        return
    ttype = transaction.transaction_type.value if hasattr(transaction.transaction_type, "value") else str(transaction.transaction_type)
    for rule in rules:
        if rule.bank_id and transaction.bank_id != rule.bank_id:
            continue
        if not _record_type_matches(rule, ttype):
            continue
        if not rule_condition_matches(rule, transaction.description, transaction.amount):
            continue
        subject = f"🔔 {rule.name}"
        body = (
            f"Matched: {transaction.description}\n"
            f"Amount: {transaction.amount}\n"
            f"Category: {transaction.category or '-'}\n"
            f"Date: {transaction.transaction_date}"
        )
        try:
            _fire(db, uid, rule, subject, body)
            rule.last_triggered_at = utcnow()
            db.commit()
        except Exception:
            logger.warning("Notification rule %s fire failed", rule.id, exc_info=True)
            db.rollback()


def run_absence_checks(db: Optional[Session] = None) -> int:
    """Run by Celery beat (daily): for every active 'absence' rule, once the
    configured day-of-month is reached, check whether a matching transaction has
    appeared THIS calendar month; if not, fire once (idempotent per month via
    last_triggered_month). Returns how many rules fired."""
    own_db = db is None
    if own_db:
        from app.core.database import SessionLocal
        db = SessionLocal()
    fired = 0
    try:
        now = utcnow()
        current_month = now.strftime("%Y-%m")
        rules = db.query(NotificationRule).filter(
            NotificationRule.is_active.is_(True),
            NotificationRule.trigger_type == "absence",
        ).all()
        for rule in rules:
            try:
                if now.day < (rule.check_day_of_month or 28):
                    continue
                if rule.last_triggered_month == current_month:
                    continue  # already checked this month
                found = _has_match_this_month(db, rule, now)
                if not found:
                    subject = f"⚠️ {rule.name} — not seen this month"
                    body = (
                        f"No transaction matching {_condition_description(rule)} has appeared in "
                        f"{current_month} yet (checked on day {now.day})."
                    )
                    _fire(db, rule.user_id, rule, subject, body)
                    rule.last_triggered_at = now
                    fired += 1
                rule.last_triggered_month = current_month
                db.commit()
            except Exception:
                logger.warning("Absence check failed for rule %s", rule.id, exc_info=True)
                db.rollback()
    finally:
        if own_db:
            db.close()
    return fired


def _has_match_this_month(db: Session, rule: NotificationRule, now) -> bool:
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    q = db.query(Transaction).filter(
        Transaction.user_id == rule.user_id,
        Transaction.transaction_date >= month_start,
    )
    if rule.bank_id:
        q = q.filter(Transaction.bank_id == rule.bank_id)
    rt = (rule.record_type or "any").lower()
    if rt in ("debit", "credit"):
        q = q.filter(Transaction.transaction_type == TransactionType(rt))
    if not parse_list(rule.keywords) and (rule.amount_operator or "none").lower() == "none":
        return True  # no condition configured — nothing meaningful to check
    for t in q.all():
        if rule_condition_matches(rule, t.description, t.amount):
            return True
    return False


def _condition_description(rule: NotificationRule) -> str:
    """Human-readable summary of the rule's condition(s), for notification bodies."""
    parts = []
    kws = parse_list(rule.keywords)
    if kws:
        parts.append(f"{'NOT ' if rule.keyword_negate else ''}keywords \"{', '.join(kws)}\"")
    op = (rule.amount_operator or "none").lower()
    if op != "none" and rule.amount_value is not None:
        neg = "NOT " if rule.amount_negate else ""
        if op == "eq":
            parts.append(f"{neg}amount = {rule.amount_value}")
        elif op == "gte":
            parts.append(f"{neg}amount ≥ {rule.amount_value}")
        elif op == "lte":
            parts.append(f"{neg}amount ≤ {rule.amount_value}")
        elif op == "between":
            parts.append(f"{neg}amount between {rule.amount_value} and {rule.amount_value_max}")
    if not parts:
        return "(no condition configured)"
    joiner = " OR " if (rule.condition_logic or "and").lower() == "or" else " AND "
    return joiner.join(parts)


def send_test_notification(db: Session, uid: int, rule: NotificationRule) -> dict:
    """Manual 'send test notification' button — fires every enabled channel with a
    canned message so the user can confirm each is actually wired up correctly.
    Does not touch last_triggered_at/month (doesn't count as a real firing)."""
    subject = f"🧪 Test: {rule.name}"
    body = (
        f"This is a test notification for rule \"{rule.name}\" "
        f"(trigger: {rule.trigger_type}, condition: {_condition_description(rule)})."
    )
    return _fire(db, uid, rule, subject, body)
