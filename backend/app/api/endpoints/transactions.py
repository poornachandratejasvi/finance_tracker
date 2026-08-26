from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session
from sqlalchemy import and_, or_, desc
from typing import List, Optional
from datetime import datetime

from app.core.database import get_db
from app.core.time_utils import utcnow
from app.api.endpoints.auth import get_current_active_user, require_write_access
from app.models.models import User, Transaction, Bank, TransactionLabel, Label
from app.schemas.transaction import (
    TransactionCreate,
    TransactionUpdate,
    TransactionResponse,
    TransactionFilter,
    DuplicateGroup,
    BulkDeleteRequest,
)
from app.services.transaction_service import TransactionService
from app.utils.parsing import parse_csv_list as _parse_csv_list
from app.core.household import visible_user_ids

router = APIRouter()


def _parse_filter_date(value: Optional[str], end_of_day: bool = False) -> Optional[datetime]:
    """Parse a date filter that may be a bare date ('YYYY-MM-DD', as sent by the UI's
    <input type="date">) or a full ISO datetime. A bare end-date is extended to the end
    of that day so same-day transactions are included. Bad input yields a 400, not a 500."""
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(value)
    except (ValueError, TypeError):
        raise HTTPException(
            status_code=400,
            detail=f"Invalid date '{value}'. Use YYYY-MM-DD or an ISO datetime.",
        )
    if end_of_day and 'T' not in value and ' ' not in value:
        dt = dt.replace(hour=23, minute=59, second=59, microsecond=999999)
    return dt


