"""Celery task: periodic live carrier-tracker refresh (see
courier_trackers.py). Runs every few hours -- shipment emails already give
same-day status for most updates, this just fills gaps between them.
"""
import logging
from datetime import timedelta

from app.core.celery_app import celery_app

logger = logging.getLogger(__name__)

_STALE_AFTER = timedelta(hours=6)


@celery_app.task(name="packages.refresh_active")
def refresh_active_packages():
    """Poll live carrier trackers for every non-delivered Package with a
    supported carrier and a known tracking number, whose last_checked_at is
    stale (or never checked). One carrier's failure never blocks another
    package -- see courier_trackers.track_package's degrade-to-None contract."""
    from app.core.database import SessionLocal
    from app.core.time_utils import utcnow
    from app.models.models import Package
    from app.services.courier_trackers import track_package, CARRIER_TRACKERS

    db = SessionLocal()
    refreshed = 0
    try:
        cutoff = utcnow() - _STALE_AFTER
        packages = (
            db.query(Package)
            .filter(
                Package.status != "delivered",
                Package.carrier.in_(list(CARRIER_TRACKERS.keys())),
                Package.tracking_number.isnot(None),
            )
            .all()
        )
        for pkg in packages:
            if pkg.last_checked_at and pkg.last_checked_at > cutoff:
                continue
            try:
                result = track_package(pkg.carrier, pkg.tracking_number)
                if result:
                    if result.get("status") and result["status"] != "unknown":
                        pkg.status = result["status"]
                    if result.get("expected_delivery_date"):
                        pkg.expected_delivery_date = result["expected_delivery_date"]
                    if result.get("actual_delivery_date"):
                        pkg.actual_delivery_date = result["actual_delivery_date"]
                    pkg.last_tracker_error = None
                    refreshed += 1
                else:
                    pkg.last_tracker_error = "Tracker returned no data on last check"
                pkg.last_checked_at = utcnow()
                db.commit()
            except Exception:
                logger.warning("Failed to refresh package %s", pkg.id, exc_info=True)
                db.rollback()
    finally:
        db.close()

    if refreshed:
        logger.info("Package tracker refresh: %d package(s) updated", refreshed)
    return {"refreshed": refreshed}
