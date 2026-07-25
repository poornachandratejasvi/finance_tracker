from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List

from app.core.database import get_db
from app.api.endpoints.auth import get_current_active_user
from app.models.models import User, Category, CategoryRule, Transaction
from app.schemas.category import (
    CategoryCreate, CategoryUpdate, CategoryResponse,
    CategoryRuleCreate, CategoryRuleUpdate, CategoryRuleResponse,
)
from app.services.seed_service import ensure_default_categories
from app.services.categorization import get_active_rules, match_category
from pydantic import BaseModel

router = APIRouter()


# ----- keyword-rule auto-categorization -----
@router.get("/rules", response_model=List[CategoryRuleResponse])
def list_category_rules(db: Session = Depends(get_db), current_user: User = Depends(get_current_active_user)):
    return (
        db.query(CategoryRule)
        .filter(CategoryRule.user_id == current_user.id)
        .order_by(CategoryRule.category, CategoryRule.priority.desc())
        .all()
    )


@router.post("/rules", response_model=CategoryRuleResponse, status_code=status.HTTP_201_CREATED)
def create_category_rule(data: CategoryRuleCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_active_user)):
    kw = (data.keyword or "").strip()
    if not kw or not (data.category or "").strip():
        raise HTTPException(status_code=400, detail="keyword and category are required")
    rule = CategoryRule(user_id=current_user.id, keyword=kw, category=data.category.strip(),
                        priority=data.priority if data.priority is not None else len(kw),
                        is_active=data.is_active if data.is_active is not None else True)
    db.add(rule); db.commit(); db.refresh(rule)
    return rule


@router.put("/rules/{rule_id}", response_model=CategoryRuleResponse)
def update_category_rule(rule_id: int, data: CategoryRuleUpdate, db: Session = Depends(get_db), current_user: User = Depends(get_current_active_user)):
    rule = db.query(CategoryRule).filter(CategoryRule.id == rule_id, CategoryRule.user_id == current_user.id).first()
    if not rule:
        raise HTTPException(status_code=404, detail="Rule not found")
    for k, v in data.dict(exclude_unset=True).items():
        setattr(rule, k, v)
    db.commit(); db.refresh(rule)
    return rule


@router.delete("/rules/{rule_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_category_rule(rule_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_active_user)):
    rule = db.query(CategoryRule).filter(CategoryRule.id == rule_id, CategoryRule.user_id == current_user.id).first()
    if not rule:
        raise HTTPException(status_code=404, detail="Rule not found")
    db.delete(rule); db.commit()
    return None


class RecategorizeRequest(BaseModel):
    only_uncategorized: bool = True


@router.post("/recategorize")
def recategorize(payload: RecategorizeRequest = RecategorizeRequest(), db: Session = Depends(get_db), current_user: User = Depends(get_current_active_user)):
    """Apply keyword rules to existing transactions. By default only touches rows
    with no/Unknown/Others category; set only_uncategorized=false to re-tag all."""
    rules = get_active_rules(db, current_user.id)
    if not rules:
        return {"updated": 0}
    q = db.query(Transaction).filter(Transaction.user_id == current_user.id)
    if payload.only_uncategorized:
        q = q.filter((Transaction.category.is_(None)) | (Transaction.category == "") |
                     (Transaction.category.in_(["Unknown", "Others"])))
    updated = 0
    for t in q.all():
        cat = match_category(t.description, rules)
        if cat and cat != t.category:
            t.category = cat
            updated += 1
    db.commit()
    return {"updated": updated}


@router.get("/", response_model=List[CategoryResponse])
def list_categories(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """List the user's categories (seeds defaults on first access)."""
    ensure_default_categories(db, current_user.id)
    return (
        db.query(Category)
        .filter(Category.user_id == current_user.id)
        .order_by(Category.sort_order, Category.name)
        .all()
    )


@router.post("/", response_model=CategoryResponse, status_code=status.HTTP_201_CREATED)
def create_category(
    data: CategoryCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    name = (data.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Category name is required")
    existing = (
        db.query(Category)
        .filter(Category.user_id == current_user.id, Category.name == name)
        .first()
    )
    if existing:
        raise HTTPException(status_code=409, detail="A category with that name already exists")
    payload = data.dict()
    payload["name"] = name
    category = Category(user_id=current_user.id, **payload)
    db.add(category)
    db.commit()
    db.refresh(category)
    return category


@router.put("/{category_id}", response_model=CategoryResponse)
def update_category(
    category_id: int,
    data: CategoryUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    category = (
        db.query(Category)
        .filter(Category.id == category_id, Category.user_id == current_user.id)
        .first()
    )
    if not category:
        raise HTTPException(status_code=404, detail="Category not found")
    for key, value in data.dict(exclude_unset=True).items():
        if key == "name" and value is not None:
            value = value.strip()
            if not value:
                continue
        setattr(category, key, value)
    db.commit()
    db.refresh(category)
    return category


@router.delete("/{category_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_category(
    category_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    category = (
        db.query(Category)
        .filter(Category.id == category_id, Category.user_id == current_user.id)
        .first()
    )
    if not category:
        raise HTTPException(status_code=404, detail="Category not found")
    db.delete(category)
    db.commit()
    return None
