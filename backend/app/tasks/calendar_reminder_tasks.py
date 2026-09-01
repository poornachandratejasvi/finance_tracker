"""Celery task: daily due-date reminders for packages arriving soon and
subscriptions/bills due soon (see calendar_service.get_upcoming_items).
Idempotent per item via last_reminder_sent_for -- a reminder only fires once
per delivery/occurrence date, not every day it stays within the window.
"""
import logging

from app.core.celery_app import celery_app

logger = logging.getLogger(__name__)

_PACKAGE_LEAD_DAYS = 1
_SUBSCRIPTION_LEAD_DAYS = 3


@celery_app.task(name="calendar.check_upcoming")
def check_upcoming_calendar_items():
    """For every user, notify (via the per-user Discord/Apprise fan-out) about
    packages arriving within a day and subscriptions/bills due within 3 days."""
    from app.core.database import SessionLocal
    from app.core.time_utils import utcnow
    from app.models.models import User, Package, Subscription
    from app.services.calendar_service import get_upcoming_items
    from app.services.discord_service import send_discord_message

    db = SessionLocal()
    sent = 0
    try:
        now = utcnow()
        for user in db.query(User).all():
            try:
                items = get_upcoming_items(db, user.id, days_ahead=_SUBSCRIPTION_LEAD_DAYS)
            except Exception:
                logger.warning("Calendar reminder scan failed for user %s", user.id, exc_info=True)
                continue

            for item in items:
                days_out = (item["date"] - now).days
                if item["type"] == "package" and days_out <= _PACKAGE_LEAD_DAYS:
                    pkg = db.query(Package).filter(Package.id == item["id"]).first()
                    if not pkg or (pkg.last_reminder_sent_for and pkg.last_reminder_sent_for == item["date"]):
                        continue
                    try:
                        send_discord_message(
                            db, user.id, "📦 Package arriving soon",
                            f"**{item['title']}** ({item['subtitle']}) expected around "
                            f"{item['date'].strftime('%Y-%m-%d')}.",
                        )
                        pkg.last_reminder_sent_for = item["date"]
                        sent += 1
                    except Exception:
                        logger.warning("Failed to send package reminder for %s", item["id"], exc_info=True)
                elif item["type"] == "subscription" and days_out <= _SUBSCRIPTION_LEAD_DAYS:
                    sub = db.query(Subscription).filter(Subscription.id == item["id"]).first()
                    if not sub or (sub.last_reminder_sent_for and sub.last_reminder_sent_for == item["date"]):
                        continue
                    try:
                        amount_str = f" (₹{item['amount']:,.0f})" if item.get("amount") else ""
                        send_discord_message(
                            db, user.id, "📅 Upcoming bill/subscription",
                            f"**{item['title']}**{amount_str} due around {item['date'].strftime('%Y-%m-%d')}.",
                        )
                        sub.last_reminder_sent_for = item["date"]
                        sent += 1
                    except Exception:
                        logger.warning("Failed to send subscription reminder for %s", item["id"], exc_info=True)
            db.commit()
    finally:
        db.close()

    if sent:
        logger.info("Calendar reminders: %d sent", sent)
    return {"sent": sent}
