import json
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy import or_, func
from typing import List, Optional
from pydantic import BaseModel

from app.core.database import get_db
from app.api.endpoints.auth import get_current_active_user, require_write_access
from app.models.models import User, AutoRule, Transaction, TransactionType, TransactionLabel
from app.schemas.auto_rule import AutoRuleCreate, AutoRuleUpdate, AutoRuleResponse
from app.services.autorules import get_active_rules, match_rule, apply_rule, parse_list

router = APIRouter()


def _to_response(r: AutoRule) -> dict:
    return {
        "id": r.id, "user_id": r.user_id, "name": r.name,
        "keywords": parse_list(r.keywords), "record_type": r.record_type or "any",
        "category": r.category, "label_ids": [int(x) for x in parse_list(r.label_ids) if str(x).isdigit()],
        "priority": r.priority or 0, "is_active": bool(r.is_active), "created_at": r.created_at,
        "notify_discord": bool(r.notify_discord),
    }


@router.get("/", response_model=List[AutoRuleResponse])
def list_rules(db: Session = Depends(get_db), current_user: User = Depends(get_current_active_user)):
    rules = (
        db.query(AutoRule)
        .filter(AutoRule.user_id == current_user.id)
        .order_by(AutoRule.priority.desc(), AutoRule.name)
        .all()
    )
    return [_to_response(r) for r in rules]