@router.get("/")
def list_transactions(
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=10000),
    bank_id: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    transaction_type: Optional[str] = None,
    category: Optional[str] = None,
    label_id: Optional[str] = None,
    min_amount: Optional[float] = None,
    max_amount: Optional[float] = None,
    search: Optional[str] = None,
    is_confirmed: Optional[bool] = None,
    source: Optional[str] = None,
    updated_since: Optional[str] = None,
    sort_by: str = Query("date", pattern="^(date|amount|description|category)$"),
    sort_dir: str = Query("desc", pattern="^(asc|desc)$"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    """List transactions visible to the caller — their own, or their whole
    household's if they're an admin (see app.core.household.visible_user_ids)."""
    from sqlalchemy import asc as _asc
    household_ids = visible_user_ids(db, current_user)
    query = db.query(Transaction).filter(Transaction.user_id.in_(household_ids))

    bank_ids = _parse_csv_list(bank_id, int)
    if bank_ids:
        query = query.filter(Transaction.bank_id.in_(bank_ids))

    start_dt = _parse_filter_date(start_date, end_of_day=False)
    end_dt = _parse_filter_date(end_date, end_of_day=True)
    if start_dt:
        query = query.filter(Transaction.transaction_date >= start_dt)
    if end_dt:
        query = query.filter(Transaction.transaction_date <= end_dt)

    transaction_types = _parse_csv_list(transaction_type, str)
    if transaction_types:
        query = query.filter(Transaction.transaction_type.in_(transaction_types))

    categories = _parse_csv_list(category, str)
    if categories:
        query = query.filter(Transaction.category.in_(categories))

    label_ids = _parse_csv_list(label_id, int)
    if label_ids:
        query = query.filter(
            Transaction.id.in_(
                db.query(TransactionLabel.transaction_id).filter(TransactionLabel.label_id.in_(label_ids))
            )
        )

    if min_amount is not None:
        query = query.filter(Transaction.amount >= min_amount)
    if max_amount is not None:
        query = query.filter(Transaction.amount <= max_amount)

    if is_confirmed is not None:
        query = query.filter(Transaction.is_confirmed.is_(is_confirmed))

    sources = _parse_csv_list(source, str)
    if sources:
        query = query.filter(Transaction.source.in_(sources))

    if updated_since:
        updated_dt = _parse_filter_date(updated_since, end_of_day=False)
        if updated_dt:
            query = query.filter(Transaction.updated_at >= updated_dt)

    if search:
        query = query.filter(
            or_(
                Transaction.description.ilike(f"%{search}%"),
                Transaction.from_account.ilike(f"%{search}%"),
                Transaction.to_account.ilike(f"%{search}%")
            )
        )

    total = query.count()

    sort_col = {
        "date": Transaction.transaction_date,
        "amount": Transaction.amount,
        "description": Transaction.description,
        "category": Transaction.category,
    }[sort_by]
    order = _asc(sort_col) if sort_dir == "asc" else desc(sort_col)
    transactions = query.order_by(order, desc(Transaction.id)).offset(skip).limit(limit).all()

    # Currency for accounts, so a transaction with no explicit currency inherits its account's.
    from app.services.currency_service import bank_currency_map
    bank_cur = bank_currency_map(db, household_ids)

    # Add bank name, currency and labels (with colors) to response
    result = []
    for trans in transactions:
        trans_dict = TransactionResponse.from_orm(trans).dict()
        trans_dict['bank_name'] = trans.bank.name if trans.bank else None
        trans_dict['bank_type'] = trans.bank.bank_type if trans.bank else None
        trans_dict['currency_code'] = trans.currency_code or bank_cur.get(trans.bank_id, 'INR')
        trans_dict['pdf_file'] = trans.pdf_statement.file_name if trans.pdf_statement else None
        trans_dict['labels'] = [tl.label.name for tl in trans.transaction_labels]
        trans_dict['label_details'] = [
            {"id": tl.label.id, "name": tl.label.name, "color": tl.label.color}
            for tl in trans.transaction_labels if tl.label
        ]
        result.append(trans_dict)

    return {"items": result, "total": total, "skip": skip, "limit": limit}


@router.get("/fields")
def get_available_fields(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    """Get all available transaction fields including custom ones"""
    
    # Standard fields
    standard_fields = [
        {"name": "transaction_date", "type": "datetime", "label": "Transaction Date"},
        {"name": "description", "type": "text", "label": "Description"},
        {"name": "amount", "type": "number", "label": "Amount"},
        {"name": "transaction_type", "type": "enum", "label": "Type", "options": ["debit", "credit"]},
        {"name": "balance", "type": "number", "label": "Balance"},
        {"name": "reference_number", "type": "text", "label": "Reference Number"},
        {"name": "category", "type": "text", "label": "Category"},
        {"name": "from_account", "type": "text", "label": "From Account"},
        {"name": "to_account", "type": "text", "label": "To Account"},
        {"name": "notes", "type": "text", "label": "Notes"}
    ]
    
    # Get unique custom fields from all transactions
    import json
    transactions_with_custom = db.query(Transaction).filter(
        Transaction.user_id == current_user.id,
        Transaction.custom_fields.isnot(None)
    ).all()
    
    custom_field_names = set()
    for t in transactions_with_custom:
        if t.custom_fields:
            try:
                fields = json.loads(t.custom_fields)
                custom_field_names.update(fields.keys())
            except Exception:
                pass
    
    custom_fields = [
        {"name": f"custom_{field}", "type": "text", "label": field, "is_custom": True}
        for field in sorted(custom_field_names)
    ]
    
    return {
        "standard_fields": standard_fields,
        "custom_fields": custom_fields,
        "all_fields": standard_fields + custom_fields
    }


@router.get("/duplicates", response_model=List[DuplicateGroup])
def get_duplicates(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    """Get duplicate transaction groups"""
    duplicates = db.query(Transaction).filter(
        and_(
            Transaction.user_id == current_user.id,
            Transaction.is_duplicate == True
        )
    ).all()
    
    # Group by duplicate_group_id
    groups = {}
    for trans in duplicates:
        if trans.duplicate_group_id not in groups:
            groups[trans.duplicate_group_id] = []
        groups[trans.duplicate_group_id].append(trans)
    
    # Format response
    result = []
    for group_id, transactions in groups.items():
        trans_responses = [TransactionResponse.from_orm(t) for t in transactions]
        total_amount = sum(t.amount for t in transactions)
        
        result.append(DuplicateGroup(
            duplicate_group_id=group_id,
            transactions=trans_responses,
            total_amount=total_amount,
            count=len(transactions)
        ))
    
    return result


@router.post("/", response_model=TransactionResponse, status_code=status.HTTP_201_CREATED)
def create_transaction(
    trans_data: TransactionCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_write_access)
):
    """Create a new transaction manually. Scoped to the caller's own banks, or
    any household member's if the caller is an admin -- attributed to that
    bank's actual owner, not necessarily the caller, so an admin adding a
    transaction on a member's behalf doesn't have it land in the admin's own
    data (same reasoning as banks.py's upload_bank_pdf)."""
    bank = db.query(Bank).filter(
        Bank.id == trans_data.bank_id,
        Bank.user_id.in_(visible_user_ids(db, current_user)),
    ).first()
    if not bank:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Bank not found",
        )
    owner_id = bank.user_id

    # Idempotent replay: the mobile app's offline write queue may retry a
    # submission whose response was lost (e.g. connectivity dropped after the
    # server committed but before the reply arrived). Returning the existing
    # row instead of erroring/duplicating makes that retry safe.
    if trans_data.client_uuid:
        existing = db.query(Transaction).filter(
            Transaction.client_uuid == trans_data.client_uuid,
            Transaction.user_id.in_(visible_user_ids(db, current_user)),
        ).first()
        if existing:
            trans_dict = TransactionResponse.from_orm(existing).dict()
            trans_dict['bank_name'] = existing.bank.name if existing.bank else None
            trans_dict['labels'] = [tl.label.name for tl in existing.transaction_labels]
            return trans_dict

    # Auto-categorize if not provided: user keyword rules first, then the built-in heuristic.
    if not trans_data.category:
        from app.services.categorization import get_active_rules, match_category
        trans_data.category = (
            match_category(trans_data.description, get_active_rules(db, owner_id))
            or TransactionService.categorize_transaction(trans_data.description)
        )

    transaction = Transaction(
        user_id=owner_id,
        is_manual=True,  # Mark as manually created
        source="manual",
        **trans_data.dict()
    )

    db.add(transaction)

    try:
        from app.services.balance_service import adjust_credit_balance_for_new_transaction
        adjust_credit_balance_for_new_transaction(bank, transaction)
    except Exception:
        pass

    db.commit()
    db.refresh(transaction)

    # Apply auto-labels (keyword→label) and Wallet-style AutoRules (category + labels).
    TransactionService.apply_auto_labels(db, transaction.id, transaction.description)
    try:
        from app.services.autorules import get_active_rules, match_rule, apply_rule
        ttype = transaction.transaction_type.value if hasattr(transaction.transaction_type, "value") else str(transaction.transaction_type)
        rule = match_rule(transaction.description, ttype, get_active_rules(db, owner_id))
        if rule:
            if apply_rule(db, transaction, rule):
                db.commit()
                db.refresh(transaction)
            # Fire on any MATCH, not just when category/labels changed — a
            # notification-only rule (no category/labels set) never "changes"
            # anything, but the user still wants to be told it matched.
            if rule.notify_discord:
                from app.services import discord_service
                discord_service.send_rule_match_notification(db, owner_id, transaction, rule)
    except Exception:
        db.rollback()

    try:
        from app.services.notification_rules import check_match
        check_match(db, owner_id, transaction)
    except Exception:
        db.rollback()

    try:
        from app.services.transaction_hooks import check_transaction_watchers
        check_transaction_watchers(db, owner_id, transaction)
        db.commit()
    except Exception:
        db.rollback()

    # Build response with bank name and labels
    trans_dict = TransactionResponse.from_orm(transaction).dict()
    trans_dict['bank_name'] = transaction.bank.name if transaction.bank else None
    trans_dict['labels'] = [tl.label.name for tl in transaction.transaction_labels]
    
    return trans_dict


# ── These must come BEFORE /{transaction_id} to avoid the path param swallowing them ──

@router.get("/recurring")
def get_recurring_transactions(
    min_occurrences: int = Query(2, ge=2, le=24),
    months_back: int = Query(6, ge=1, le=24),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    """Detect recurring/subscription-like transactions."""
    from datetime import timedelta
    from sqlalchemy import func

    since = utcnow() - timedelta(days=30 * months_back)

    from sqlalchemy import cast
    from sqlalchemy import Numeric as SANumeric

    amount_bucket = func.round(cast(Transaction.amount, SANumeric(18, 2)), -1)

    rows = (
        db.query(
            func.lower(Transaction.description).label("key"),
            amount_bucket.label("amount_bucket"),
            Transaction.transaction_type,
            func.count(Transaction.id).label("cnt"),
            func.min(Transaction.transaction_date).label("first_seen"),
            func.max(Transaction.transaction_date).label("last_seen"),
            func.avg(Transaction.amount).label("avg_amount"),
            Transaction.bank_id,
        )
        .filter(
            Transaction.user_id == current_user.id,
            Transaction.transaction_date >= since,
            Transaction.is_duplicate == False,        # noqa: E712
        )
        .group_by(
            func.lower(Transaction.description),
            amount_bucket,
            Transaction.transaction_type,
            Transaction.bank_id,
        )
        .having(func.count(Transaction.id) >= min_occurrences)
        .order_by(func.count(Transaction.id).desc())
        .limit(50)
        .all()
    )

    bank_names = {b.id: b.name for b in db.query(Bank).filter(Bank.user_id == current_user.id).all()}

    return {
        "months_back": months_back,
        "min_occurrences": min_occurrences,
        "recurring": [
            {
                "description": r.key,
                "transaction_type": r.transaction_type.value if r.transaction_type else None,
                "occurrences": r.cnt,
                "avg_amount": round(float(r.avg_amount), 2),
                "first_seen": r.first_seen.isoformat() if r.first_seen else None,
                "last_seen": r.last_seen.isoformat() if r.last_seen else None,
                "bank_name": bank_names.get(r.bank_id, "Unknown"),
            }
            for r in rows
        ],
    }


@router.get("/insights")
def get_spending_insights(
    months_back: int = Query(3, ge=1, le=12),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    """Top categories, biggest transactions, unusual spend this month."""
    from datetime import timedelta
    from sqlalchemy import func
    from app.models.models import TransactionType

    now = utcnow()
    this_month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    last_month_start = (this_month_start - timedelta(days=1)).replace(day=1)
    since = now - timedelta(days=30 * months_back)

    this_month_cats = (
        db.query(Transaction.category, func.sum(Transaction.amount).label("total"))
        .filter(Transaction.user_id == current_user.id,
                Transaction.transaction_type == TransactionType.DEBIT,
                Transaction.transaction_date >= this_month_start,
                Transaction.is_duplicate == False)        # noqa: E712
        .group_by(Transaction.category)
        .order_by(func.sum(Transaction.amount).desc())
        .limit(5).all()
    )
    last_month_cats = (
        db.query(Transaction.category, func.sum(Transaction.amount).label("total"))
        .filter(Transaction.user_id == current_user.id,
                Transaction.transaction_type == TransactionType.DEBIT,
                Transaction.transaction_date >= last_month_start,
                Transaction.transaction_date < this_month_start,
                Transaction.is_duplicate == False)        # noqa: E712
        .group_by(Transaction.category).all()
    )
    last_month_map = {r.category: float(r.total) for r in last_month_cats}

    biggest = (
        db.query(Transaction)
        .filter(Transaction.user_id == current_user.id,
                Transaction.transaction_type == TransactionType.DEBIT,
                Transaction.transaction_date >= this_month_start,
                Transaction.is_duplicate == False)        # noqa: E712
        .order_by(Transaction.amount.desc()).limit(5).all()
    )

    cat_avg = (
        db.query(Transaction.category, func.avg(Transaction.amount).label("avg"))
        .filter(Transaction.user_id == current_user.id,
                Transaction.transaction_type == TransactionType.DEBIT,
                Transaction.transaction_date >= since,
                Transaction.is_duplicate == False)        # noqa: E712
        .group_by(Transaction.category).all()
    )
    avg_map = {r.category: float(r.avg) for r in cat_avg}

    unusual = db.query(Transaction).filter(
        Transaction.user_id == current_user.id,
        Transaction.transaction_type == TransactionType.DEBIT,
        Transaction.transaction_date >= this_month_start,
        Transaction.is_duplicate == False).all()        # noqa: E712
    unusual_txns = sorted(
        [t for t in unusual if t.category in avg_map and t.amount > 2 * avg_map[t.category]],
        key=lambda t: t.amount, reverse=True
    )

    monthly_spend = sum(float(r.total) for r in this_month_cats)

    return {
        "this_month": now.strftime("%B %Y"),
        "monthly_spend": round(monthly_spend, 2),
        "top_categories": [
            {
                "category": r.category or "Uncategorized",
                "total": round(float(r.total), 2),
                "prev_month_total": round(last_month_map.get(r.category, 0), 2),
                "change_pct": round(
                    ((float(r.total) - last_month_map.get(r.category, float(r.total))) /
                     max(last_month_map.get(r.category, float(r.total)), 1)) * 100, 1),
            }
            for r in this_month_cats
        ],
        "biggest_transactions": [
            {"id": t.id, "date": t.transaction_date.isoformat() if t.transaction_date else None,
             "description": t.description, "amount": round(float(t.amount), 2), "category": t.category}
            for t in biggest
        ],
        "unusual_transactions": [
            {"id": t.id, "date": t.transaction_date.isoformat() if t.transaction_date else None,
             "description": t.description, "amount": round(float(t.amount), 2),
             "category": t.category, "category_avg": round(avg_map.get(t.category, 0), 2)}
            for t in unusual_txns[:5]
        ],
    }


@router.get("/{transaction_id}", response_model=TransactionResponse)
def get_transaction(
    transaction_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    """Get transaction by ID"""
    transaction = db.query(Transaction).filter(
        and_(
            Transaction.id == transaction_id,
            Transaction.user_id.in_(visible_user_ids(db, current_user))
        )
    ).first()
    
    if not transaction:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Transaction not found"
        )
    
    return transaction


@router.put("/{transaction_id}", response_model=TransactionResponse)
def update_transaction(
    transaction_id: int,
    trans_data: TransactionUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_write_access)
):
    """Update transaction"""
    transaction = db.query(Transaction).filter(
        and_(
            Transaction.id == transaction_id,
            Transaction.user_id.in_(visible_user_ids(db, current_user))
        )
    ).first()
    
    if not transaction:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Transaction not found"
        )
    
    update_data = trans_data.dict(exclude_unset=True)
    for key, value in update_data.items():
        setattr(transaction, key, value)
    
    db.commit()
    db.refresh(transaction)
    
    return transaction


@router.delete("/{transaction_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_transaction(
    transaction_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_write_access)
):
    """Delete transaction"""
    transaction = db.query(Transaction).filter(
        and_(
            Transaction.id == transaction_id,
            Transaction.user_id.in_(visible_user_ids(db, current_user))
        )
    ).first()
    
    if not transaction:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Transaction not found"
        )
    
    db.delete(transaction)
    db.commit()

    return None


