"""Investment holdings ledger -- PPF, mutual funds, stocks, NPS, EPF, bonds,
gold, and vehicles. Deliberately separate from Bank/Transaction and from the
regular Banks list/net-worth figure: this gets its own dashboard, per the
user's explicit request that investments not be folded into everyday banking
balances.

Current value is always the sum of every InvestmentEntry.amount for an
account -- same "no separate mutable balance column" design as
RewardPointEntry, so there's nothing to drift out of sync.
"""
import logging
from typing import List, Optional

from sqlalchemy.orm import Session

from app.core.time_utils import utcnow
from app.models.models import InvestmentAccount, InvestmentEntry

logger = logging.getLogger(__name__)

CATEGORIES = ("ppf", "mutual_fund", "stocks", "nps", "epf", "bonds", "gold", "vehicle")
ENTRY_TYPES = ("buy", "sell", "contribution", "withdrawal", "value_update")


def account_summary(db: Session, account: InvestmentAccount) -> dict:
    entries = (
        db.query(InvestmentEntry)
        .filter(InvestmentEntry.investment_account_id == account.id)
        .all()
    )
    current_value = sum(e.amount for e in entries)
    return {
        "id": account.id,
        "name": account.name,
        "category": account.category,
        "source": account.source,
        "current_value": current_value,
        "linked_bank_id": account.linked_bank_id,
    }


def all_account_summaries(db: Session, user_id: int) -> List[dict]:
    accounts = (
        db.query(InvestmentAccount)
        .filter(InvestmentAccount.user_id == user_id, InvestmentAccount.is_active == True)  # noqa: E712
        .all()
    )
    return [account_summary(db, a) for a in accounts]


def dashboard(db: Session, user_id: int) -> dict:
    """Category-level breakdown + combined total -- the separate Investments
    dashboard (never mixed into the regular Banks/Dashboard net worth)."""
    summaries = all_account_summaries(db, user_id)
    by_category = {}
    for s in summaries:
        by_category.setdefault(s["category"], {"category": s["category"], "total_value": 0.0, "accounts": []})
        by_category[s["category"]]["total_value"] += s["current_value"]
        by_category[s["category"]]["accounts"].append(s)

    total_value = sum(s["current_value"] for s in summaries)
    return {
        "categories": sorted(by_category.values(), key=lambda c: -c["total_value"]),
        "total_value": total_value,
    }


def create_account(
    db: Session, user_id: int, name: str, category: str,
    source: str = "manual", linked_bank_id: Optional[int] = None,
) -> InvestmentAccount:
    account = InvestmentAccount(
        user_id=user_id, name=name, category=category,
        source=source, linked_bank_id=linked_bank_id,
    )
    db.add(account)
    db.commit()
    db.refresh(account)
    return account


def delete_account(db: Session, user_id: int, account_id: int) -> bool:
    account = db.query(InvestmentAccount).filter(
        InvestmentAccount.id == account_id, InvestmentAccount.user_id == user_id
    ).first()
    if not account:
        return False
    db.delete(account)
    db.commit()
    return True


def list_entries(db: Session, user_id: int, account_id: int) -> List[InvestmentEntry]:
    return (
        db.query(InvestmentEntry)
        .filter(InvestmentEntry.user_id == user_id, InvestmentEntry.investment_account_id == account_id)
        .order_by(InvestmentEntry.entry_date.desc().nullslast(), InvestmentEntry.created_at.desc())
        .all()
    )


