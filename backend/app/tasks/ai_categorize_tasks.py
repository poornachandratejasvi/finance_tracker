"""Celery task: daily AI-categorize sweep for every user who has an AI provider
configured -- the same thing the manual "AI Categorize" button does (see
ai_service.auto_categorize_user, shared by both), just without anyone needing
to click it. Skips users with no AI provider enabled entirely, and skips a
user gracefully if the provider call fails (e.g. a dead API key) rather than
letting one broken account stop the run for everyone else.
"""
import logging

from app.core.celery_app import celery_app

logger = logging.getLogger(__name__)


@celery_app.task(name="ai.auto_categorize_all")
def auto_categorize_all():
    from app.core.database import SessionLocal
    from app.models.models import User
    from app.services import ai_service

    db = SessionLocal()
    total_updated = 0
    total_rules = 0
    total_retro = 0
    users_run = 0
    try:
        user_ids = [row[0] for row in db.query(User.id).all()]
        for uid in user_ids:
            if not ai_service.is_configured(db, uid):
                continue
            try:
                result = ai_service.auto_categorize_user(db, uid, only_uncategorized=True, limit=200)
                db.commit()
                users_run += 1
                total_updated += result["updated"]
                total_rules += result["rules_created"]
                total_retro += result["retroactively_fixed"]
            except Exception:
                db.rollback()
                logger.warning("Auto-categorize failed for user %s", uid, exc_info=True)
    finally:
        db.close()

    if total_updated or total_rules:
        logger.info(
            "Auto-categorize: %d user(s), %d transaction(s) categorized, %d rule(s) learned, %d retroactively fixed",
            users_run, total_updated, total_rules, total_retro,
        )
    return {
        "users_run": users_run, "updated": total_updated,
        "rules_created": total_rules, "retroactively_fixed": total_retro,
    }
