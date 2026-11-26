"""Scheduler-health decisions. These must stay free of Celery, Redis, and Discord."""

from __future__ import annotations

import unittest
from datetime import datetime, timedelta
from pathlib import Path


class TestKombuPin(unittest.TestCase):
    def test_requirements_pin_kombu_below_redis6_requirement(self):
        text = Path(__file__).resolve().parents[1].joinpath("requirements.txt").read_text()
        pinned = [line.strip() for line in text.splitlines() if line.startswith("kombu==")]
        self.assertEqual(pinned, ["kombu==5.6.2"])


class TestEvaluateSystemHealth(unittest.TestCase):
    def test_worker_down_is_an_issue_and_includes_the_error(self):
        from app.services.system_health import evaluate_system_health

        issues = evaluate_system_health(
            now=datetime(2026, 11, 26, 12, 0),
            worker_ok=False,
            worker_error="VersionMismatch: Redis transport requires redis-py 6.1.0",
            schedules=[],
        )
        self.assertEqual([i.code for i in issues], ["worker_down"])
        self.assertIn("VersionMismatch", issues[0].summary)
        self.assertIn("Gmail sync", issues[0].summary)

    def test_daily_schedule_overdue_after_a_missed_run(self):
        from app.services.system_health import evaluate_system_health

        now = datetime(2026, 11, 5, 20, 0)
        issues = evaluate_system_health(
            now=now,
            worker_ok=True,
            worker_error=None,
            schedules=[{
                "user_id": 1,
                "enabled": True,
                "frequency": "daily",
                "last_run_at": datetime(2026, 11, 3, 18, 30),
                "created_at": datetime(2026, 10, 1),
            }],
        )
        self.assertEqual([i.code for i in issues], ["schedule_overdue:1"])
        self.assertIn("2026-11-03 18:30", issues[0].summary)

    def test_recent_daily_run_and_disabled_schedule_are_quiet(self):
        from app.services.system_health import evaluate_system_health

        now = datetime(2026, 11, 4, 12, 0)
        issues = evaluate_system_health(
            now=now,
            worker_ok=True,
            worker_error=None,
            schedules=[
                {
                    "user_id": 1,
                    "enabled": True,
                    "frequency": "daily",
                    "last_run_at": datetime(2026, 11, 3, 18, 30),
                    "created_at": datetime(2026, 10, 1),
                },
                {
                    "user_id": 2,
                    "enabled": False,
                    "frequency": "daily",
                    "last_run_at": datetime(2026, 10, 1),
                    "created_at": datetime(2026, 10, 1),
                },
            ],
        )
        self.assertEqual(issues, [])

    def test_enabled_schedule_that_has_never_run_is_overdue_once_the_window_passes(self):
        from app.services.system_health import evaluate_system_health

        now = datetime(2026, 11, 26, 12, 0)
        issues = evaluate_system_health(
            now=now,
            worker_ok=True,
            worker_error=None,
            schedules=[{
                "user_id": 1,
                "enabled": True,
                "frequency": "hourly",
                "last_run_at": None,
                "created_at": datetime(2026, 11, 26, 8, 0),
            }],
        )
        self.assertEqual([i.code for i in issues], ["schedule_overdue:1"])


class TestDecideNotification(unittest.TestCase):
    def _issue(self, code="worker_down"):
        from app.services.system_health import HealthIssue
        return HealthIssue(code=code, summary="down")

    def test_first_failure_does_not_notify(self):
        from app.services.system_health import decide_notification

        action, state = decide_notification([self._issue()], {}, datetime(2026, 11, 26, 12, 0))
        self.assertIsNone(action)
        self.assertEqual(state["failure_streak"], 1)
        self.assertFalse(state["alerting"])

    def test_second_consecutive_failure_notifies_once(self):
        from app.services.system_health import decide_notification

        now = datetime(2026, 11, 26, 12, 5)
        _, state = decide_notification([self._issue()], {}, datetime(2026, 11, 26, 12, 0))
        action, state = decide_notification([self._issue()], state, now)
        self.assertEqual(action, "alert")
        self.assertTrue(state["alerting"])
        self.assertEqual(state["last_notified_at"], now)

        action, state = decide_notification([self._issue()], state, now + timedelta(minutes=5))
        self.assertIsNone(action)

    def test_reminder_after_twelve_hours_and_recovery_when_healthy(self):
        from app.services.system_health import decide_notification

        start = datetime(2026, 11, 26, 12, 0)
        _, state = decide_notification([self._issue()], {}, start)
        _, state = decide_notification([self._issue()], state, start + timedelta(minutes=5))
        action, state = decide_notification(
            [self._issue()], state, start + timedelta(hours=12, minutes=5)
        )
        self.assertEqual(action, "remind")

        action, state = decide_notification([], state, start + timedelta(hours=13))
        self.assertEqual(action, "recover")
        self.assertFalse(state["alerting"])
        self.assertEqual(state["failure_streak"], 0)

    def test_a_new_problem_notifies_again(self):
        from app.services.system_health import decide_notification

        start = datetime(2026, 11, 26, 12, 0)
        _, state = decide_notification([self._issue()], {}, start)
        _, state = decide_notification([self._issue()], state, start + timedelta(minutes=5))
        action, _ = decide_notification(
            [self._issue("schedule_overdue:1")], state, start + timedelta(minutes=10)
        )
        self.assertEqual(action, "alert")


class TestMessages(unittest.TestCase):
    def test_alert_body_lists_each_issue_and_redacts_broker_urls(self):
        from app.services.system_health import HealthIssue, format_health_message, redact_error

        self.assertNotIn("s3cret", redact_error("Error redis://:s3cret@redis:6379/0 refused"))
        self.assertNotIn("redis://", redact_error("Error redis://:s3cret@redis:6379/0 refused"))

        title, body = format_health_message("alert", [
            HealthIssue(code="worker_down", summary="Celery worker is down. redis://:s3cret@redis:6379/0"),
        ])
        self.assertIn("down", title.lower())
        self.assertNotIn("s3cret", body)
        self.assertNotIn("redis://", body)


if __name__ == "__main__":
    unittest.main()