def create_entry(
    db: Session, user_id: int, account_id: int, entry_type: str, amount: float,
    quantity: Optional[float] = None, price_per_unit: Optional[float] = None,
    entry_date=None, description: Optional[str] = None, source: str = "manual",
) -> InvestmentEntry:
    """`amount` means different things depending on entry_type: for buy/sell/
    contribution/withdrawal it's the magnitude of this transaction (signed
    here based on type). For value_update it's instead the intended NEW
    absolute current value (e.g. "mark this fund as worth 50,000 now") -- so
    it's converted to a delta against the running total before storing,
    since InvestmentEntry.amount is always a delta (current_value = sum of
    every entry, same convention as RewardPointEntry.points)."""
    if entry_type == "value_update":
        current_value = sum(
            e.amount for e in db.query(InvestmentEntry).filter(InvestmentEntry.investment_account_id == account_id).all()
        )
        signed = amount - current_value
    elif entry_type in ("buy", "contribution"):
        signed = amount
    else:
        signed = -abs(amount)
    entry = InvestmentEntry(
        user_id=user_id, investment_account_id=account_id, entry_type=entry_type,
        amount=signed, quantity=quantity, price_per_unit=price_per_unit,
        entry_date=entry_date or utcnow(), description=description, source=source,
    )
    db.add(entry)
    db.commit()
    db.refresh(entry)
    return entry


def delete_entry(db: Session, user_id: int, entry_id: int) -> bool:
    entry = db.query(InvestmentEntry).filter(
        InvestmentEntry.id == entry_id, InvestmentEntry.user_id == user_id
    ).first()
    if not entry:
        return False
    db.delete(entry)
    db.commit()
    return True


def record_ppf_statement(db, bank, text: str, statement_date) -> Optional[InvestmentEntry]:
    """Best-effort: if this bank's statement bundles a linked PPF account
    (BOB does this), auto-create the PPF InvestmentAccount the first time
    it's seen and reconcile its value to the statement's printed closing
    balance via a single 'value_update' entry -- same reconciliation pattern
    as reward_points_service.record_statement_reward_points. Never raises;
    returns None if there's no PPF section, the statement is older than
    what's already reconciled, or nothing changed.
    """
    if not text or statement_date is None:
        return None

    from app.services.pdf_parser import PDFParser
    ppf = PDFParser.extract_ppf_section(text)
    if not ppf:
        return None

    account = (
        db.query(InvestmentAccount)
        .filter(InvestmentAccount.user_id == bank.user_id, InvestmentAccount.linked_bank_id == bank.id,
                InvestmentAccount.category == "ppf")
        .first()
    )
    if not account:
        name = f"PPF{' - ' + ppf['account_number'] if ppf.get('account_number') else ''}"
        account = InvestmentAccount(
            user_id=bank.user_id, name=name, category="ppf", source="auto", linked_bank_id=bank.id,
        )
        db.add(account)
        db.commit()
        db.refresh(account)
        logger.info("Auto-created PPF investment account %s for bank %s", account.id, bank.id)

    if account.value_updated_at and statement_date <= account.value_updated_at:
        return None

    current_value = sum(
        e.amount for e in db.query(InvestmentEntry).filter(InvestmentEntry.investment_account_id == account.id).all()
    )
    delta = ppf["closing_balance"] - current_value
    account.value_updated_at = statement_date
    if abs(delta) < 0.01:
        db.commit()
        return None

    entry = InvestmentEntry(
        user_id=bank.user_id, investment_account_id=account.id, entry_type="value_update",
        amount=delta, entry_date=statement_date, source="auto",
        description=f"Reconciled to statement's printed PPF balance ({ppf['closing_balance']:,.0f})",
    )
    db.add(entry)
    db.commit()
    db.refresh(entry)
    return entry


def record_cas_statement(db, bank, text: str, statement_date) -> None:
    """Best-effort: parse a CDSL/NSDL Consolidated Account Statement (CAS) --
    a single statement covering every mutual fund folio and demat holding a
    user has, quite unlike a normal single-account bank statement.

    NOT YET IMPLEMENTED. This is a deliberate no-op placeholder until it's
    been verified against a REAL CAS PDF's actual text layout -- same
    "extract against real production data before shipping regex" discipline
    as every other statement-format-specific parser in this app (e.g.
    extract_ppf_section, extract_reward_points_breakdown). Guessing a CAS
    layout blind risks silently creating wrong InvestmentAccount values,
    which is worse than doing nothing until the real structure is in hand.
    """
    if not text:
        return None
    logger.info(
        "CAS statement received for bank %s (%d chars, statement_date=%s) -- "
        "holdings parsing not yet implemented, no-op for now",
        bank.id, len(text), statement_date,
    )
    return None
