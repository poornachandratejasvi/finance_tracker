"""CRUD + test/check actions for NotificationRule (multi-channel keyword-match and
missing-transaction alerting — see app.services.notification_rules for the engine)."""
import json
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List

from app.core.database import get_db
from app.api.endpoints.auth import get_current_active_user, require_write_access
from app.models.models import User, NotificationRule, Bank
from app.schemas.notification_rule import NotificationRuleCreate, NotificationRuleUpdate, NotificationRuleResponse
from app.services.autorules import parse_list
from app.services.notification_rules import send_test_notification, run_absence_checks

router = APIRouter()

VALID_TRIGGER_TYPES = ("match", "absence")
VALID_RECORD_TYPES = ("any", "debit", "credit", "transfer")
VALID_AMOUNT_OPERATORS = ("none", "eq", "gte", "lte", "between")
VALID_CONDITION_LOGIC = ("and", "or")


def _to_response(r: NotificationRule, bank_name: str = None) -> dict:
    return {
        "id": r.id, "user_id": r.user_id, "name": r.name,
        "trigger_type": r.trigger_type or "match",
        "keywords": parse_list(r.keywords),
        "keyword_negate": bool(r.keyword_negate),
        "record_type": r.record_type or "any",
        "bank_id": r.bank_id, "bank_name": bank_name,
        "amount_operator": r.amount_operator or "none",
        "amount_value": r.amount_value,
        "amount_value_max": r.amount_value_max,
        "amount_negate": bool(r.amount_negate),
        "condition_logic": r.condition_logic or "and",
        "check_day_of_month": r.check_day_of_month or 28,
        "notify_discord": bool(r.notify_discord),
        "notify_email": bool(r.notify_email),
        "email_to": r.email_to,
        "notify_task": bool(r.notify_task),
        "is_active": bool(r.is_active),
        "last_triggered_at": r.last_triggered_at,
        "last_triggered_month": r.last_triggered_month,
        "created_at": r.created_at,
    }


def _bank_names(db: Session, uid: int) -> dict:
    return {b.id: b.name for b in db.query(Bank).filter(Bank.user_id == uid).all()}


@router.get("/", response_model=List[NotificationRuleResponse])
def list_rules(db: Session = Depends(get_db), current_user: User = Depends(get_current_active_user)):
    rules = (
        db.query(NotificationRule)
        .filter(NotificationRule.user_id == current_user.id)
        .order_by(NotificationRule.name)
        .all()
    )
    banks = _bank_names(db, current_user.id)
    return [_to_response(r, banks.get(r.bank_id)) for r in rules]


def _validate(data) -> None:
    if data.trigger_type is not None and data.trigger_type not in VALID_TRIGGER_TYPES:
        raise HTTPException(status_code=400, detail=f"trigger_type must be one of {VALID_TRIGGER_TYPES}")
    if data.record_type is not None and data.record_type not in VALID_RECORD_TYPES:
        raise HTTPException(status_code=400, detail=f"record_type must be one of {VALID_RECORD_TYPES}")
    if data.amount_operator is not None and data.amount_operator not in VALID_AMOUNT_OPERATORS:
        raise HTTPException(status_code=400, detail=f"amount_operator must be one of {VALID_AMOUNT_OPERATORS}")
    if data.condition_logic is not None and data.condition_logic not in VALID_CONDITION_LOGIC:
        raise HTTPException(status_code=400, detail=f"condition_logic must be one of {VALID_CONDITION_LOGIC}")


