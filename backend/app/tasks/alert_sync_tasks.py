"""Celery task: periodic real-time bank alert-email sync (see
alert_sync_service.py). Runs frequently — the whole point is near-real-time
spend visibility, well before the monthly statement PDF arrives.
"""
import logging
from datetime import timedelta

from app.core.celery_app import celery_app

logger = logging.getLogger(__name__)


@celery_app.task(name="alerts.sync_all")
def sync_all_alert_emails():
    """Check every active Gmail account for new spend/credit alert emails
    across all users, creating pending transactions."""
    from app.core.database import SessionLocal
    from app.core.time_utils import utcnow
    from app.models.models import GmailAccount, Bank
    from app.services.alert_sync_service import sync_alert_emails

    db = SessionLocal()
    total_created = 0
    try:
        accounts = db.query(GmailAccount).filter(GmailAccount.is_active.is_(True)).all()
        for account in accounts:
            banks = db.query(Bank).filter(Bank.user_id == account.user_id).all()
            if not banks:
                continue
            try:
                # Fixed lookback (not a real incremental cursor) — cheap because
                # already-seen messages are skipped via BankEmail.email_id, and
                # generous enough that a missed beat tick never loses an alert.
                created = sync_alert_emails(db, account, banks, after_date=utcnow() - timedelta(days=2))
                total_created += created
            except Exception:
                logger.warning("Alert-email sync failed for Gmail account %s", account.id, exc_info=True)
    finally:
        db.close()

    if total_created:
        logger.info("Alert-email sync: %d new pending transaction(s)", total_created)
    return {"created": total_created}
