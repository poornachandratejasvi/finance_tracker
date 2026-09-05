"""Celery task: daily safety-net sync for planned expenses/income.

The live transaction-creation hooks (transaction_hooks.py/transactions.py/
ingest.py/alert_sync_service.py) already auto-match a PlannedItemOccurrence
the moment a matching transaction is created, so this mostly catches
transactions that don't go through those hooks (e.g. a bulk CSV import) and
generates upcoming cycles ahead of time so GET /planned-items always has a
current occurrence to show, even for a user who hasn't opened the app in a
while.
"""
import logging

from app.core.celery_app import celery_app

logger = logging.getLogger(__name__)


@celery_app.task(name="planned_items.sync_all")
def sync_all_planned_items():
    """Ensure occurrences exist and re-run auto-match, for every user."""
    from app.core.database import SessionLocal
    from app.models.models import User
    from app.services.planned_item_service import sync_all

    db = SessionLocal()
    totals = {"occurrences_created": 0, "occurrences_matched": 0}
    try:
        for (user_id,) in db.query(User.id).all():
            try:
                report = sync_all(db, user_id)
                totals["occurrences_created"] += report["occurrences_created"]
                totals["occurrences_matched"] += report["occurrences_matched"]
            except Exception:
                logger.warning("Planned-item sync failed for user %s", user_id, exc_info=True)
                db.rollback()
    finally:
        db.close()

    if totals["occurrences_created"] or totals["occurrences_matched"]:
        logger.info("Planned items sync: %s", totals)
    return totals
