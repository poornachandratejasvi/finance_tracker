from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import func, extract, case, or_
from typing import List, Optional
from datetime import datetime, timedelta
import calendar
from app.core.database import get_db
from app.models.models import User, Transaction, Bank, TransactionType, BalanceSnapshot
from app.api.endpoints.auth import get_current_active_user
from app.utils.parsing import parse_csv_list as _parse_csv_list
import logging

logger = logging.getLogger(__name__)
router = APIRouter()


def _safe_dt(value):
    """Parse an ISO date/datetime string, returning None for empty input and raising a
    clean 400 (not a 500) for malformed input."""
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        return value
    try:
        return datetime.fromisoformat(value)
    except (ValueError, TypeError):
        raise HTTPException(
            status_code=400,
            detail=f"Invalid date '{value}'. Use ISO 8601 (YYYY-MM-DD or a full datetime).",
        )


def apply_filters(query, start_date, end_date, bank_id, category, transaction_type, min_amount, max_amount):
    """Helper to apply common filters"""
    if start_date:
        query = query.filter(Transaction.transaction_date >= _safe_dt(start_date))
    if end_date:
        query = query.filter(Transaction.transaction_date <= _safe_dt(end_date))
    bank_ids = _parse_csv_list(bank_id, int)
    if bank_ids:
        query = query.filter(Transaction.bank_id.in_(bank_ids))
    categories = _parse_csv_list(category, str)
    if categories:
        query = query.filter(Transaction.category.in_(categories))
    transaction_types = _parse_csv_list(transaction_type, str)
    if transaction_types:
        query = query.filter(Transaction.transaction_type.in_(transaction_types))
    if min_amount is not None:
        query = query.filter(Transaction.amount >= min_amount)
    if max_amount is not None:
        query = query.filter(Transaction.amount <= max_amount)
    return query


