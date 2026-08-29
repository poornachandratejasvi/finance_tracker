"""Prometheus text-exposition metrics for homelab dashboards (Grafana/Prometheus),
so net worth, liquidity, and burn rate can sit on the same board as server health.

A fresh CollectorRegistry is built per request rather than using the process-wide
default registry -- this endpoint is scraped per-user (via API token) and a shared
default registry would either duplicate-register gauges across requests or leak
one user's numbers into another's scrape.
"""
from datetime import timedelta

from prometheus_client import CollectorRegistry, Gauge, generate_latest
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.time_utils import utcnow
from app.models.models import Bank, Budget, SavingsGoal, Transaction, TransactionType
from app.services import budget_service, currency_service


def render_metrics(db: Session, user_id: int) -> bytes:
    registry = CollectorRegistry()

    net_worth = Gauge("finance_net_worth", "Total net worth in the base currency", registry=registry)
    account_balance = Gauge(
        "finance_account_balance", "Current balance per account", ["bank", "type"], registry=registry
    )
    monthly_spend = Gauge(
        "finance_monthly_spend_total", "Total debits in the trailing 30 days (base currency)", registry=registry
    )
    monthly_income = Gauge(
        "finance_monthly_income_total", "Total credits in the trailing 30 days (base currency)", registry=registry
    )
    budget_pct = Gauge(
        "finance_budget_utilization_pct", "Percent of monthly budget spent this month", ["category"], registry=registry
    )
    savings_progress = Gauge(
        "finance_savings_goal_progress_pct", "Percent of savings goal target reached", ["goal"], registry=registry
    )

    banks = db.query(Bank).filter(Bank.user_id == user_id, Bank.is_active == True).all()  # noqa: E712
    rate_map = currency_service.get_rate_map(db, user_id)
    total = 0.0
    for b in banks:
        bal = b.current_balance or 0.0
        signed = -bal if b.bank_type == "credit" else bal
        total += currency_service.to_base(signed, b.currency_code, rate_map)
        account_balance.labels(bank=b.name, type=b.bank_type or "other").set(round(bal, 2))
    net_worth.set(round(total, 2))

    cutoff = utcnow() - timedelta(days=30)
    spend = float(
        db.query(func.coalesce(func.sum(Transaction.amount), 0.0)).filter(
            Transaction.user_id == user_id,
            Transaction.transaction_type == TransactionType.DEBIT,
            Transaction.transaction_date >= cutoff,
        ).scalar() or 0.0
    )
    income = float(
        db.query(func.coalesce(func.sum(Transaction.amount), 0.0)).filter(
            Transaction.user_id == user_id,
            Transaction.transaction_type == TransactionType.CREDIT,
            Transaction.transaction_date >= cutoff,
        ).scalar() or 0.0
    )
    monthly_spend.set(round(spend, 2))
    monthly_income.set(round(income, 2))

    try:
        status = budget_service.compute_status(db, user_id)
        for b in status.get("budgets", []):
            budget_pct.labels(category=b["category"]).set(b["pct"])
    except Exception:
        pass

    for g in db.query(SavingsGoal).filter(SavingsGoal.user_id == user_id, SavingsGoal.is_active == True).all():  # noqa: E712
        pct = round((g.current_amount or 0) / g.target_amount * 100, 1) if g.target_amount else 0.0
        savings_progress.labels(goal=g.name).set(pct)

    return generate_latest(registry)
