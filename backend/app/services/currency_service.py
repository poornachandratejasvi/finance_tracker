"""Multi-currency helpers: resolve per-user rates and convert amounts to the
user's base currency for cross-account aggregation.

rate_to_base = units of BASE currency per 1 unit of the given currency, so
    amount_in_base = amount * rate_to_base
The base currency has rate_to_base == 1.0.
"""
from typing import Dict, Optional

from sqlalchemy.orm import Session

from app.models.models import Currency, Bank


def get_rate_map(db: Session, user_id: int) -> Dict[str, float]:
    """{currency_code: rate_to_base} for the user. Always includes 'INR': 1.0
    as a safe fallback so callers never KeyError on legacy rows."""
    rows = db.query(Currency).filter(Currency.user_id == user_id).all()
    rate_map = {r.code: (r.rate_to_base if r.rate_to_base else 1.0) for r in rows}
    rate_map.setdefault("INR", 1.0)
    return rate_map


def get_base_currency(db: Session, user_id: int) -> Optional[Currency]:
    """The user's base currency row (is_base=True), or None."""
    return (
        db.query(Currency)
        .filter(Currency.user_id == user_id, Currency.is_base.is_(True))
        .first()
    )


def to_base(amount: Optional[float], code: Optional[str], rate_map: Dict[str, float]) -> float:
    """Convert an amount in `code` to the base currency. Unknown codes pass through
    at rate 1.0 (treated as already base) to avoid dropping data."""
    if amount is None:
        return 0.0
    rate = rate_map.get(code or "INR", 1.0)
    return float(amount) * (rate if rate else 1.0)


def bank_currency_map(db: Session, user_id: int) -> Dict[int, str]:
    """{bank_id: currency_code} so transaction rows (which may have a NULL
    currency_code) can inherit their account's currency."""
    rows = db.query(Bank.id, Bank.currency_code).filter(Bank.user_id == user_id).all()
    return {bid: (code or "INR") for bid, code in rows}