@router.post("/", response_model=NotificationRuleResponse, status_code=status.HTTP_201_CREATED)
def create_rule(data: NotificationRuleCreate, db: Session = Depends(get_db), current_user: User = Depends(require_write_access)):
    name = (data.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Rule name is required")
    _validate(data)
    kws = [k.strip() for k in (data.keywords or []) if k and k.strip()]
    amount_op = (data.amount_operator or "none").lower()
    has_amount_condition = amount_op != "none"
    if not kws and not has_amount_condition:
        raise HTTPException(status_code=400, detail="Configure at least one condition: keywords or an amount condition")
    if has_amount_condition and data.amount_value is None:
        raise HTTPException(status_code=400, detail="amount_value is required when amount_operator is set")
    if amount_op == "between" and data.amount_value_max is None:
        raise HTTPException(status_code=400, detail="amount_value_max is required for a 'between' amount condition")
    if not (data.notify_discord or data.notify_email or data.notify_task):
        raise HTTPException(status_code=400, detail="Enable at least one notification channel")
    if data.bank_id is not None:
        owns = db.query(Bank.id).filter(Bank.id == data.bank_id, Bank.user_id == current_user.id).first()
        if not owns:
            raise HTTPException(status_code=404, detail="bank_id not found")

    rule = NotificationRule(
        user_id=current_user.id, name=name,
        trigger_type=data.trigger_type or "match",
        keywords=json.dumps(kws),
        keyword_negate=bool(data.keyword_negate),
        record_type=data.record_type or "any",
        bank_id=data.bank_id,
        amount_operator=amount_op,
        amount_value=data.amount_value if has_amount_condition else None,
        amount_value_max=data.amount_value_max if amount_op == "between" else None,
        amount_negate=bool(data.amount_negate),
        condition_logic=(data.condition_logic or "and").lower(),
        check_day_of_month=data.check_day_of_month or 28,
        notify_discord=bool(data.notify_discord),
        notify_email=bool(data.notify_email),
        email_to=(data.email_to or None),
        notify_task=bool(data.notify_task),
        is_active=data.is_active if data.is_active is not None else True,
    )
    db.add(rule); db.commit(); db.refresh(rule)
    return _to_response(rule, _bank_names(db, current_user.id).get(rule.bank_id))


@router.put("/{rule_id}", response_model=NotificationRuleResponse)
def update_rule(rule_id: int, data: NotificationRuleUpdate, db: Session = Depends(get_db), current_user: User = Depends(require_write_access)):
    rule = db.query(NotificationRule).filter(NotificationRule.id == rule_id, NotificationRule.user_id == current_user.id).first()
    if not rule:
        raise HTTPException(status_code=404, detail="Rule not found")
    _validate(data)
    u = data.dict(exclude_unset=True)
    if "name" in u and u["name"]:
        rule.name = u["name"].strip()
    if "trigger_type" in u and u["trigger_type"]:
        rule.trigger_type = u["trigger_type"]
    if "keywords" in u and u["keywords"] is not None:
        rule.keywords = json.dumps([k.strip() for k in u["keywords"] if k and k.strip()])
    if "keyword_negate" in u and u["keyword_negate"] is not None:
        rule.keyword_negate = u["keyword_negate"]
    if "record_type" in u and u["record_type"]:
        rule.record_type = u["record_type"]
    if "bank_id" in u:
        if u["bank_id"] is not None:
            owns = db.query(Bank.id).filter(Bank.id == u["bank_id"], Bank.user_id == current_user.id).first()
            if not owns:
                raise HTTPException(status_code=404, detail="bank_id not found")
        rule.bank_id = u["bank_id"]
    if "amount_operator" in u and u["amount_operator"] is not None:
        rule.amount_operator = u["amount_operator"].lower()
        if rule.amount_operator == "none":
            rule.amount_value = None
            rule.amount_value_max = None
    if "amount_value" in u:
        rule.amount_value = u["amount_value"]
    if "amount_value_max" in u:
        rule.amount_value_max = u["amount_value_max"]
    if "amount_negate" in u and u["amount_negate"] is not None:
        rule.amount_negate = u["amount_negate"]
    if "condition_logic" in u and u["condition_logic"] is not None:
        rule.condition_logic = u["condition_logic"].lower()
    if "check_day_of_month" in u and u["check_day_of_month"] is not None:
        rule.check_day_of_month = max(1, min(28, int(u["check_day_of_month"])))
    if "notify_discord" in u and u["notify_discord"] is not None:
        rule.notify_discord = u["notify_discord"]
    if "notify_email" in u and u["notify_email"] is not None:
        rule.notify_email = u["notify_email"]
    if "email_to" in u:
        rule.email_to = u["email_to"] or None
    if "notify_task" in u and u["notify_task"] is not None:
        rule.notify_task = u["notify_task"]
    if "is_active" in u and u["is_active"] is not None:
        rule.is_active = u["is_active"]

    has_keywords = bool(parse_list(rule.keywords))
    has_amount_condition = (rule.amount_operator or "none") != "none"
    if not has_keywords and not has_amount_condition:
        db.rollback()
        raise HTTPException(status_code=400, detail="Configure at least one condition: keywords or an amount condition")
    if has_amount_condition and rule.amount_value is None:
        db.rollback()
        raise HTTPException(status_code=400, detail="amount_value is required when amount_operator is set")
    if rule.amount_operator == "between" and rule.amount_value_max is None:
        db.rollback()
        raise HTTPException(status_code=400, detail="amount_value_max is required for a 'between' amount condition")

    db.commit(); db.refresh(rule)
    return _to_response(rule, _bank_names(db, current_user.id).get(rule.bank_id))


@router.delete("/{rule_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_rule(rule_id: int, db: Session = Depends(get_db), current_user: User = Depends(require_write_access)):
    rule = db.query(NotificationRule).filter(NotificationRule.id == rule_id, NotificationRule.user_id == current_user.id).first()
    if not rule:
        raise HTTPException(status_code=404, detail="Rule not found")
    db.delete(rule); db.commit()
    return None


@router.post("/{rule_id}/test")
def test_rule(rule_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_active_user)):
    """Fire every enabled channel with a canned test message (doesn't count as a
    real trigger — last_triggered_at/month are left untouched)."""
    rule = db.query(NotificationRule).filter(NotificationRule.id == rule_id, NotificationRule.user_id == current_user.id).first()
    if not rule:
        raise HTTPException(status_code=404, detail="Rule not found")
    result = send_test_notification(db, current_user.id, rule)
    return {"result": result}


@router.post("/check-absence-now")
def check_absence_now(db: Session = Depends(get_db), current_user: User = Depends(get_current_active_user)):
    """Manually run the absence check immediately (normally runs every few hours via
    Celery beat) — useful right after creating/editing an absence rule."""
    fired = run_absence_checks(db)
    return {"fired": fired}
