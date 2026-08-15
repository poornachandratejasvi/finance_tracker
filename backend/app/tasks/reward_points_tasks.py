"""Celery task: daily reward-points expiry check (Discord notification at 30/7/1
days before an earned batch expires) -- see reward_points_service.check_expiring_reward_points."""
import logging

from app.core.celery_app import celery_app

logger = logging.getLogger(__name__)


@celery_app.task(name="reward_points.check_expiring")
def check_expiring_reward_points():
    """Periodic (all-users) entry point."""
    from app.core.database import SessionLocal
    from app.services.reward_points_service import check_expiring_reward_points

    db = SessionLocal()
    try:
        return check_expiring_reward_points(db)
    finally:
        db.close()
