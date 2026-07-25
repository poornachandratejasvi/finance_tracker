from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import or_
from typing import List, Dict, Optional
from app.core.database import get_db
from app.models.models import User, Bank
from app.api.endpoints.auth import get_current_active_user
import logging

logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("/{bank_id}")
def get_field_mapping(
    bank_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    """Get PDF field mapping for a bank"""
    
    bank = db.query(Bank).filter(
        Bank.id == bank_id,
        Bank.user_id == current_user.id
    ).first()
    
    if not bank:
        raise HTTPException(status_code=404, detail="Bank not found")
    
    # Parse field mapping from JSON
    import json
    field_mapping = json.loads(bank.field_mapping) if bank.field_mapping else {}
    
    # Default field mapping structure
    default_mapping = {
        "date_field": "transaction_date",
        "description_field": "description",
        "amount_field": "amount",
        "debit_field": "",
        "credit_field": "",
        "balance_field": "balance",
        "reference_field": "reference_number",
        "type_field": "transaction_type",
        "date_format": "%d/%m/%Y",
        "amount_format": "standard",
        "custom_fields": []
    }
    
    # Merge with existing
    default_mapping.update(field_mapping)
    
    return {
        "bank_id": bank_id,
        "bank_name": bank.name,
        "field_mapping": default_mapping,
        "available_app_fields": [
            "transaction_date",
            "description",
            "amount",
            "balance",
            "reference_number",
            "transaction_type",
            "from_account",
            "to_account",
            "category",
            "notes"
        ]
    }


@router.post("/{bank_id}")
def update_field_mapping(
    bank_id: int,
    mapping: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    """Update PDF field mapping for a bank"""
    
    bank = db.query(Bank).filter(
        Bank.id == bank_id,
        Bank.user_id == current_user.id
    ).first()
    
    if not bank:
        raise HTTPException(status_code=404, detail="Bank not found")
    
    # Save field mapping as JSON
    import json
    bank.field_mapping = json.dumps(mapping)
    
    db.commit()
    db.refresh(bank)
    
    return {
        "success": True,
        "bank_id": bank_id,
        "message": "Field mapping updated successfully"
    }


@router.get("/")
def list_all_mappings(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    """Get field mappings for all banks"""
    
    banks = db.query(Bank).filter(
        Bank.user_id == current_user.id
    ).all()
    
    import json
    result = []
    
    for bank in banks:
        field_mapping = json.loads(bank.field_mapping) if bank.field_mapping else {}
        result.append({
            "bank_id": bank.id,
            "bank_name": bank.name,
            "has_mapping": bool(field_mapping),
            "field_mapping": field_mapping
        })
    
    return {
        "banks": result,
        "total_banks": len(banks)
    }
