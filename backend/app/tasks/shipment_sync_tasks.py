"""Celery task: periodic shipment-tracking-email sync (see
shipment_sync_service.py). Less latency-sensitive than bank alerts -- a
package's lifecycle spans days, not seconds -- so a lighter cadence.
"""
import logging
from datetime import timedelta

from app.core.celery_app import celery_app

logger = logging.getLogger(__name__)


@celery_app.task(name="shipments.sync_all")
def sync_all_shipment_emails():
    """Check every active Gmail account for new shipment-tracking emails
    across all users, creating/updating Package rows."""
    from app.core.database import SessionLocal
    from app.core.time_utils import utcnow
    from app.models.models import GmailAccount
    from app.services.shipment_sync_service import sync_shipment_emails

    db = SessionLocal()
    total_touched = 0
    try:
        accounts = db.query(GmailAccount).filter(GmailAccount.is_active.is_(True)).all()
        for account in accounts:
            try:
                # Fixed lookback (not a real incremental cursor) — cheap because
                # already-seen messages are skipped via ShipmentEmail.email_id.
                total_touched += sync_shipment_emails(db, account, after_date=utcnow() - timedelta(days=3))
            except Exception:
                logger.warning("Shipment-email sync failed for Gmail account %s", account.id, exc_info=True)
    finally:
        db.close()

    if total_touched:
        logger.info("Shipment-email sync: %d package(s) created/updated", total_touched)
    return {"touched": total_touched}
