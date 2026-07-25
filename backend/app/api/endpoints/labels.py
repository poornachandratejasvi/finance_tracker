from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List

from app.core.database import get_db
from app.api.endpoints.auth import get_current_active_user
from app.models.models import User, Label, AutoLabelRule, TransactionLabel, Transaction
from app.schemas.label import (
    LabelCreate,
    LabelUpdate,
    LabelResponse,
    AutoLabelRuleCreate,
    AutoLabelRuleResponse,
    TransactionLabelCreate,
    BulkLabelRequest
)

router = APIRouter()


@router.get("/", response_model=List[LabelResponse])
def list_labels(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    """List user's labels"""
    labels = db.query(Label).filter(Label.user_id == current_user.id).all()
    results = []
    for label in labels:
        data = LabelResponse.from_orm(label).dict()
        data["auto_keywords"] = [rule.keyword for rule in label.auto_label_rules if rule.is_active]
        results.append(data)
    return results


@router.post("/", response_model=LabelResponse, status_code=status.HTTP_201_CREATED)
def create_label(
    label_data: LabelCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    """Create a new label"""
    payload = label_data.dict()
    auto_keywords = payload.pop("auto_keywords", []) or []
    label = Label(
        user_id=current_user.id,
        **payload
    )
    db.add(label)
    db.commit()
    db.refresh(label)

    for keyword in auto_keywords:
        cleaned = (keyword or "").strip()
        if not cleaned:
            continue
        db.add(AutoLabelRule(label_id=label.id, keyword=cleaned, is_active=True))
    db.commit()
    
    response = LabelResponse.from_orm(label).dict()
    response["auto_keywords"] = [rule.keyword for rule in label.auto_label_rules if rule.is_active]
    return response


@router.put("/{label_id}", response_model=LabelResponse)
def update_label(
    label_id: int,
    label_data: LabelUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    """Update label"""
    label = db.query(Label).filter(
        Label.id == label_id,
        Label.user_id == current_user.id
    ).first()
    
    if not label:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Label not found"
        )
    
    update_data = label_data.dict(exclude_unset=True)
    auto_keywords = update_data.pop("auto_keywords", None)
    for key, value in update_data.items():
        setattr(label, key, value)

    if auto_keywords is not None:
        db.query(AutoLabelRule).filter(AutoLabelRule.label_id == label.id).delete()
        for keyword in auto_keywords:
            cleaned = (keyword or "").strip()
            if not cleaned:
                continue
            db.add(AutoLabelRule(label_id=label.id, keyword=cleaned, is_active=True))
    
    db.commit()
    db.refresh(label)
    
    response = LabelResponse.from_orm(label).dict()
    response["auto_keywords"] = [rule.keyword for rule in label.auto_label_rules if rule.is_active]
    return response


@router.delete("/{label_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_label(
    label_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    """Delete label"""
    label = db.query(Label).filter(
        Label.id == label_id,
        Label.user_id == current_user.id
    ).first()
    
    if not label:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Label not found"
        )
    
    db.delete(label)
    db.commit()
    
    return None


@router.post("/{label_id}/rules", response_model=AutoLabelRuleResponse, status_code=status.HTTP_201_CREATED)
def create_auto_label_rule(
    label_id: int,
    rule_data: AutoLabelRuleCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    """Create auto-labeling rule"""
    label = db.query(Label).filter(
        Label.id == label_id,
        Label.user_id == current_user.id
    ).first()
    
    if not label:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Label not found"
        )
    
    rule = AutoLabelRule(
        label_id=label_id,
        keyword=rule_data.keyword,
        is_active=rule_data.is_active
    )
    db.add(rule)
    db.commit()
    db.refresh(rule)
    
    return rule


@router.post("/transaction-labels", status_code=status.HTTP_201_CREATED)
def add_label_to_transaction(
    data: TransactionLabelCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    """Add label to transaction"""
    # Verify transaction belongs to user
    from app.models.models import Transaction
    transaction = db.query(Transaction).filter(
        Transaction.id == data.transaction_id,
        Transaction.user_id == current_user.id
    ).first()
    
    if not transaction:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Transaction not found"
        )
    
    # Verify label belongs to user
    label = db.query(Label).filter(
        Label.id == data.label_id,
        Label.user_id == current_user.id
    ).first()
    
    if not label:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Label not found"
        )
    
    # Check if already labeled
    existing = db.query(TransactionLabel).filter(
        TransactionLabel.transaction_id == data.transaction_id,
        TransactionLabel.label_id == data.label_id
    ).first()
    
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Label already added to transaction"
        )
    
    trans_label = TransactionLabel(**data.dict())
    db.add(trans_label)
    db.commit()
    
    return {"message": "Label added successfully"}


@router.post("/bulk-label", status_code=status.HTTP_200_OK)
def bulk_label_transactions(
    data: BulkLabelRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    """Add label to multiple transactions"""
    # Verify label belongs to user
    label = db.query(Label).filter(
        Label.id == data.label_id,
        Label.user_id == current_user.id
    ).first()
    
    if not label:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Label not found"
        )
    
    # Only label transactions the CURRENT USER owns — never blindly trust the id list
    # (that allowed labelling another user's transactions).
    owned_ids = {
        row[0]
        for row in db.query(Transaction.id).filter(
            Transaction.id.in_(data.transaction_ids),
            Transaction.user_id == current_user.id,
        ).all()
    }

    count = 0
    for trans_id in owned_ids:
        # Check if already labeled
        existing = db.query(TransactionLabel).filter(
            TransactionLabel.transaction_id == trans_id,
            TransactionLabel.label_id == data.label_id
        ).first()

        if not existing:
            trans_label = TransactionLabel(
                transaction_id=trans_id,
                label_id=data.label_id
            )
            db.add(trans_label)
            count += 1

    db.commit()
    
    return {"message": f"Label added to {count} transactions"}
