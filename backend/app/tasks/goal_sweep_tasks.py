"""Celery task: daily round-up sweep for every SavingsGoal that has
roundup_enabled=True -- the existing POST /goals/{goal_id}/sweep-roundups
endpoint, run automatically for every eligible goal instead of needing someone
to click it per goal. Pure bookkeeping (no real money moves, same as the
manual endpoint) and already idempotent by design: each swept transaction is
flagged roundup_swept, so re-running finds nothing left to sweep. Predictive
sweep (a computed "safe to save" surplus, not tied to an explicit per-goal
opt-in flag the way roundup_enabled is) is deliberately NOT automated here --
that one changes a goal's progress by an estimate rather than an exact
per-transaction calculation, closer to a suggestion than a settled fact, so it
stays a manual/reviewed action.
"""
import logging

from app.core.celery_app import celery_app

logger = logging.getLogger(__name__)


@celery_app.task(name="goals.auto_sweep_roundups")
def auto_sweep_roundups():
    from app.core.database import SessionLocal
    from app.core.time_utils import utcnow
    from app.models.models import SavingsGoal, SavingsGoalContribution
    from app.api.endpoints.goals import _unswept_debits, _roundup_amount

    db = SessionLocal()
    swept_total = 0.0
    goals_swept = 0
    try:
        goals = (
            db.query(SavingsGoal)
            .filter(SavingsGoal.is_active.is_(True), SavingsGoal.roundup_enabled.is_(True))
            .order_by(SavingsGoal.id)
            .all()
        )
        for g in goals:
            try:
                # Scoped per-user, not per-goal -- same as the manual endpoint, so a
                # user with two roundup-enabled goals has the first one (by id) claim
                # the pool of not-yet-swept debits, exactly like a person clicking
                # "sweep" on one goal before the other today.
                txns = _unswept_debits(db, g.user_id)
                if not txns:
                    continue
                total = 0.0
                for t in txns:
                    total += _roundup_amount(t.amount, g.roundup_to)
                    t.roundup_swept = True
                total = round(total, 2)
                if total <= 0:
                    continue
                g.current_amount = round((g.current_amount or 0.0) + total, 2)
                g.updated_at = utcnow()
                db.add(SavingsGoalContribution(goal_id=g.id, user_id=g.user_id, amount=total, source="roundup"))
                db.commit()
                swept_total += total
                goals_swept += 1
            except Exception:
                db.rollback()
                logger.warning("Round-up sweep failed for goal %s", g.id, exc_info=True)
    finally:
        db.close()

    if goals_swept:
        logger.info("Round-up sweep: %d goal(s), %.2f total swept", goals_swept, swept_total)
    return {"goals_swept": goals_swept, "total_swept": round(swept_total, 2)}
