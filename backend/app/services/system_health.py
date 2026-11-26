"""Watch the scheduler from the web process and notify when it goes quiet.

Celery worker and beat are what run Gmail sync. When they crash-loop (as they
did on 4 Nov 2026, after kombu 5.7 refused redis-py 5.0.1), no Celery task can
send the warning. This check therefore runs in the API process, which stayed up
through that outage, and uses the existing Discord/Apprise webhook.
"""

from __future__ import annotations

import json
import logging
import re
import threading
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Optional

logger = logging.getLogger(__name__)

# Two failed checks before the first Discord message, so a deploy restart does
# not page. Checks are five minutes apart after a three-minute startup delay.
INITIAL_DELAY_S = 180
CHECK_INTERVAL_S = 300
ALERT_AFTER_STREAK = 2
REMIND_AFTER = timedelta(hours=12)

_STATE_KEY = "system_health_monitor"
_LOCK_KEY = 741_852_964

# How long after the last successful run (or, if it has never run, after the
# schedule was created) we treat that schedule as missed. Daily is 26h so one
# slow night does not alert, and a skipped midnight run does.
_OVERDUE_AFTER = {
    "hourly": timedelta(hours=2),
    "every4h": timedelta(hours=6),
    "daily": timedelta(hours=26),
    "weekly": timedelta(days=8),
}

_BROKER_URL = re.compile(r"[a-z][a-z0-9+.-]*://\S+", re.IGNORECASE)

_TITLES = {
    "alert": "Finance tracker background jobs are down",
    "remind": "Finance tracker background jobs are still down",
    "recover": "Finance tracker background jobs recovered",
}

_stop = threading.Event()
_thread: Optional[threading.Thread] = None


@dataclass(frozen=True)
class HealthIssue:
    code: str
    summary: str


def redact_error(text: str) -> str:
    """Drop broker URLs. Connection errors include the Redis password."""
    if not text:
        return ""
    cleaned = _BROKER_URL.sub("<redacted>", str(text)).replace("\n", " ")
    return cleaned[:500]


def evaluate_system_health(now, worker_ok, worker_error, schedules) -> list:
    issues = []
    if not worker_ok:
        summary = (
            "Celery worker is not responding, so scheduled Gmail sync and the "
            "other background jobs are stopped."
        )
        detail = redact_error(worker_error)
        if detail:
            summary = f"{summary} {detail}"
        issues.append(HealthIssue(code="worker_down", summary=summary))

    if getattr(now, "tzinfo", None) is not None:
        now = now.replace(tzinfo=None)

    for sched in schedules or []:
        if not sched.get("enabled"):
            continue
        limit = _OVERDUE_AFTER.get(sched.get("frequency") or "daily", timedelta(hours=26))
        last_run = _naive(sched.get("last_run_at"))
        anchor = last_run or _naive(sched.get("created_at"))
        if anchor is not None and now - anchor <= limit:
            continue
        when = last_run.strftime("%Y-%m-%d %H:%M") if last_run else "never"
        user_id = sched.get("user_id")
        issues.append(HealthIssue(
            code=f"schedule_overdue:{user_id}",
            summary=(
                f"Statement sync is overdue ({sched.get('frequency') or 'daily'}, "
                f"last run {when}). The scheduler has missed its window."
            ),
        ))
    return issues


def decide_notification(issues, state, now):
    """Return (action, new_state). Action is 'alert', 'remind', 'recover', or None.

    The first unhealthy check only increments a streak. The second sends the
    alert. The same outage reminds once every 12 hours. A different set of
    problems sends a new alert. One healthy check sends recovery.
    """
    now = _naive(now) or datetime.utcnow()
    state = dict(state or {})
    fingerprint = "|".join(sorted(issue.code for issue in issues))
    prev_fp = state.get("fingerprint") or ""
    alerting = bool(state.get("alerting"))
    last_notified = _naive(state.get("last_notified_at"))

    if not issues:
        new_state = {
            "fingerprint": "",
            "failure_streak": 0,
            "alerting": False,
            "last_notified_at": None,
        }
        if alerting:
            return "recover", new_state
        return None, new_state

    streak = int(state.get("failure_streak") or 0) + 1
    new_state = {
        "fingerprint": fingerprint,
        "failure_streak": streak,
        "alerting": alerting,
        "last_notified_at": last_notified,
    }
    if streak < ALERT_AFTER_STREAK:
        return None, new_state
    if not alerting or fingerprint != prev_fp:
        new_state["alerting"] = True
        new_state["last_notified_at"] = now
        return "alert", new_state
    if last_notified is None or now - last_notified >= REMIND_AFTER:
        new_state["last_notified_at"] = now
        return "remind", new_state
    return None, new_state