@router.post("/", response_model=AutoRuleResponse, status_code=status.HTTP_201_CREATED)
def create_rule(data: AutoRuleCreate, db: Session = Depends(get_db), current_user: User = Depends(require_write_access)):
    name = (data.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Rule name is required")
    kws = [k.strip() for k in (data.keywords or []) if k and k.strip()]
    if not kws:
        raise HTTPException(status_code=400, detail="At least one keyword is required")
    rule = AutoRule(
        user_id=current_user.id, name=name, keywords=json.dumps(kws),
        record_type=(data.record_type or "any"), category=data.category,
        label_ids=json.dumps([int(x) for x in (data.label_ids or [])]),
        priority=data.priority or 0, is_active=data.is_active if data.is_active is not None else True,
        notify_discord=bool(data.notify_discord),
    )
    db.add(rule); db.commit(); db.refresh(rule)
    return _to_response(rule)


@router.put("/{rule_id}", response_model=AutoRuleResponse)
def update_rule(rule_id: int, data: AutoRuleUpdate, db: Session = Depends(get_db), current_user: User = Depends(require_write_access)):
    rule = db.query(AutoRule).filter(AutoRule.id == rule_id, AutoRule.user_id == current_user.id).first()
    if not rule:
        raise HTTPException(status_code=404, detail="Rule not found")
    u = data.dict(exclude_unset=True)
    if "name" in u and u["name"]:
        rule.name = u["name"].strip()
    if "keywords" in u and u["keywords"] is not None:
        rule.keywords = json.dumps([k.strip() for k in u["keywords"] if k and k.strip()])
    if "record_type" in u and u["record_type"]:
        rule.record_type = u["record_type"]
    if "category" in u:
        rule.category = u["category"]
    if "label_ids" in u and u["label_ids"] is not None:
        rule.label_ids = json.dumps([int(x) for x in u["label_ids"]])
    if "priority" in u and u["priority"] is not None:
        rule.priority = u["priority"]
    if "is_active" in u and u["is_active"] is not None:
        rule.is_active = u["is_active"]
    if "notify_discord" in u and u["notify_discord"] is not None:
        rule.notify_discord = u["notify_discord"]
    db.commit(); db.refresh(rule)
    return _to_response(rule)


@router.delete("/{rule_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_rule(rule_id: int, db: Session = Depends(get_db), current_user: User = Depends(require_write_access)):
    rule = db.query(AutoRule).filter(AutoRule.id == rule_id, AutoRule.user_id == current_user.id).first()
    if not rule:
        raise HTTPException(status_code=404, detail="Rule not found")
    db.delete(rule); db.commit()
    return None


class ApplyRequest(BaseModel):
    only_uncategorized: bool = False


@router.post("/apply")
def apply_rules(payload: ApplyRequest = ApplyRequest(), db: Session = Depends(get_db), current_user: User = Depends(require_write_access)):
    """Apply all active rules to existing transactions (category + labels)."""
    rules = get_active_rules(db, current_user.id)
    if not rules:
        return {"updated": 0}
    q = db.query(Transaction).filter(Transaction.user_id == current_user.id)
    if payload.only_uncategorized:
        q = q.filter((Transaction.category.is_(None)) | (Transaction.category == "") |
                     (Transaction.category.in_(["Unknown", "Others"])))
    updated = 0
    for t in q.all():
        ttype = t.transaction_type.value if hasattr(t.transaction_type, "value") else str(t.transaction_type)
        rule = match_rule(t.description, ttype, rules)
        if rule and apply_rule(db, t, rule):
            updated += 1
    db.commit()
    return {"updated": updated}


def _match_query(db: Session, uid: int, keywords, record_type):
    """Existing transactions whose description contains ANY keyword, honoring record_type
    (debit/credit filter; any/transfer = no type filter)."""
    kws = [k.strip() for k in (keywords or []) if k and k.strip()]
    if not kws:
        return None
    q = db.query(Transaction).filter(Transaction.user_id == uid)
    rt = (record_type or "any").lower()
    if rt == "debit":
        q = q.filter(Transaction.transaction_type == TransactionType.DEBIT)
    elif rt == "credit":
        q = q.filter(Transaction.transaction_type == TransactionType.CREDIT)
    conds = [func.lower(Transaction.description).like(f"%{k.lower()}%") for k in kws]
    return q.filter(or_(*conds))


class RulePreviewRequest(BaseModel):
    keywords: List[str] = []
    record_type: Optional[str] = "any"
    limit: int = 200


@router.post("/preview")
def preview_rule_matches(data: RulePreviewRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_active_user)):
    """List existing records that match the given keywords + record type (for the
    'Found existing records' / manual-find flow when building a rule)."""
    q = _match_query(db, current_user.id, data.keywords, data.record_type)
    if q is None:
        return {"count": 0, "records": []}
    total = q.count()
    rows = (
        q.order_by(Transaction.transaction_date.desc())
        .limit(max(1, min(data.limit, 500)))
        .all()
    )
    records = [{
        "id": t.id,
        "transaction_date": t.transaction_date.isoformat() if t.transaction_date else None,
        "description": t.description,
        "amount": float(t.amount) if t.amount is not None else 0.0,
        "category": t.category,
        "transaction_type": t.transaction_type.value if hasattr(t.transaction_type, "value") else str(t.transaction_type),
        "bank_name": t.bank.name if t.bank else None,
        "currency_code": t.currency_code,
    } for t in rows]
    return {"count": total, "records": records}


class ApplySelectedRequest(BaseModel):
    transaction_ids: List[int] = []
    category: Optional[str] = None
    label_ids: List[int] = []


@router.post("/apply-selected")
def apply_rule_to_selected(data: ApplySelectedRequest, db: Session = Depends(get_db), current_user: User = Depends(require_write_access)):
    """Apply a rule's actions (category + labels) to a specific set of the user's records."""
    ids = [int(i) for i in (data.transaction_ids or [])]
    if not ids:
        return {"updated": 0}
    txns = (
        db.query(Transaction)
        .filter(Transaction.user_id == current_user.id, Transaction.id.in_(ids))
        .all()
    )
    # Only attach labels the user actually owns.
    from app.models.models import Label
    owned_label_ids = set()
    if data.label_ids:
        owned_label_ids = {
            lid for (lid,) in db.query(Label.id)
            .filter(Label.user_id == current_user.id, Label.id.in_([int(x) for x in data.label_ids]))
            .all()
        }
    updated = 0
    for t in txns:
        changed = False
        if data.category and t.category != data.category:
            t.category = data.category
            changed = True
        for lid in owned_label_ids:
            exists = (
                db.query(TransactionLabel)
                .filter(TransactionLabel.transaction_id == t.id, TransactionLabel.label_id == lid)
                .first()
            )
            if not exists:
                db.add(TransactionLabel(transaction_id=t.id, label_id=lid))
                changed = True
        if changed:
            updated += 1
    db.commit()
    return {"updated": updated}


class ApplyAllMatchingRequest(BaseModel):
    keywords: List[str] = []
    record_type: Optional[str] = "any"
    category: Optional[str] = None
    label_ids: List[int] = []


@router.post("/apply-all-matching")
def apply_rule_to_all_matching(data: ApplyAllMatchingRequest, db: Session = Depends(get_db), current_user: User = Depends(require_write_access)):
    """Apply a rule's actions to EVERY record matching its keywords/record_type — not
    just the page shown in the 'Found existing records' preview (which is capped at
    500 rows for the browser). Re-runs the match query server-side so it scales to
    however many records actually match."""
    q = _match_query(db, current_user.id, data.keywords, data.record_type)
    if q is None:
        return {"updated": 0}

    from app.models.models import Label
    owned_label_ids = set()
    if data.label_ids:
        owned_label_ids = {
            lid for (lid,) in db.query(Label.id)
            .filter(Label.user_id == current_user.id, Label.id.in_([int(x) for x in data.label_ids]))
            .all()
        }

    updated = 0
    for t in q.all():
        changed = False
        if data.category and t.category != data.category:
            t.category = data.category
            changed = True
        for lid in owned_label_ids:
            exists = (
                db.query(TransactionLabel)
                .filter(TransactionLabel.transaction_id == t.id, TransactionLabel.label_id == lid)
                .first()
            )
            if not exists:
                db.add(TransactionLabel(transaction_id=t.id, label_id=lid))
                changed = True
        if changed:
            updated += 1
    db.commit()
    return {"updated": updated}
