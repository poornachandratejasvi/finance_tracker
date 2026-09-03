"""FX rate auto-refresh via frankfurter.dev (ECB-backed, free, no API key).

Verified live: GET /v1/latest?from=USD&to=INR -> {"rates": {"INR": 94.49}},
i.e. "1 USD = 94.49 INR" -- exactly what Currency.rate_to_base already means
when INR is the base (to_base(amount, code, rate_map) = amount * rate_map[code]).
No unit inversion needed, one call per non-base currency.
"""
import logging

import httpx

logger = logging.getLogger(__name__)

_TIMEOUT = 10.0


def fetch_rate(from_code: str, to_code: str):
    try:
        resp = httpx.get(f"https://api.frankfurter.dev/v1/latest?from={from_code}&to={to_code}", timeout=_TIMEOUT)
        resp.raise_for_status()
        return resp.json()["rates"][to_code]
    except Exception:
        logger.info("frankfurter.dev rate fetch failed for %s->%s", from_code, to_code, exc_info=True)
        return None


def refresh_rates(db, user_id: int) -> int:
    """Refreshes every non-base Currency row for this user whose rate_source
    isn't 'manual' (a manual override sticks until the user clears it, same
    convention as Bank.balance_source). Returns the count actually updated."""
    from app.core.time_utils import utcnow
    from app.services.currency_service import get_base_currency
    from app.models.models import Currency

    base = get_base_currency(db, user_id)
    if not base:
        return 0

    updated = 0
    rows = db.query(Currency).filter(Currency.user_id == user_id, Currency.is_base.isnot(True), Currency.rate_source != "manual").all()
    for c in rows:
        rate = fetch_rate(c.code, base.code)
        if rate is None:
            continue
        c.rate_to_base = float(rate)
        c.rate_updated_at = utcnow()
        updated += 1
    if updated:
        db.commit()
    return updated
