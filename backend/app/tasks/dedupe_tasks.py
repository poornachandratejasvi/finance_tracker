"""Celery task: automatically merge and soft-delete duplicate transactions for
every user, daily -- see duplicate_resolution_service.py for the detection
(exact match + fuzzy cross-source) and merge logic. This is what makes
duplicate cleanup automatic rather than something the user has to trigger
from the "Solve Duplicities" button (which now just runs the same resolve
immediately instead of opening a manual review dialog).
"""
import logging

from app.core.celery_app import celery_app

logger = logging.getLogger(__name__)


@celery_app.task(name="transactions.auto_resolve_duplicates_all")
def auto_resolve_duplicates_all():
    from app.core.database import SessionLocal
    from app.models.models import User
    from app.services.duplicate_resolution_service import resolve_duplicates_for_user

    db = SessionLocal()
    total_groups = 0
    total_merged = 0
    try:
        user_ids = [row[0] for row in db.query(User.id).all()]
        for uid in user_ids:
            try:
                result = resolve_duplicates_for_user(db, uid)
                total_groups += result["groups_resolved"]
                total_merged += result["transactions_merged"]
            except Exception:
                db.rollback()
                logger.warning("Auto-dedupe failed for user %s", uid, exc_info=True)
    finally:
        db.close()

    if total_merged:
        logger.info("Auto-dedupe: merged %d transactions across %d groups", total_merged, total_groups)
    return {"groups_resolved": total_groups, "transactions_merged": total_merged}
