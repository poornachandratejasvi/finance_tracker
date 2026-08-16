"""Universal search across the caller's own data -- transactions, banks,
categories, labels, templates, and reward point entries in one query, so a
single search box can answer "where is X" without knowing which page it
lives on. Scoped by visible_user_ids (self, or the whole household if the
caller is admin), same as everywhere else the family-sharing model applies.
"""
from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.api.endpoints.auth import get_current_active_user
from app.core.household import visible_user_ids
from app.models.models import (
    User, Transaction, Bank, Category, Label, Template, RewardPointEntry,
)

router = APIRouter()

PER_TYPE_LIMIT = 8


@router.get("/")
def search(
    q: str = Query(..., min_length=1),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    like = f"%{q}%"
    user_ids = visible_user_ids(db, current_user)

    transactions = (
        db.query(Transaction)
        .filter(Transaction.user_id.in_(user_ids), Transaction.description.ilike(like))
        .order_by(Transaction.transaction_date.desc())
        .limit(PER_TYPE_LIMIT)
        .all()
    )
    banks = (
        db.query(Bank)
        .filter(Bank.user_id.in_(user_ids), Bank.name.ilike(like))
        .limit(PER_TYPE_LIMIT)
        .all()
    )
    categories = (
        db.query(Category)
        .filter(Category.user_id.in_(user_ids), Category.name.ilike(like))
        .limit(PER_TYPE_LIMIT)
        .all()
    )
    labels = (
        db.query(Label)
        .filter(Label.user_id.in_(user_ids), Label.name.ilike(like))
        .limit(PER_TYPE_LIMIT)
        .all()
    )
    templates = (
        db.query(Template)
        .filter(Template.user_id.in_(user_ids), Template.name.ilike(like))
        .limit(PER_TYPE_LIMIT)
        .all()
    )
    reward_entries = (
        db.query(RewardPointEntry)
        .filter(RewardPointEntry.user_id.in_(user_ids), RewardPointEntry.description.ilike(like))
        .limit(PER_TYPE_LIMIT)
        .all()
    )

    bank_name_by_id = {b.id: b.name for b in db.query(Bank).filter(Bank.user_id.in_(user_ids)).all()}

    return {
        "transactions": [
            {
                "id": t.id,
                "type": "transaction",
                "title": t.description,
                "subtitle": f"{t.amount:,.2f} · {bank_name_by_id.get(t.bank_id, '')} · "
                            f"{t.transaction_date.strftime('%d %b %Y') if t.transaction_date else ''}",
            }
            for t in transactions
        ],
        "banks": [
            {"id": b.id, "type": "bank", "title": b.name, "subtitle": b.bank_type or ""}
            for b in banks
        ],
        "categories": [
            {"id": c.id, "type": "category", "title": c.name, "subtitle": c.kind or ""}
            for c in categories
        ],
        "labels": [
            {"id": l.id, "type": "label", "title": l.name, "subtitle": "Label"}
            for l in labels
        ],
        "templates": [
            {"id": t.id, "type": "template", "title": t.name, "subtitle": t.category or ""}
            for t in templates
        ],
        "reward_points": [
            {
                "id": r.id, "type": "reward_point", "title": r.description or "Reward points entry",
                "subtitle": f"{bank_name_by_id.get(r.bank_id, '')} · {r.points:+.0f} pts",
            }
            for r in reward_entries
        ],
    }
