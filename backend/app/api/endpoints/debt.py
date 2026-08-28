"""Debt payoff calculator (snowball/avalanche) -- pure computation over the
user's existing credit/loan Bank accounts. No new data source: reuses
Bank.current_balance plus the interest_rate/minimum_payment fields, so a
user just needs to fill those in on their credit cards/loans once."""
from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.api.endpoints.auth import get_current_active_user
from app.models.models import User, Bank

router = APIRouter()

_DEBT_TYPES = ("credit", "loan")
_DEFAULT_MIN_PAYMENT_PCT = 0.02  # used only when a card has no minimum_payment set


def _debts_for(db: Session, user_id: int):
    banks = (
        db.query(Bank)
        .filter(Bank.user_id == user_id, Bank.bank_type.in_(_DEBT_TYPES), Bank.is_archived.isnot(True))
        .all()
    )
    debts = []
    for b in banks:
        balance = abs(b.current_balance or 0.0)
        if balance <= 0:
            continue
        min_payment = b.minimum_payment or round(balance * _DEFAULT_MIN_PAYMENT_PCT, 2)
        debts.append({
            "bank_id": b.id,
            "name": b.name,
            "balance": round(balance, 2),
            "interest_rate": b.interest_rate,
            "minimum_payment": min_payment,
            "minimum_payment_is_estimated": b.minimum_payment is None,
        })
    return debts


@router.get("/summary")
def debt_summary(db: Session = Depends(get_db), current_user: User = Depends(get_current_active_user)):
    """Every tracked debt with its inputs, for a settings-style edit list --
    lets the user fill in interest_rate/minimum_payment before running a plan."""
    debts = _debts_for(db, current_user.id)
    return {
        "debts": debts,
        "total_balance": round(sum(d["balance"] for d in debts), 2),
        "missing_interest_rate": [d["name"] for d in debts if d["interest_rate"] is None],
    }


@router.get("/payoff-plan")
def payoff_plan(
    strategy: str = Query("avalanche", pattern="^(avalanche|snowball)$"),
    extra_payment: float = Query(0.0, ge=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Month-by-month schedule: every debt gets its minimum payment; the extra
    payment (and, once a debt is paid off, its freed-up minimum) all goes to
    the single highest-priority debt -- highest interest rate for avalanche
    (mathematically optimal total interest), smallest balance for snowball
    (psychological quick wins). Simulation caps at 30 years as a safety net
    against a pathological input (e.g. minimum payment too small to cover
    accruing interest) looping forever."""
    debts = _debts_for(db, current_user.id)
    if not debts:
        return {"strategy": strategy, "months": 0, "total_interest": 0.0, "order": [], "schedule": []}

    if strategy == "avalanche":
        order = sorted(debts, key=lambda d: (-(d["interest_rate"] or 0), -d["balance"]))
    else:
        order = sorted(debts, key=lambda d: (d["balance"], -(d["interest_rate"] or 0)))

    balances = {d["bank_id"]: d["balance"] for d in debts}
    min_payments = {d["bank_id"]: d["minimum_payment"] for d in debts}
    monthly_rates = {d["bank_id"]: (d["interest_rate"] or 0.0) / 100 / 12 for d in debts}
    order_ids = [d["bank_id"] for d in order]

    total_interest = 0.0
    months = 0
    payoff_month = {}
    MAX_MONTHS = 360

    while any(balances[bid] > 0.01 for bid in order_ids) and months < MAX_MONTHS:
        months += 1
        available_extra = extra_payment
        # Minimums first (plus interest accrual), oldest-priority debt absorbs any
        # freed-up minimum from an already-paid-off debt ahead of it in the order.
        for bid in order_ids:
            if balances[bid] <= 0:
                continue
            interest = balances[bid] * monthly_rates[bid]
            total_interest += interest
            balances[bid] += interest
            pay = min(min_payments[bid], balances[bid])
            balances[bid] -= pay
            if balances[bid] <= 0.01:
                balances[bid] = 0.0
                payoff_month.setdefault(bid, months)
                available_extra += min_payments[bid]  # freed minimum rolls into extra pool
        # All extra (explicit + freed minimums) goes to the first not-yet-paid debt in order.
        for bid in order_ids:
            if balances[bid] > 0 and available_extra > 0:
                pay = min(available_extra, balances[bid])
                balances[bid] -= pay
                available_extra -= pay
                if balances[bid] <= 0.01:
                    balances[bid] = 0.0
                    payoff_month.setdefault(bid, months)

    schedule = [
        {"bank_id": bid, "name": next(d["name"] for d in debts if d["bank_id"] == bid),
         "payoff_month": payoff_month.get(bid)}
        for bid in order_ids
    ]
    return {
        "strategy": strategy,
        "extra_payment": extra_payment,
        "months": months if months < MAX_MONTHS else None,
        "capped": months >= MAX_MONTHS,
        "total_interest": round(total_interest, 2),
        "order": [d["name"] for d in order],
        "schedule": schedule,
    }
