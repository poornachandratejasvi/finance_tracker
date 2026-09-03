from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List

from app.core.database import get_db
from app.api.endpoints.auth import get_current_active_user
from app.models.models import User, Currency
from app.schemas.currency import CurrencyCreate, CurrencyUpdate, CurrencyResponse
from app.services.seed_service import ensure_default_currencies

router = APIRouter()


def _normalize_code(code: str) -> str:
    return (code or "").strip().upper()


@router.get("/", response_model=List[CurrencyResponse])
def list_currencies(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """List the user's currencies (seeds defaults on first access)."""
    ensure_default_currencies(db, current_user.id)
    return (
        db.query(Currency)
        .filter(Currency.user_id == current_user.id)
        .order_by(Currency.is_base.desc(), Currency.code)
        .all()
    )


@router.post("/", response_model=CurrencyResponse, status_code=status.HTTP_201_CREATED)
def create_currency(
    data: CurrencyCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    code = _normalize_code(data.code)
    if not code:
        raise HTTPException(status_code=400, detail="Currency code is required")
    existing = (
        db.query(Currency)
        .filter(Currency.user_id == current_user.id, Currency.code == code)
        .first()
    )
    if existing:
        raise HTTPException(status_code=409, detail="That currency already exists")
    payload = data.dict()
    payload["code"] = code
    currency = Currency(user_id=current_user.id, **payload)
    if currency.is_base:
        currency.rate_to_base = 1.0
        currency.rate_source = "manual"
        _clear_other_base(db, current_user.id, exclude_id=None)
    elif "rate_source" not in data.dict(exclude_unset=True):
        currency.rate_source = "auto"  # a new non-base currency almost always wants auto-refresh
    db.add(currency)
    db.commit()
    db.refresh(currency)
    return currency


@router.put("/{currency_id}", response_model=CurrencyResponse)
def update_currency(
    currency_id: int,
    data: CurrencyUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    currency = (
        db.query(Currency)
        .filter(Currency.id == currency_id, Currency.user_id == current_user.id)
        .first()
    )
    if not currency:
        raise HTTPException(status_code=404, detail="Currency not found")
    update = data.dict(exclude_unset=True)
    if "code" in update and update["code"] is not None:
        update["code"] = _normalize_code(update["code"])
    for key, value in update.items():
        setattr(currency, key, value)
    if currency.is_base:
        currency.rate_to_base = 1.0
        _clear_other_base(db, current_user.id, exclude_id=currency.id)
    db.commit()
    db.refresh(currency)
    return currency


@router.delete("/{currency_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_currency(
    currency_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    currency = (
        db.query(Currency)
        .filter(Currency.id == currency_id, Currency.user_id == current_user.id)
        .first()
    )
    if not currency:
        raise HTTPException(status_code=404, detail="Currency not found")
    if currency.is_base:
        raise HTTPException(status_code=400, detail="Cannot delete the base currency")
    db.delete(currency)
    db.commit()
    return None


@router.post("/refresh")
def refresh_rates_now(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Manually trigger the same FX refresh the daily task runs -- see fx_refresh_service.py."""
    from app.services import fx_refresh_service

    updated = fx_refresh_service.refresh_rates(db, current_user.id)
    return {"updated": updated}


def _clear_other_base(db: Session, user_id: int, exclude_id) -> None:
    """Ensure exactly one base currency by unsetting is_base on all others."""
    q = db.query(Currency).filter(
        Currency.user_id == user_id, Currency.is_base.is_(True)
    )
    if exclude_id is not None:
        q = q.filter(Currency.id != exclude_id)
    for other in q.all():
        other.is_base = False