@router.post("/bulk-delete")
def bulk_delete_transactions(
    payload: BulkDeleteRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_write_access)
):
    """Delete many transactions at once (scoped to the current user)."""
    ids = payload.transaction_ids or []
    if not ids:
        return {"deleted": 0}
    deleted = (
        db.query(Transaction)
        .filter(Transaction.user_id.in_(visible_user_ids(db, current_user)), Transaction.id.in_(ids))
        .delete(synchronize_session=False)
    )
    db.commit()
    return {"deleted": deleted}


@router.post("/bulk-confirm")
def bulk_confirm_transactions(
    payload: BulkDeleteRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_write_access)
):
    """Mark many Pending transactions as Confirmed at once — the manual fallback for
    when automatic reconciliation (matching a statement/alert transaction) never finds
    a match for a given pending row (e.g. a cash-only spend, or a merchant description
    too different for the amount+date window to catch)."""
    ids = payload.transaction_ids or []
    if not ids:
        return {"confirmed": 0}
    confirmed = (
        db.query(Transaction)
        .filter(
            Transaction.user_id.in_(visible_user_ids(db, current_user)),
            Transaction.id.in_(ids),
            Transaction.is_confirmed.is_(False),
        )
        .update({"is_confirmed": True, "confirmed_at": utcnow()}, synchronize_session=False)
    )
    db.commit()
    return {"confirmed": confirmed}


