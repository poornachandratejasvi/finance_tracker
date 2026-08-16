"""Investment holdings (PPF, mutual funds, stocks, NPS, EPF, bonds, gold,
vehicles) -- see app.services.investment_service for the ledger logic.
Deliberately separate from Banks/Transactions: this has its own dashboard,
never mixed into the regular net-worth figure."""
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.endpoints.auth import get_current_active_user, require_write_access
from app.core.database import get_db
from app.models.models import User
from app.services import investment_service

router = APIRouter()


def _entry_response(e) -> dict:
    return {
        "id": e.id, "investment_account_id": e.investment_account_id, "entry_type": e.entry_type,
        "amount": e.amount, "quantity": e.quantity, "price_per_unit": e.price_per_unit,
        "entry_date": e.entry_date.isoformat() if e.entry_date else None,
        "description": e.description, "source": e.source,
        "created_at": e.created_at.isoformat(),
    }


@router.get("/")
def list_investments(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Every investment account with its current value."""
    return {"accounts": investment_service.all_account_summaries(db, current_user.id)}


@router.get("/dashboard")
def investments_dashboard(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Category-level breakdown + combined total -- the separate Investments
    dashboard, distinct from the regular Banks/Dashboard net worth."""
    return investment_service.dashboard(db, current_user.id)


class InvestmentAccountCreate(BaseModel):
    name: str
    category: str


@router.post("/", status_code=status.HTTP_201_CREATED)
def create_investment_account(
    payload: InvestmentAccountCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_write_access),
):
    if payload.category not in investment_service.CATEGORIES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"category must be one of {investment_service.CATEGORIES}")
    account = investment_service.create_account(db, current_user.id, payload.name, payload.category)
    return investment_service.account_summary(db, account)


@router.delete("/{account_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_investment_account(
    account_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_write_access),
):
    if not investment_service.delete_account(db, current_user.id, account_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Account not found")


@router.get("/{account_id}/entries")
def list_investment_entries(
    account_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    entries = investment_service.list_entries(db, current_user.id, account_id)
    return {"entries": [_entry_response(e) for e in entries]}


class InvestmentEntryCreate(BaseModel):
    entry_type: str
    amount: float
    quantity: Optional[float] = None
    price_per_unit: Optional[float] = None
    entry_date: Optional[datetime] = None
    description: Optional[str] = None


@router.post("/{account_id}/entries", status_code=status.HTTP_201_CREATED)
def create_investment_entry(
    account_id: int,
    payload: InvestmentEntryCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_write_access),
):
    if payload.entry_type not in investment_service.ENTRY_TYPES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"entry_type must be one of {investment_service.ENTRY_TYPES}")
    if payload.amount <= 0:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "amount must be a positive number")
    from app.models.models import InvestmentAccount
    account = db.query(InvestmentAccount).filter(
        InvestmentAccount.id == account_id, InvestmentAccount.user_id == current_user.id
    ).first()
    if not account:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Account not found")

    entry = investment_service.create_entry(
        db, current_user.id, account_id, payload.entry_type, payload.amount,
        quantity=payload.quantity, price_per_unit=payload.price_per_unit,
        entry_date=payload.entry_date, description=payload.description,
    )
    return _entry_response(entry)


@router.delete("/entries/{entry_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_investment_entry(
    entry_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_write_access),
):
    if not investment_service.delete_entry(db, current_user.id, entry_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Entry not found")
