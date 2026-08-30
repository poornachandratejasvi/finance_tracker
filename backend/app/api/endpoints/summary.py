"""Compact JSON summary for external homelab dashboards (e.g. gethomepage.dev's
customapi widget: https://gethomepage.dev/widgets/services/customapi/).
Authenticated the same way as /api/metrics -- an API token minted in
Settings -> API Tokens, sent as X-API-Key or Authorization: Bearer, since
that's what a dashboard widget's static-header config expects. Flat
top-level numeric fields (no nesting) so a widget's `field:` mapping can
point straight at any of them.
"""
from datetime import datetime

from fastapi import APIRouter, Depends
from sqlalchemy import case, func
from sqlalchemy.orm import Session

from app.core.api_auth import get_user_from_api_key
from app.core.database import get_db
from app.models.models import Bank, Transaction, TransactionType, User

router = APIRouter()


@router.get("")
def get_summary(db: Session = Depends(get_db), user: User = Depends(get_user_from_api_key)):
    # Same live-balance aggregate as the net-worth-trend endpoint's "current"
    # figure -- bank_type='investment' is excluded (those rows only exist to
    # auto-download CAS/PPF statement emails, not to hold a real balance).
    savings = float(db.query(func.coalesce(func.sum(Bank.current_balance), 0.0)).filter(
        Bank.user_id == user.id,
        Bank.bank_type.notin_(["credit", "investment"]),
        Bank.current_balance.isnot(None),
    ).scalar() or 0.0)
    credit = float(db.query(func.coalesce(func.sum(Bank.current_balance), 0.0)).filter(
        Bank.user_id == user.id, Bank.bank_type == "credit", Bank.current_balance.isnot(None),
    ).scalar() or 0.0)

    now = datetime.utcnow()
    month_start = datetime(now.year, now.month, 1)
    income, expense = db.query(
        func.coalesce(func.sum(case((Transaction.transaction_type == TransactionType.CREDIT, Transaction.amount), else_=0)), 0.0),
        func.coalesce(func.sum(case((Transaction.transaction_type == TransactionType.DEBIT, Transaction.amount), else_=0)), 0.0),
    ).filter(
        Transaction.user_id == user.id,
        Transaction.transaction_date >= month_start,
    ).one()

    pending = db.query(func.count(Transaction.id)).filter(
        Transaction.user_id == user.id, Transaction.is_confirmed.is_(False),
    ).scalar() or 0

    return {
        # total_balance/monthly_spend are the field names the homepage.dev
        # customapi widget's mappings actually reference -- keep these two
        # names stable, the rest are extras for future widgets.
        "total_balance": round(savings - credit, 2),
        "monthly_spend": round(float(expense), 2),
        "net_worth": round(savings - credit, 2),
        "savings_total": round(savings, 2),
        "credit_total": round(credit, 2),
        "month_income": round(float(income), 2),
        "month_expense": round(float(expense), 2),
        "month_net": round(float(income) - float(expense), 2),
        "pending_transactions": int(pending),
    }