@router.post("/{transaction_id}/mark-not-duplicate", response_model=TransactionResponse)
def mark_not_duplicate(
    transaction_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_write_access)
):
    """Mark transaction as not duplicate"""
    transaction = db.query(Transaction).filter(
        and_(
            Transaction.id == transaction_id,
            Transaction.user_id.in_(visible_user_ids(db, current_user))
        )
    ).first()
    
    if not transaction:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Transaction not found"
        )
    
    transaction.is_duplicate = False
    transaction.duplicate_group_id = None
    
    db.commit()
    db.refresh(transaction)
    
    return transaction


@router.post("/bulk-edit")
def bulk_edit_transactions(
    transaction_ids: List[int],
    updates: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_write_access)
):
    """Bulk edit multiple transactions"""
    
    # Get all transactions
    transactions = db.query(Transaction).filter(
        Transaction.id.in_(transaction_ids),
        Transaction.user_id.in_(visible_user_ids(db, current_user))
    ).all()
    
    if not transactions:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No transactions found"
        )
    
    updated_count = 0

    for transaction in transactions:
        changed = False
        # Update allowed fields
        if 'category' in updates and updates['category']:
            transaction.category = updates['category']
            changed = True

        if 'notes' in updates and updates['notes'] is not None:
            transaction.notes = updates['notes']
            changed = True

        if 'from_account' in updates and updates['from_account'] is not None:
            transaction.from_account = updates['from_account']
            changed = True

        if 'to_account' in updates and updates['to_account'] is not None:
            transaction.to_account = updates['to_account']
            changed = True

        if 'is_duplicate' in updates:
            transaction.is_duplicate = updates['is_duplicate']
            changed = True

        # Handle custom fields
        if 'custom_fields' in updates:
            import json
            current_custom = json.loads(transaction.custom_fields) if transaction.custom_fields else {}
            current_custom.update(updates['custom_fields'])
            transaction.custom_fields = json.dumps(current_custom)
            changed = True

        if changed:
            transaction.updated_at = utcnow()
            updated_count += 1

    db.commit()

    # Count transactions actually modified (not merely matched, and not per-field inflated).
    return {
        "success": True,
        "updated_count": updated_count,
        "matched_count": len(transactions),
        "message": f"Successfully updated {updated_count} of {len(transactions)} transactions"
    }


