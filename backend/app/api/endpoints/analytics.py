"""Analytics endpoints powering the Wallet-style Analytics page:
- /comparison    : two-period income/expense totals + per-category breakdown
- /cashflow      : income/expense/net bucketed over time
- /balance-trend : cumulative net (balance movement) over time

All money is converted to the user's BASE currency using per-currency rates, so
mixed-currency accounts aggregate correctly.
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import func, or_
coalesce = func.coalesce
from typing import Optional
from datetime import datetime, timedelta

from app.core.database import get_db
from app.models.models import User, Transaction, Bank, TransactionLabel, TransactionType
from app.api.endpoints.auth import get_current_active_user
from app.utils.parsing import parse_csv_list as _parse_csv_list
from app.services.currency_service import get_rate_map, get_base_currency

router = APIRouter()


def _dt(value: Optional[str], end_of_day: bool = False) -> Optional[datetime]:
    if not value:
        return None
    try:
        d = datetime.fromisoformat(value)
    except (ValueError, TypeError):
        raise HTTPException(status_code=400, detail=f"Invalid date '{value}'. Use ISO 8601.")
    if end_of_day and 'T' not in value and ' ' not in value:
        d = d.replace(hour=23, minute=59, second=59, microsecond=999999)
    return d


def _base_query(db: Session, user_id: int, *, bank_id=None, category=None, label_id=None,
                transaction_type=None, min_amount=None, max_amount=None, search=None,
                currency=None, include_transfers=True):
    """Filtered Transaction query mirroring the Records/Analytics sidebar filters."""
    q = db.query(Transaction).filter(Transaction.user_id == user_id)
    bank_ids = _parse_csv_list(bank_id, int)
    if bank_ids:
        q = q.filter(Transaction.bank_id.in_(bank_ids))
    cats = _parse_csv_list(category, str)
    if cats:
        q = q.filter(Transaction.category.in_(cats))
    label_ids = _parse_csv_list(label_id, int)
    if label_ids:
        q = q.filter(Transaction.id.in_(
            db.query(TransactionLabel.transaction_id).filter(TransactionLabel.label_id.in_(label_ids))
        ))
    types = _parse_csv_list(transaction_type, str)
    if types:
        q = q.filter(Transaction.transaction_type.in_(types))
    if min_amount is not None:
        q = q.filter(Transaction.amount >= min_amount)
    if max_amount is not None:
        q = q.filter(Transaction.amount <= max_amount)
    if search:
        q = q.filter(or_(
            Transaction.description.ilike(f"%{search}%"),
            Transaction.from_account.ilike(f"%{search}%"),
            Transaction.to_account.ilike(f"%{search}%"),
        ))
    codes = _parse_csv_list(currency, str)
    if codes:
        # avoid a Bank join here (the aggregation queries join Bank themselves)
        q = q.filter(or_(
            Transaction.currency_code.in_(codes),
            Transaction.bank_id.in_(db.query(Bank.id).filter(Bank.currency_code.in_(codes))),
        ))
    if not include_transfers:
        q = q.filter(func.lower(func.coalesce(Transaction.category, '')) != 'transfer')
    return q


def _effective_currency():
    return coalesce(Transaction.currency_code, Bank.currency_code, 'INR')


def _period_breakdown(db, user_id, start, end, rate_map, **filters):
    """Income/expense totals + per-category breakdown for one period (base currency)."""
    q = _base_query(db, user_id, **filters)
    q = q.join(Bank, Transaction.bank_id == Bank.id, isouter=True)
    if start:
        q = q.filter(Transaction.transaction_date >= start)
    if end:
        q = q.filter(Transaction.transaction_date <= end)

    rows = (
        q.with_entities(
            Transaction.category.label('category'),
            Transaction.transaction_type.label('ttype'),
            _effective_currency().label('code'),
            func.sum(Transaction.amount).label('amt'),
            func.count(Transaction.id).label('cnt'),
        )
        .group_by(Transaction.category, Transaction.transaction_type, _effective_currency())
        .all()
    )

    income_total = 0.0
    expense_total = 0.0
    income_cat = {}
    expense_cat = {}
    for cat, ttype, code, amt, cnt in rows:
        base = float(amt or 0) * rate_map.get(code or 'INR', 1.0)
        name = cat or 'Unknown'
        tval = ttype.value if hasattr(ttype, 'value') else str(ttype)
        if tval == 'credit':
            income_total += base
            income_cat[name] = income_cat.get(name, 0.0) + base
        else:
            expense_total += base
            expense_cat[name] = expense_cat.get(name, 0.0) + base

    def _to_list(d):
        return sorted(
            [{"category": k, "amount": round(v, 2)} for k, v in d.items()],
            key=lambda x: x["amount"], reverse=True,
        )

    return {
        "income_total": round(income_total, 2),
        "expense_total": round(expense_total, 2),
        "net": round(income_total - expense_total, 2),
        "income_by_category": _to_list(income_cat),
        "expense_by_category": _to_list(expense_cat),
    }


@router.get("/comparison")
def comparison(
    start_a: Optional[str] = None, end_a: Optional[str] = None,
    start_b: Optional[str] = None, end_b: Optional[str] = None,
    label_a: str = "Current", label_b: str = "Previous",
    bank_id: Optional[str] = None, category: Optional[str] = None, label_id: Optional[str] = None,
    transaction_type: Optional[str] = None, min_amount: Optional[float] = None,
    max_amount: Optional[float] = None, search: Optional[str] = None,
    currency: Optional[str] = None, include_transfers: bool = True,
    db: Session = Depends(get_db), current_user: User = Depends(get_current_active_user),
):
    """Two-period income/expense report (Incomes & Expenses tab)."""
    rate_map = get_rate_map(db, current_user.id)
    base = get_base_currency(db, current_user.id)
    filters = dict(bank_id=bank_id, category=category, label_id=label_id,
                   transaction_type=transaction_type, min_amount=min_amount,
                   max_amount=max_amount, search=search, currency=currency,
                   include_transfers=include_transfers)
    a = _period_breakdown(db, current_user.id, _dt(start_a), _dt(end_a, True), rate_map, **filters)
    b = _period_breakdown(db, current_user.id, _dt(start_b), _dt(end_b, True), rate_map, **filters)
    return {
        "base_currency": {"code": base.code if base else "INR", "symbol": base.symbol if base else "₹"},
        "period_a": {"label": label_a, **a},
        "period_b": {"label": label_b, **b},
    }


def _bucket_expr(granularity: str):
    g = (granularity or 'day').lower()
    if g == 'month':
        return func.to_char(func.date_trunc('month', Transaction.transaction_date), 'YYYY-MM-01')
    if g == 'week':
        return func.to_char(func.date_trunc('week', Transaction.transaction_date), 'YYYY-MM-DD')
    return func.to_char(Transaction.transaction_date, 'YYYY-MM-DD')


@router.get("/cashflow")
def cashflow(
    start_date: Optional[str] = None, end_date: Optional[str] = None,
    granularity: str = Query("day", pattern="^(day|week|month)$"),
    bank_id: Optional[str] = None, category: Optional[str] = None, label_id: Optional[str] = None,
    transaction_type: Optional[str] = None, min_amount: Optional[float] = None,
    max_amount: Optional[float] = None, search: Optional[str] = None,
    currency: Optional[str] = None, include_transfers: bool = True,
    db: Session = Depends(get_db), current_user: User = Depends(get_current_active_user),
):
    """Income / expense / net over time (Cash flow tab)."""
    rate_map = get_rate_map(db, current_user.id)
    q = _base_query(db, current_user.id, bank_id=bank_id, category=category, label_id=label_id,
                    transaction_type=transaction_type, min_amount=min_amount, max_amount=max_amount,
                    search=search, currency=currency, include_transfers=include_transfers)
    q = q.join(Bank, Transaction.bank_id == Bank.id, isouter=True)
    if start_date:
        q = q.filter(Transaction.transaction_date >= _dt(start_date))
    if end_date:
        q = q.filter(Transaction.transaction_date <= _dt(end_date, True))
    bucket = _bucket_expr(granularity)
    rows = (
        q.with_entities(
            bucket.label('bucket'),
            Transaction.transaction_type.label('ttype'),
            _effective_currency().label('code'),
            func.sum(Transaction.amount).label('amt'),
        )
        .group_by(bucket, Transaction.transaction_type, _effective_currency())
        .all()
    )
    buckets = {}
    for bkt, ttype, code, amt in rows:
        base = float(amt or 0) * rate_map.get(code or 'INR', 1.0)
        entry = buckets.setdefault(bkt, {"date": bkt, "income": 0.0, "expense": 0.0})
        tval = ttype.value if hasattr(ttype, 'value') else str(ttype)
        if tval == 'credit':
            entry["income"] += base
        else:
            entry["expense"] += base
    series = []
    for bkt in sorted(buckets.keys()):
        e = buckets[bkt]
        e["income"] = round(e["income"], 2)
        e["expense"] = round(e["expense"], 2)
        e["net"] = round(e["income"] - e["expense"], 2)
        series.append(e)
    totals = {
        "income": round(sum(e["income"] for e in series), 2),
        "expense": round(sum(e["expense"] for e in series), 2),
    }
    totals["net"] = round(totals["income"] - totals["expense"], 2)
    return {"granularity": granularity, "series": series, "totals": totals}


@router.get("/balance-trend")
def balance_trend(
    start_date: Optional[str] = None, end_date: Optional[str] = None,
    granularity: str = Query("day", pattern="^(day|week|month)$"),
    bank_id: Optional[str] = None, category: Optional[str] = None, label_id: Optional[str] = None,
    transaction_type: Optional[str] = None, min_amount: Optional[float] = None,
    max_amount: Optional[float] = None, search: Optional[str] = None,
    currency: Optional[str] = None, include_transfers: bool = True,
    db: Session = Depends(get_db), current_user: User = Depends(get_current_active_user),
):
    """Cumulative net (balance movement) over the period (Balance Trend tab)."""
    cf = cashflow(start_date, end_date, granularity, bank_id, category, label_id, transaction_type,
                  min_amount, max_amount, search, currency, include_transfers, db, current_user)
    running = 0.0
    series = []
    for e in cf["series"]:
        running += e["net"]
        series.append({"date": e["date"], "balance": round(running, 2)})
    return {"granularity": granularity, "series": series, "ending_balance": round(running, 2),
            "net_change": cf["totals"]["net"]}