def format_health_message(action, issues):
    title = _TITLES.get(action, "Finance tracker system health")
    if action == "recover":
        return title, (
            "The Celery worker is responding and scheduled syncs are within "
            "their window again."
        )
    lines = [redact_error(issue.summary) for issue in issues]
    lines.append(
        "This check runs in the web process, so it still fires when the worker "
        "and beat are crash-looping."
    )
    return title, "\n".join(lines)


def start_system_health_monitor() -> None:
    global _thread
    if _thread is not None and _thread.is_alive():
        return
    _stop.clear()
    _thread = threading.Thread(target=_loop, name="system-health", daemon=True)
    _thread.start()


def stop_system_health_monitor() -> None:
    _stop.set()


def run_system_health_check(now=None) -> None:
    """One pass: probe the worker, compare sync schedules, maybe notify."""
    from sqlalchemy import text

    from app.core.database import SessionLocal
    from app.models.models import AppSetting, SyncSchedule
    from app.services.discord_notifier import discord_notifier

    now = _naive(now) or datetime.utcnow()
    db = SessionLocal()
    locked = False
    try:
        locked = _try_lock(db)
        if not locked:
            return
        worker_ok, worker_error = probe_workers()
        schedules = [
            {
                "user_id": row.user_id,
                "enabled": bool(row.enabled),
                "frequency": row.frequency,
                "last_run_at": row.last_run_at,
                "created_at": row.created_at,
            }
            for row in db.query(SyncSchedule).all()
        ]
        issues = evaluate_system_health(now, worker_ok, worker_error, schedules)
        if issues:
            logger.warning(
                "System health: %s",
                "; ".join(redact_error(issue.summary) for issue in issues),
            )
        previous = _load_state(db)
        action, new_state = decide_notification(issues, previous, now)
        if action:
            title, body = format_health_message(action, issues)
            sent = bool(discord_notifier.send_notification(
                title,
                body,
                color=0x00ff00 if action == "recover" else 0xff0000,
            ))
            if sent:
                logger.info("System health notification sent: %s", action)
            else:
                logger.warning("System health %s was not delivered", action)
                new_state = _undo_undelivered(action, previous, new_state)
        _save_state(db, new_state)
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        if locked:
            try:
                db.execute(text("SELECT pg_advisory_unlock(:k)"), {"k": _LOCK_KEY})
                db.commit()
            except Exception:
                logger.warning("Failed to release system-health lock", exc_info=True)
        db.close()


def probe_workers():
    """Return (ok, error). A library mismatch raises here instead of killing the process."""
    try:
        from app.core.celery_app import celery_app
        ping = celery_app.control.inspect(timeout=5.0).ping()
    except Exception as exc:
        return False, redact_error(f"{type(exc).__name__}: {exc}")
    if not ping:
        return False, "No Celery worker responded to a ping."
    return True, None


def _loop() -> None:
    if _stop.wait(INITIAL_DELAY_S):
        return
    while not _stop.is_set():
        try:
            run_system_health_check()
        except Exception:
            logger.warning("System health check failed", exc_info=True)
        if _stop.wait(CHECK_INTERVAL_S):
            return


def _undo_undelivered(action, previous, new_state):
    """Keep the outage unacknowledged so the next pass tries the webhook again."""
    if action == "recover":
        restored = dict(previous or {})
        restored["alerting"] = True
        return restored
    restored = dict(new_state)
    restored["alerting"] = bool((previous or {}).get("alerting"))
    restored["last_notified_at"] = _naive((previous or {}).get("last_notified_at"))
    return restored


def _try_lock(db) -> bool:
    from sqlalchemy import text
    try:
        got = db.execute(text("SELECT pg_try_advisory_lock(:k)"), {"k": _LOCK_KEY}).scalar()
        return bool(got)
    except Exception:
        db.rollback()
        return True


def _load_state(db) -> dict:
    from app.models.models import AppSetting
    row = db.query(AppSetting).filter(AppSetting.key == _STATE_KEY).first()
    if not row or not row.value:
        return {}
    try:
        data = json.loads(row.value)
    except Exception:
        logger.warning("Ignoring unreadable system health state")
        return {}
    if not isinstance(data, dict):
        return {}
    return data


def _save_state(db, state) -> None:
    from app.models.models import AppSetting
    payload = dict(state)
    notified = payload.get("last_notified_at")
    if isinstance(notified, datetime):
        payload["last_notified_at"] = _naive(notified).isoformat(timespec="seconds")
    elif notified is not None:
        payload["last_notified_at"] = _naive(notified).isoformat(timespec="seconds")
    raw = json.dumps(payload)
    row = db.query(AppSetting).filter(AppSetting.key == _STATE_KEY).first()
    if row:
        row.value = raw
    else:
        db.add(AppSetting(key=_STATE_KEY, value=raw))


def _naive(value):
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        return value.replace(tzinfo=None) if value.tzinfo else value
    try:
        parsed = datetime.fromisoformat(str(value))
    except ValueError:
        return None
    return parsed.replace(tzinfo=None) if parsed.tzinfo else parsed
