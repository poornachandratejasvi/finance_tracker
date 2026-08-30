"""Celery task: auto-confirm real-time-sourced (alert/SMS/ingest) pending
transactions that never got matched to a PDF statement within a generous grace
period.

is_confirmed=False only ever gets set for those three sources (see
transaction_hooks.py / alert_sync_service.py / ingest.py) -- everything else
(manual entry, PDF/statement rows, CSV import) is born confirmed. The intended
end state for a pending row is always to eventually become confirmed, either
by create_or_reconcile_transaction matching a real statement line, or by a
person clicking "Mark Confirmed" as -- per its own docstring -- "the manual
fallback for when automatic reconciliation never finds a match" (a date/amount
just outside tolerance, a statement that never got parsed, etc). Nothing ever
resolves the fallback case on its own, so a transaction can sit "Pending"
forever with no further action possible. The money movement itself was never
in question (the bank already alerted on it) -- only whether it got double-
checked against a statement line was -- so after this many days that check is
certain never coming, and auto-confirming is just automating what a person
would otherwise eventually have to click by hand.
"""
import logging
from datetime import timedelta

from app.core.celery_app import celery_app

logger = logging.getLogger(__name__)

STALE_PENDING_DAYS = 45


@celery_app.task(name="transactions.auto_confirm_stale_pending")
def auto_confirm_stale_pending():
    from app.core.database import SessionLocal
    from app.core.time_utils import utcnow
    from app.models.models import Transaction

    db = SessionLocal()
    try:
        cutoff = utcnow() - timedelta(days=STALE_PENDING_DAYS)
        stale = db.query(Transaction).filter(
            Transaction.is_confirmed.is_(False),
            Transaction.transaction_date < cutoff,
        ).all()
        confirmed = 0
        for t in stale:
            t.is_confirmed = True
            t.confirmed_at = utcnow()
            confirmed += 1
        if confirmed:
            db.commit()
            logger.info(
                "Auto-confirmed %d pending transaction(s) older than %d days with no matching statement",
                confirmed, STALE_PENDING_DAYS,
            )
        return {"confirmed": confirmed}
    finally:
        db.close()