@router.get("/summary")
def get_dashboard_summary(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    bank_id: Optional[str] = None,
    category: Optional[str] = None,
    transaction_type: Optional[str] = None,
    min_amount: Optional[float] = None,
    max_amount: Optional[float] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    """Get dashboard summary with spend/gain stats"""
    
    query = db.query(Transaction).filter(Transaction.user_id == current_user.id)
    query = apply_filters(query, start_date, end_date, bank_id, category, transaction_type, min_amount, max_amount)
    
    # Calculate totals
    total_debit_query = db.query(func.sum(Transaction.amount)).filter(
        Transaction.user_id == current_user.id,
        Transaction.transaction_type == TransactionType.DEBIT
    )
    total_debit_query = apply_filters(total_debit_query, start_date, end_date, bank_id, category, None, min_amount, max_amount)
    total_debit = total_debit_query.scalar() or 0
    
    total_credit_query = db.query(func.sum(Transaction.amount)).filter(
        Transaction.user_id == current_user.id,
        Transaction.transaction_type == TransactionType.CREDIT
    )
    total_credit_query = apply_filters(total_credit_query, start_date, end_date, bank_id, category, None, min_amount, max_amount)
    total_credit = total_credit_query.scalar() or 0
    
    # Get transaction count
    transaction_count = query.count()
    
    # Get bank-wise summary
    bank_summary = db.query(
        Bank.name.label('bank_name'),
        func.count(Transaction.id).label('transaction_count'),
        func.sum(case(
            (Transaction.transaction_type == TransactionType.DEBIT, Transaction.amount),
            else_=0
        )).label('total_debit'),
        func.sum(case(
            (Transaction.transaction_type == TransactionType.CREDIT, Transaction.amount),
            else_=0
        )).label('total_credit')
    ).join(Bank).filter(Transaction.user_id == current_user.id)
    
    # Apply the SAME filters as the headline totals so the breakdowns stay consistent.
    bank_summary = apply_filters(bank_summary, start_date, end_date, bank_id, category, None, min_amount, max_amount)
    bank_summary = bank_summary.group_by(Bank.name).all()
    
    # Get category-wise summary
    category_summary = db.query(
        Transaction.category,
        func.count(Transaction.id).label('transaction_count'),
        func.sum(Transaction.amount).label('total_amount')
    ).filter(Transaction.user_id == current_user.id)
    
    category_summary = apply_filters(category_summary, start_date, end_date, bank_id, category, None, min_amount, max_amount)
    category_summary = category_summary.group_by(Transaction.category).all()

    # bank_type='investment' rows exist only so CAS/PPF statement emails can be
    # auto-downloaded (see the Add Bank form) -- they're explicitly NOT balance-
    # bearing accounts (that's what the separate InvestmentAccount feature is
    # for), so they're excluded here the same way credit cards get their own
    # bucket below, not lumped into savings_total/net worth.
    banks = db.query(Bank).filter(
        Bank.user_id == current_user.id,
        Bank.bank_type != "investment",
    ).all()

    # Per-bank period totals (filtered by same date range as main summary)
    period_bank_q = db.query(
        Transaction.bank_id,
        func.sum(case((Transaction.transaction_type == TransactionType.CREDIT, Transaction.amount), else_=0)).label('period_credit'),
        func.sum(case((Transaction.transaction_type == TransactionType.DEBIT, Transaction.amount), else_=0)).label('period_debit'),
    ).filter(Transaction.user_id == current_user.id)
    period_bank_q = apply_filters(period_bank_q, start_date, end_date, bank_id, category, None, min_amount, max_amount)
    period_bank_q = period_bank_q.group_by(Transaction.bank_id).all()
    period_by_bank = {
        row.bank_id: {
            "period_credit": float(row.period_credit or 0),
            "period_debit": float(row.period_debit or 0),
            "period_net": float((row.period_credit or 0) - (row.period_debit or 0)),
        }
        for row in period_bank_q
    }

    bank_balances = []
    savings_total = 0.0
    credit_total = 0.0
    period_savings_net = 0.0
    period_credit_net = 0.0
    for bank in banks:
        if bank.current_balance is None:
            bbal = 0.0
        else:
            bbal = bank.current_balance
        bp = period_by_bank.get(bank.id, {"period_credit": 0.0, "period_debit": 0.0, "period_net": 0.0})
        if bank.bank_type == 'credit':
            credit_total += bbal
            period_credit_net += bp["period_net"]
        else:
            savings_total += bbal
            period_savings_net += bp["period_net"]
        bank_balances.append({
            "bank_id": bank.id,
            "bank_name": bank.name,
            "bank_type": bank.bank_type,
            "current_balance": round(bbal, 2),
            "balance_updated_at": bank.balance_updated_at,
            "period_credit": round(bp["period_credit"], 2),
            "period_debit": round(bp["period_debit"], 2),
            "period_net": round(bp["period_net"], 2),
        })

    return {
        "total_debit": round(total_debit, 2),
        "total_credit": round(total_credit, 2),
        "net_balance": round(total_credit - total_debit, 2),
        "transaction_count": transaction_count,
        "balances": {
            "savings_total": round(savings_total, 2),
            "credit_total": round(credit_total, 2),
            "period_savings_net": round(period_savings_net, 2),
            "period_credit_net": round(period_credit_net, 2),
            "banks": bank_balances
        },
        "bank_summary": [
            {
                "bank_name": row.bank_name,
                "transaction_count": row.transaction_count,
                "total_debit": round(row.total_debit or 0, 2),
                "total_credit": round(row.total_credit or 0, 2)
            }
            for row in bank_summary
        ],
        "category_summary": [
            {
                "category": row.category or "Uncategorized",
                "transaction_count": row.transaction_count,
                "total_amount": round(row.total_amount, 2)
            }
            for row in category_summary
        ]
    }


@router.get("/latest-month")
def get_latest_month(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    """Return the latest month that has transaction data."""
    latest_date = db.query(func.max(Transaction.transaction_date)).filter(
        Transaction.user_id == current_user.id
    ).scalar()

    if not latest_date:
        return {"has_data": False}

    year = latest_date.year
    month = latest_date.month
    start_date = datetime(year, month, 1)
    end_day = calendar.monthrange(year, month)[1]
    end_date = datetime(year, month, end_day, 23, 59, 59)
    month_label = start_date.strftime("%b %Y")

    return {
        "has_data": True,
        "year": year,
        "month": month,
        "month_label": month_label,
        "start_date": start_date.isoformat(),
        "end_date": end_date.isoformat()
    }


@router.get("/monthly-summary")
def get_monthly_summary(
    year: Optional[int] = None,
    bank_id: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    """Get monthly spend/gain summary"""
    
    if not year:
        year = datetime.now().year
    
    # Get monthly summary
    monthly_data = db.query(
        extract('month', Transaction.transaction_date).label('month'),
        func.sum(case(
            (Transaction.transaction_type == TransactionType.DEBIT, Transaction.amount),
            else_=0
        )).label('total_debit'),
        func.sum(case(
            (Transaction.transaction_type == TransactionType.CREDIT, Transaction.amount),
            else_=0
        )).label('total_credit'),
        func.count(Transaction.id).label('transaction_count')
    ).filter(
        Transaction.user_id == current_user.id,
        extract('year', Transaction.transaction_date) == year
    )
    
    bank_ids = _parse_csv_list(bank_id, int)
    if bank_ids:
        monthly_data = monthly_data.filter(Transaction.bank_id.in_(bank_ids))
    
    monthly_data = monthly_data.group_by(extract('month', Transaction.transaction_date)).all()
    
    # Format response
    months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    result = []
    
    for i in range(1, 13):
        month_data = next((row for row in monthly_data if row.month == i), None)
        result.append({
            "month": months[i-1],
            "month_number": i,
            "total_debit": round(month_data.total_debit if month_data else 0, 2),
            "total_credit": round(month_data.total_credit if month_data else 0, 2),
            "transaction_count": month_data.transaction_count if month_data else 0
        })
    
    return {
        "year": year,
        "months": result
    }


@router.get("/monthly-bank-summary")
def get_monthly_bank_summary(
    year: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    """Get monthly spend/gain summary per bank for line chart"""
    
    if not year:
        year = datetime.now().year
    
    # Get all active banks for the user
    banks = db.query(Bank).filter(
        Bank.user_id == current_user.id
    ).all()

    months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

    # Single aggregate query grouped by (bank, month) instead of one query per bank/month.
    month_col = extract('month', Transaction.transaction_date).label('month')
    rows = db.query(
        Transaction.bank_id.label('bank_id'),
        month_col,
        func.sum(case(
            (Transaction.transaction_type == TransactionType.DEBIT, Transaction.amount),
            else_=0
        )).label('total_debit'),
        func.sum(case(
            (Transaction.transaction_type == TransactionType.CREDIT, Transaction.amount),
            else_=0
        )).label('total_credit'),
    ).filter(
        Transaction.user_id == current_user.id,
        extract('year', Transaction.transaction_date) == year,
    ).group_by(Transaction.bank_id, month_col).all()

    # Index results by (bank_id, month) for O(1) lookup while formatting.
    totals = {
        (int(r.bank_id), int(r.month)): (float(r.total_debit or 0), float(r.total_credit or 0))
        for r in rows
    }

    result = []
    for i in range(1, 13):
        month_data = {"month": months[i - 1], "month_number": i}
        for bank in banks:
            debit, credit = totals.get((bank.id, i), (0.0, 0.0))
            bank_key = f"bank_{bank.id}"
            month_data[f"{bank_key}_debit"] = round(debit, 2)
            month_data[f"{bank_key}_credit"] = round(credit, 2)
        result.append(month_data)

    return {
        "year": year,
        "months": result,
        "banks": [{"id": b.id, "name": b.name, "key": f"bank_{b.id}"} for b in banks]
    }


@router.get("/net-worth")
def get_net_worth(
    days: int = 180,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Return the user's net-worth history from daily balance snapshots, plus the current
    aggregate computed live (so there's always at least one point)."""
    days = max(1, min(days, 730))
    snaps = (
        db.query(BalanceSnapshot)
        .filter(BalanceSnapshot.user_id == current_user.id)
        .order_by(BalanceSnapshot.snapshot_date.desc())
        .limit(days)
        .all()
    )
    series = [
        {
            "date": s.snapshot_date,
            "savings_total": round(s.savings_total or 0, 2),
            "credit_total": round(s.credit_total or 0, 2),
            "net_worth": round(s.net_worth or 0, 2),
        }
        for s in reversed(snaps)
    ]
    # Live current aggregate. bank_type='investment' is excluded -- those rows exist
    # only to auto-download CAS/PPF statement emails, not to hold a real balance
    # (the InvestmentAccount feature tracks that separately).
    savings = float(db.query(func.coalesce(func.sum(Bank.current_balance), 0.0)).filter(
        Bank.user_id == current_user.id,
        Bank.bank_type.notin_(["credit", "investment"]),
        Bank.current_balance.isnot(None),
    ).scalar() or 0.0)
    credit = float(db.query(func.coalesce(func.sum(Bank.current_balance), 0.0)).filter(
        Bank.user_id == current_user.id, Bank.bank_type == "credit", Bank.current_balance.isnot(None)
    ).scalar() or 0.0)
    current = {"savings_total": round(savings, 2), "credit_total": round(credit, 2), "net_worth": round(savings - credit, 2)}
    return {"series": series, "current": current}


@router.get("/daily-bank-summary")
def get_daily_bank_summary(
    year: int,
    month: int,
    bank_id: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    """Get day-wise spend/gain summary per bank for a given month"""
    if month < 1 or month > 12:
        raise HTTPException(status_code=400, detail="Invalid month")
    if year < 1900 or year > 2200:
        # Guard calendar.monthrange against out-of-range years (would otherwise 500).
        raise HTTPException(status_code=400, detail="Invalid year")

    last_day = calendar.monthrange(year, month)[1]
    days = list(range(1, last_day + 1))

    bank_query = db.query(Bank).filter(
        Bank.user_id == current_user.id
    )
    bank_ids = _parse_csv_list(bank_id, int)
    if bank_ids:
        bank_query = bank_query.filter(Bank.id.in_(bank_ids))
    banks = bank_query.all()

    # Single aggregate query grouped by (bank, day) instead of one query per bank/day.
    day_col = extract('day', Transaction.transaction_date).label('day')
    day_filter = db.query(
        Transaction.bank_id.label('bank_id'),
        day_col,
        func.sum(case(
            (Transaction.transaction_type == TransactionType.DEBIT, Transaction.amount),
            else_=0
        )).label('total_debit'),
        func.sum(case(
            (Transaction.transaction_type == TransactionType.CREDIT, Transaction.amount),
            else_=0
        )).label('total_credit'),
    ).filter(
        Transaction.user_id == current_user.id,
        extract('year', Transaction.transaction_date) == year,
        extract('month', Transaction.transaction_date) == month,
    )
    if bank_ids:
        day_filter = day_filter.filter(Transaction.bank_id.in_(bank_ids))
    rows = day_filter.group_by(Transaction.bank_id, day_col).all()

    totals = {
        (int(r.bank_id), int(r.day)): (float(r.total_debit or 0), float(r.total_credit or 0))
        for r in rows
    }

    result = []
    for day in days:
        day_data = {"day": day}
        for bank in banks:
            debit, credit = totals.get((bank.id, day), (0.0, 0.0))
            bank_key = f"bank_{bank.id}"
            day_data[f"{bank_key}_debit"] = round(debit, 2)
            day_data[f"{bank_key}_credit"] = round(credit, 2)
        result.append(day_data)

    return {
        "year": year,
        "month": month,
        "days": result,
        "banks": [{"id": b.id, "name": b.name, "key": f"bank_{b.id}"} for b in banks]
    }


@router.post("/custom-report")
def generate_custom_report(
    filters: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    """Generate custom report with flexible filters"""
    
    query = db.query(Transaction).filter(Transaction.user_id == current_user.id)
    
    # Apply filters
    if filters.get('start_date'):
        query = query.filter(Transaction.transaction_date >= _safe_dt(filters['start_date']))
    if filters.get('end_date'):
        query = query.filter(Transaction.transaction_date <= _safe_dt(filters['end_date']))
    if filters.get('bank_id'):
        query = query.filter(Transaction.bank_id == filters['bank_id'])
    if filters.get('transaction_type'):
        query = query.filter(Transaction.transaction_type == filters['transaction_type'])
    if filters.get('category'):
        query = query.filter(Transaction.category == filters['category'])
    # Use `is not None` so a legitimate 0 bound is honoured (not treated as "unset").
    if filters.get('min_amount') is not None:
        query = query.filter(Transaction.amount >= filters['min_amount'])
    if filters.get('max_amount') is not None:
        query = query.filter(Transaction.amount <= filters['max_amount'])
    if filters.get('description_contains'):
        query = query.filter(Transaction.description.ilike(f"%{filters['description_contains']}%"))
    
    # Group by settings
    group_by = filters.get('group_by', 'category')
    
    if group_by == 'category':
        result = db.query(
            Transaction.category,
            func.sum(Transaction.amount).label('total_amount'),
            func.count(Transaction.id).label('count')
        ).filter(Transaction.user_id == current_user.id)
        
        # Apply same filters
        if filters.get('start_date'):
            result = result.filter(Transaction.transaction_date >= _safe_dt(filters['start_date']))
        if filters.get('end_date'):
            result = result.filter(Transaction.transaction_date <= _safe_dt(filters['end_date']))
        if filters.get('bank_id'):
            result = result.filter(Transaction.bank_id == filters['bank_id'])
        
        result = result.group_by(Transaction.category).all()
        
        return {
            "group_by": group_by,
            "data": [
                {
                    "category": row.category or "Uncategorized",
                    "total_amount": round(row.total_amount, 2),
                    "count": row.count
                }
                for row in result
            ]
        }
    
    elif group_by == 'bank':
        result = db.query(
            Bank.name.label('bank_name'),
            func.sum(Transaction.amount).label('total_amount'),
            func.count(Transaction.id).label('count')
        ).join(Bank).filter(Transaction.user_id == current_user.id)
        
        # Apply same filters
        if filters.get('start_date'):
            result = result.filter(Transaction.transaction_date >= _safe_dt(filters['start_date']))
        if filters.get('end_date'):
            result = result.filter(Transaction.transaction_date <= _safe_dt(filters['end_date']))

        result = result.group_by(Bank.name).all()
        
        return {
            "group_by": group_by,
            "data": [
                {
                    "bank_name": row.bank_name,
                    "total_amount": round(row.total_amount, 2),
                    "count": row.count
                }
                for row in result
            ]
        }
    
    # Default: return filtered transactions
    transactions = query.limit(100).all()
    return {
        "group_by": "transactions",
        "data": [
            {
                "id": t.id,
                "date": t.transaction_date.isoformat(),
                "description": t.description,
                "amount": t.amount,
                "type": t.transaction_type.value,
                "category": t.category
            }
            for t in transactions
        ]
    }
