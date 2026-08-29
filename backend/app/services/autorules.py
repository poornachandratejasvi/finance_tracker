"""Apply Wallet-style AutoRules: keyword(+record-type) match → assign category + labels."""
import json
from typing import List, Optional

from sqlalchemy.orm import Session

from app.models.models import AutoRule, TransactionLabel


def parse_list(txt):
    if not txt:
        return []
    if isinstance(txt, list):
        return txt
    try:
        v = json.loads(txt)
        return v if isinstance(v, list) else []
    except (ValueError, TypeError):
        return []


def get_active_rules(db: Session, user_id: int) -> List[AutoRule]:
    return (
        db.query(AutoRule)
        .filter(AutoRule.user_id == user_id, AutoRule.is_active.is_(True))
        .order_by(AutoRule.priority.desc(), AutoRule.id.asc())
        .all()
    )


def match_rule(description: Optional[str], ttype_value: Optional[str], rules: List[AutoRule]) -> Optional[AutoRule]:
    d = (description or "").upper()
    if not d:
        return None
    for r in rules:
        rt = (r.record_type or "any").lower()
        if rt in ("debit", "credit") and (ttype_value or "") != rt:
            continue
        for kw in parse_list(r.keywords):
            if kw and str(kw).upper().strip() in d:
                return r
    return None


def apply_rule(db: Session, transaction, rule: AutoRule) -> bool:
    """Apply a matched rule's category + labels to a transaction. Returns True if changed.

    record_type='transfer' rules are a distinct action, not just a filter: they
    mark the matching transaction as a transfer (category="Transfer", the same
    convention the Add/Edit Transaction forms use for transfer mode) instead of
    whatever category the rule itself has configured -- a Transfer Rule's
    category/labels fields are hidden client-side for exactly this reason.
    """
    changed = False
    if (rule.record_type or "any").lower() == "transfer":
        if transaction.category != "Transfer":
            transaction.category = "Transfer"
            changed = True
        return changed
    if rule.category and transaction.category != rule.category:
        transaction.category = rule.category
        changed = True
    for lid in parse_list(rule.label_ids):
        try:
            lid = int(lid)
        except (ValueError, TypeError):
            continue
        exists = (
            db.query(TransactionLabel)
            .filter(TransactionLabel.transaction_id == transaction.id, TransactionLabel.label_id == lid)
            .first()
        )
        if not exists:
            db.add(TransactionLabel(transaction_id=transaction.id, label_id=lid))
            changed = True
    return changed
