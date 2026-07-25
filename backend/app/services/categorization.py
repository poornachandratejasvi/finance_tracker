"""Keyword-rule auto-categorization: match a transaction description against a
user's CategoryRule set. Higher priority wins; ties broken by longer keyword."""
from typing import Optional, List
from sqlalchemy.orm import Session

from app.models.models import CategoryRule


def get_active_rules(db: Session, user_id: int) -> List[CategoryRule]:
    return (
        db.query(CategoryRule)
        .filter(CategoryRule.user_id == user_id, CategoryRule.is_active.is_(True))
        .order_by(CategoryRule.priority.desc())
        .all()
    )


def match_category(description: Optional[str], rules: List[CategoryRule]) -> Optional[str]:
    if not description:
        return None
    d = description.upper()
    best = None
    best_len = -1
    for r in rules:
        kw = (r.keyword or "").upper().strip()
        if kw and kw in d and len(kw) > best_len:
            best, best_len = r.category, len(kw)
    return best