@router.post("/{transaction_id}/custom-fields")
def update_custom_fields(
    transaction_id: int,
    custom_fields: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_write_access)
):
    """Update custom fields for a transaction"""
    
    transaction = db.query(Transaction).filter(
        Transaction.id == transaction_id,
        Transaction.user_id.in_(visible_user_ids(db, current_user))
    ).first()
    
    if not transaction:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Transaction not found"
        )
    
    import json
    current_custom = json.loads(transaction.custom_fields) if transaction.custom_fields else {}
    current_custom.update(custom_fields)
    transaction.custom_fields = json.dumps(current_custom)
    transaction.updated_at = utcnow()
    
    db.commit()
    db.refresh(transaction)
    
    return {
        "success": True,
        "transaction_id": transaction_id,
        "custom_fields": current_custom
    }




@router.post("/remove-duplicates")
def remove_duplicates(
    keep_first: bool = True,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_write_access)
):
    """
    Find and remove duplicate transactions.
    Duplicates are identified by: date, amount, description
    """
    from sqlalchemy import func, and_
    
    # Find potential duplicates. Group by bank_id and transaction_type too, so genuinely
    # distinct transactions that merely share date/amount/description (e.g. a debit and a
    # credit of the same amount, or the same purchase at two banks) are NOT deleted.
    subquery = db.query(
        func.date(Transaction.transaction_date).label('transaction_date'),
        Transaction.amount,
        func.lower(Transaction.description).label('description'),
        func.count(Transaction.id).label('count'),
        func.array_agg(Transaction.id).label('ids')
    ).filter(
        Transaction.user_id.in_(visible_user_ids(db, current_user))
    ).group_by(
        func.date(Transaction.transaction_date),
        Transaction.amount,
        func.lower(Transaction.description),
        Transaction.bank_id,
        Transaction.transaction_type,
    ).having(func.count(Transaction.id) > 1).subquery()

    duplicates = db.query(subquery).all()
    
    removed_count = 0
    kept_ids = []
    removed_ids = []
    
    for dup in duplicates:
        # array_agg has no inherent order; sort by id so "keep first/last" is deterministic.
        transaction_ids = sorted(dup.ids)
        if keep_first:
            # Keep first, remove rest
            kept_ids.append(transaction_ids[0])
            ids_to_remove = transaction_ids[1:]
        else:
            # Keep last, remove rest
            kept_ids.append(transaction_ids[-1])
            ids_to_remove = transaction_ids[:-1]
        
        # Remove duplicates
        for tid in ids_to_remove:
            db.query(Transaction).filter(Transaction.id == tid).delete()
            removed_ids.append(tid)
            removed_count += 1
    
    db.commit()
    
    return {
        "success": True,
        "removed_count": removed_count,
        "kept_count": len(kept_ids),
        "duplicate_groups": len(duplicates),
        "removed_ids": removed_ids,
        "kept_ids": kept_ids
    }


