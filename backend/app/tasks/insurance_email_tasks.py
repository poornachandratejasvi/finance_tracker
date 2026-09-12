"""Celery task: periodic insurance premium-receipt email sync (see
insurance_email_sync.py). Premium receipts are infrequent (monthly/yearly at
most), so this runs once a day rather than the bank-alert path's 15-minute
cadence.
"""
import logging
from datetime import timedelta

from app.core.celery_app import celery_app

logger = logging.getLogger(__name__)


@celery_app.task(name="insurance.sync_emails")
def sync_all_insurance_emails():
    """Check every active Gmail account for new premium-receipt emails across
    all users, updating each matching InsurancePolicy's premium tracking."""
    from app.core.database import SessionLocal
    from app.core.time_utils import utcnow
    from app.models.models import GmailAccount, InsurancePolicy
    from app.services.insurance_email_sync import sync_insurance_emails

    db = SessionLocal()
    total_updated = 0
    try:
        accounts = db.query(GmailAccount).filter(GmailAccount.is_active.is_(True)).all()
        for account in accounts:
            policies = (
                db.query(InsurancePolicy)
                .filter(InsurancePolicy.user_id == account.user_id, InsurancePolicy.is_active.is_(True))
                .all()
            )
            if not policies:
                continue
            try:
                # Generous lookback (not a real incremental cursor) -- cheap
                # because already-seen messages are skipped via
                # InsuranceEmail.email_id, matching alert_sync_tasks.py's
                # rationale for the same fixed-window approach.
                updated = sync_insurance_emails(db, account, policies, after_date=utcnow() - timedelta(days=7))
                total_updated += updated
            except Exception:
                logger.warning("Insurance-email sync failed for Gmail account %s", account.id, exc_info=True)
    finally:
        db.close()

    if total_updated:
        logger.info("Insurance-email sync: %d polic(y/ies) updated", total_updated)
    return {"updated": total_updated}
