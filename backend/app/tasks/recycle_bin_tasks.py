"""Celery task: hard-delete transactions that have sat in the Recycle Bin past their 30-day grace period."""
import logging
from datetime import timedelta

from app.core.celery_app import celery_app
from app.core.time_utils import utcnow

logger = logging.getLogger(__name__)


@celery_app.task(name="recycle_bin.purge_expired")
def purge_expired():
    from app.core.database import SessionLocal
    from app.models.models import Transaction

    db = SessionLocal()
    try:
        cutoff = utcnow() - timedelta(days=30)
        expired = (
            db.query(Transaction)
            .execution_options(include_deleted=True)
            .filter(Transaction.deleted_at.isnot(None), Transaction.deleted_at < cutoff)
            .all()
        )
        for t in expired:
            db.delete(t)
        db.commit()
        if expired:
            logger.info("Recycle bin: purged %d transaction(s) past 30 days", len(expired))
        return {"purged": len(expired)}
    finally:
        db.close()