@router.get("/duplicates/find")
def find_duplicates(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    """
    Find duplicate transactions based on EXACT match of description + amount + date.
    Only returns groups where ALL three fields match exactly.
    """
    from sqlalchemy import func
    
    # Find exact duplicates only (description + amount + date must ALL match)
    exact_matches = db.query(
        func.date(Transaction.transaction_date).label('transaction_date'),
        Transaction.amount,
        func.lower(Transaction.description).label('description'),
        func.count(Transaction.id).label('count'),
        func.array_agg(Transaction.id).label('ids')
    ).filter(
        Transaction.user_id == current_user.id
    ).group_by(
        func.date(Transaction.transaction_date),
        Transaction.amount,
        func.lower(Transaction.description)
    ).having(func.count(Transaction.id) > 1).all()
    
    result = []
    
    # Convert to response format
    for dup in exact_matches:
        transaction_ids = dup.ids
        transactions = db.query(Transaction).filter(Transaction.id.in_(transaction_ids)).all()
        
        result.append({
            "date": dup.transaction_date.isoformat() if dup.transaction_date else None,
            "amount": float(dup.amount),
            "description": dup.description,
            "count": dup.count,
            "transactions": [
                {
                    "id": t.id,
                    "date": t.transaction_date.isoformat() if t.transaction_date else None,
                    "amount": float(t.amount),
                    "description": t.description,
                    "bank_name": t.bank.name if t.bank else None,
                    "transaction_type": t.transaction_type.value if t.transaction_type else None
                }
                for t in transactions
            ]
        })
    
    return {
        "duplicate_groups": len(result),
        "total_duplicates": sum(len(g['transactions']) - 1 for g in result),
        "groups": result
    }
