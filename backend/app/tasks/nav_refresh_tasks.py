"""Celery task: daily NAV/price auto-refresh for InvestmentAccount rows with
both external_ref and units_held set. See nav_refresh_service.py."""
import logging

from app.core.celery_app import celery_app

logger = logging.getLogger(__name__)


@celery_app.task(name="investments.refresh_nav")
def refresh_nav():
    from app.core.database import SessionLocal
    from app.models.models import InvestmentAccount
    from app.services import nav_refresh_service

    db = SessionLocal()
    refreshed = 0
    try:
        accounts = db.query(InvestmentAccount).filter(
            InvestmentAccount.is_active.is_(True),
            InvestmentAccount.external_ref.isnot(None),
            InvestmentAccount.units_held.isnot(None),
        ).all()
        for account in accounts:
            try:
                if nav_refresh_service.refresh_account(db, account):
                    db.commit()
                    refreshed += 1
            except Exception:
                logger.warning("NAV refresh failed for investment account %s", account.id, exc_info=True)
                db.rollback()
    finally:
        db.close()
    if refreshed:
        logger.info("NAV/price refresh: %d account(s) updated", refreshed)
    return {"refreshed": refreshed}
