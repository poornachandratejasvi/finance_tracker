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
        "external_ref": account.external_ref,
        "units_held": account.units_held,
        "tax_section": account.tax_section,
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


def _reconcile_category_account(
    db, bank, category: str, name: str, value: float, statement_date, description: str,
) -> Optional[InvestmentEntry]:
    """Shared reconciliation: find-or-create the one auto account for this
    bank+category, then bring its running value to `value` via a single
    'value_update' entry -- same pattern used for PPF and, below, for each
    CAS category (mutual_fund/stocks). Returns None if the statement is
    older than what's already reconciled, or nothing changed.
    """
    account = (
        db.query(InvestmentAccount)
        .filter(InvestmentAccount.user_id == bank.user_id, InvestmentAccount.linked_bank_id == bank.id,
                InvestmentAccount.category == category)
        .first()
    )
    if not account:
        account = InvestmentAccount(
            user_id=bank.user_id, name=name, category=category, source="auto", linked_bank_id=bank.id,
        )
        db.add(account)
        db.commit()
        db.refresh(account)
        logger.info("Auto-created %s investment account %s for bank %s", category, account.id, bank.id)

    if account.value_updated_at and statement_date <= account.value_updated_at:
        return None

    current_value = sum(
        e.amount for e in db.query(InvestmentEntry).filter(InvestmentEntry.investment_account_id == account.id).all()
    )
    delta = value - current_value
    account.value_updated_at = statement_date
    if abs(delta) < 0.01:
        db.commit()
        return None

    entry = InvestmentEntry(
        user_id=bank.user_id, investment_account_id=account.id, entry_type="value_update",
        amount=delta, entry_date=statement_date, source="auto", description=description,
    )
    db.add(entry)
    db.commit()
    db.refresh(entry)
    return entry


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

    name = f"PPF{' - ' + ppf['account_number'] if ppf.get('account_number') else ''}"
    return _reconcile_category_account(
        db, bank, "ppf", name, ppf["closing_balance"], statement_date,
        description=f"Reconciled to statement's printed PPF balance ({ppf['closing_balance']:,.0f})",
    )


def record_cas_statement(db, bank, text: str, statement_date) -> List[InvestmentEntry]:
    """Best-effort: parse a CDSL/NSDL Consolidated Account Statement (CAS) --
    a single statement covering every mutual fund folio and demat holding a
    user has, quite unlike a normal single-account bank statement.

    A CAS's per-folio detail is either unreliable to extract (bilingual
    summary pages get interleaved character-by-character) or simply doesn't
    print per-folio valuation figures in the detail section (confirmed
    against a real statement -- only folio identification fields like AMC/
    Scheme/Folio No/ISIN are there, no values). So rather than guess a
    fragile per-scheme breakdown, this reconciles two portfolio-level
    totals -- "Mutual Fund Folios" and "CDSL Demat Account" -- each to its
    own auto InvestmentAccount ("mutual_fund" / "stocks" category), same
    single-account reconciliation pattern as record_ppf_statement. Never
    raises; returns whatever entries were actually created (may be empty).
    """
    if not text or statement_date is None:
        return []

    from app.services.pdf_parser import PDFParser
    cas = PDFParser.extract_cas_section(text)
    if not cas:
        return []

    entries = []
    if cas.get("mutual_fund_value") is not None:
        entry = _reconcile_category_account(
            db, bank, "mutual_fund", "Mutual Funds (CDSL CAS)", cas["mutual_fund_value"], statement_date,
            description=f"Reconciled to statement's printed Mutual Fund Folios total ({cas['mutual_fund_value']:,.0f})",
        )
        if entry:
            entries.append(entry)
    if cas.get("stocks_value") is not None:
        entry = _reconcile_category_account(
            db, bank, "stocks", "Stocks (CDSL Demat)", cas["stocks_value"], statement_date,
            description=f"Reconciled to statement's printed CDSL Demat Account total ({cas['stocks_value']:,.0f})",
        )
        if entry:
            entries.append(entry)
    return entries
