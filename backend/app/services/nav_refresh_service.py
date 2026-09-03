"""Mutual fund / stock price auto-refresh for InvestmentAccount rows that
have both `external_ref` (MF scheme code or stock ticker) and `units_held`
set. Same "best-effort, reverse-engineered, degrade to None on any failure"
treatment as courier_trackers.py's carrier APIs -- neither of these is an
official, guaranteed-stable API.

Valuation here is otherwise 100% cash-flow-based (current_value = sum of
InvestmentEntry.amount) -- quantity/units were never reliably recorded on
past entries, so units_held is a manually-maintained field on the account
itself (the user bumps it whenever they buy more), not derived from history.
"""
import logging
from typing import Optional

import httpx

logger = logging.getLogger(__name__)

_TIMEOUT = 10.0


def fetch_mf_nav(scheme_code: str) -> Optional[float]:
    """mfapi.in -- community-run, unofficial but stable and widely used for
    Indian mutual fund NAVs. Returns None on any failure."""
    try:
        resp = httpx.get(f"https://api.mfapi.in/mf/{scheme_code}/latest", timeout=_TIMEOUT)
        resp.raise_for_status()
        data = resp.json()
        if data.get("status") != "SUCCESS" or not data.get("data"):
            return None
        return float(data["data"][0]["nav"])
    except Exception:
        logger.info("mfapi.in NAV fetch failed for scheme %s", scheme_code, exc_info=True)
        return None


def fetch_stock_price(symbol: str) -> Optional[float]:
    """Yahoo Finance's unofficial chart API -- reverse-engineered, can break
    or rate-limit without notice (same risk class as an unofficial courier-
    tracking endpoint). `symbol` should already include the exchange suffix
    the caller wants (e.g. 'RELIANCE.NS' for NSE)."""
    try:
        resp = httpx.get(
            f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}",
            headers={"User-Agent": "Mozilla/5.0"}, timeout=_TIMEOUT,
        )
        resp.raise_for_status()
        data = resp.json()
        price = data["chart"]["result"][0]["meta"]["regularMarketPrice"]
        return float(price)
    except Exception:
        logger.info("Yahoo Finance price fetch failed for symbol %s", symbol, exc_info=True)
        return None


def refresh_account(db, account) -> bool:
    """Posts a `value_update` InvestmentEntry for the delta between the
    account's current computed value and units_held * latest price, if any.
    Returns True if an entry was posted. Never raises."""
    from app.models.models import InvestmentEntry
    from app.services.investment_service import account_summary

    if not account.external_ref or not account.units_held:
        return False

    price = fetch_mf_nav(account.external_ref) if account.category == "mutual_fund" else fetch_stock_price(account.external_ref)
    if price is None:
        return False

    current_value = account_summary(db, account)["current_value"]
    target_value = account.units_held * price
    delta = target_value - current_value
    if abs(delta) < 0.01:
        return False

    db.add(InvestmentEntry(
        user_id=account.user_id, investment_account_id=account.id,
        entry_type="value_update", amount=delta, price_per_unit=price,
        source="auto", description=f"Auto NAV/price refresh ({account.external_ref} @ {price})",
    ))
    return True
