"""Imports Pluxee's emailed "Transaction statement" spreadsheet (.xls/.xlsx).

Pluxee never sends a PDF statement, and its per-purchase alert emails only cover
card payments -- not employer top-ups -- and not every purchase. But the
cardholder can request a statement for any date range in the Pluxee app, which
emails a spreadsheet (from noreply-cardinfo@services.pluxee.in, or forwarded
from a work inbox) holding every transaction with its running balance plus the
account's current balance. This reads one and reconciles it into the account:
transactions already known (e.g. created earlier from an alert) are confirmed
in place, the rest are added, and the balance is set from the statement.

Sheets (seen in a real statement):
  account_balance      -- "Date & Time of balance" | "Account Name" | "Account Balance(in Rs.)"
  transactions_details -- "Date & Time of Balance" | "Card type" | "Transaction ID" |
                          "Transaction Details" | "Credit(in Rs.)" | "Debit(in Rs.)" |
                          "Previous Balance(in Rs.)" | "New Balance(in Rs.)"
Dates are dd/mm/yyyy hh:mm:ss, amounts are strings with thousands commas.
"""
import io
import logging
from datetime import datetime
from typing import Dict, List, Optional

logger = logging.getLogger(__name__)

STATEMENT_EXTENSIONS = (".xls", ".xlsx")
# Gmail-side search -- narrowed afterward by the sheet's own headers, so a stray
# unrelated spreadsheet from some other "pluxee" mention is simply ignored.
STATEMENT_QUERY = 'has:attachment (filename:xls OR filename:xlsx) pluxee'


def _num(raw) -> Optional[float]:
    if raw is None:
        return None
    if isinstance(raw, (int, float)):
        return None if raw != raw else float(raw)
    text = str(raw).replace(",", "").replace("₹", "").replace("Rs.", "").strip()
    try:
        return float(text)
    except ValueError:
        return None


def _when(raw) -> Optional[datetime]:
    if isinstance(raw, datetime):
        return raw
    text = str(raw or "").strip()
    for fmt in ("%d/%m/%Y %H:%M:%S", "%d/%m/%Y %H:%M", "%d/%m/%Y"):
        try:
            return datetime.strptime(text, fmt)
        except ValueError:
            continue
    return None


def _find_header_row(frame, *needles):
    for idx in range(min(len(frame), 15)):
        cells = [str(c).strip().lower() for c in frame.iloc[idx].tolist()]
        if all(any(n in c for c in cells) for n in needles):
            return idx, cells
    return None, None


def parse_pluxee_statement(data: bytes) -> Optional[Dict]:
    """Return {"balance", "balance_at", "transactions": [{date, type, amount,
    description, reference, balance}]} or None if this isn't a Pluxee
    transaction statement. Transactions come back newest-first, as in the file."""
    import pandas as pd

    try:
        sheets = pd.read_excel(io.BytesIO(data), header=None, sheet_name=None, dtype=object)
    except Exception:
        logger.warning("Could not open spreadsheet attachment as Excel", exc_info=True)
        return None

    transactions: List[Dict] = []
    balance = balance_at = None
    found_table = False
    for frame in sheets.values():
        row_idx, cells = _find_header_row(frame, "transaction details", "debit", "credit")
        if row_idx is not None:
            found_table = True
            col = lambda *keys: next(i for i, c in enumerate(cells) if all(k in c for k in keys))
            c_date, c_id = col("date"), col("transaction id")
            c_desc, c_cr, c_dr, c_bal = col("transaction details"), col("credit"), col("debit"), col("new balance")
            for _, row in frame.iloc[row_idx + 1:].iterrows():
                when = _when(row.iloc[c_date])
                credit, debit = _num(row.iloc[c_cr]) or 0.0, _num(row.iloc[c_dr]) or 0.0
                if when is None or (credit > 0) == (debit > 0):
                    continue
                transactions.append({
                    "date": when,
                    "type": "credit" if credit > 0 else "debit",
                    "amount": credit if credit > 0 else debit,
                    "description": str(row.iloc[c_desc]).strip(),
                    "reference": str(row.iloc[c_id]).strip(),
                    "balance": _num(row.iloc[c_bal]),
                })
            continue
        row_idx, cells = _find_header_row(frame, "account balance")
        if row_idx is not None and len(frame) > row_idx + 1:
            c_date = next((i for i, c in enumerate(cells) if "date" in c), 0)
            c_bal = next(i for i, c in enumerate(cells) if "account balance" in c)
            data_row = frame.iloc[row_idx + 1]
            balance, balance_at = _num(data_row.iloc[c_bal]), _when(data_row.iloc[c_date])

    if not found_table:
        return None
    if balance is None and transactions:
        newest = max(transactions, key=lambda t: t["date"])
        balance, balance_at = newest["balance"], newest["date"]
    return {"balance": balance, "balance_at": balance_at, "transactions": transactions}


def apply_pluxee_statement(db, bank, parsed: Dict) -> Dict:
    """Reconcile a parsed statement into `bank`. Idempotent: re-importing the same
    (or an overlapping) statement adds nothing new. Returns counts."""
    from app.core.time_utils import utcnow
    from app.models.models import Transaction, TransactionType
    from app.services.categorization import resolve_category
    from app.services.transaction_hooks import find_pending_match

    added = confirmed = 0
    for t in parsed["transactions"]:
        ttype = TransactionType(t["type"])
        # The same Pluxee transaction id can legitimately appear once per direction
        # (a refund-then-reclaim reuses it), hence the type in the key.
        already = db.query(Transaction.id).filter(
            Transaction.bank_id == bank.id, Transaction.reference_number == t["reference"],
            Transaction.transaction_type == ttype,
        ).first()
        if already:
            continue

        # Absorb a Pending alert-created row for this purchase instead of doubling it.
        pending = find_pending_match(db, bank.user_id, bank.id, ttype, t["amount"], t["date"])
        if pending:
            pending.transaction_date = t["date"]
            pending.description = t["description"]
            pending.reference_number = t["reference"]
            pending.balance = t["balance"]
            pending.is_confirmed = True
            pending.confirmed_at = utcnow()
            pending.source = "statement"
            confirmed += 1
            continue

        db.add(Transaction(
            user_id=bank.user_id, bank_id=bank.id, transaction_date=t["date"],
            description=t["description"], original_description=t["description"],
            amount=t["amount"], transaction_type=ttype, balance=t["balance"],
            reference_number=t["reference"], source="statement", is_confirmed=True,
            category=resolve_category(db, bank.user_id, t["description"]),
        ))
        added += 1

    balance_updated = False
    if parsed["balance"] is not None and bank.balance_source != "manual":
        existing = bank.balance_updated_at
        if existing is not None and getattr(existing, "tzinfo", None) is not None:
            existing = existing.replace(tzinfo=None)
        if existing is None or parsed["balance_at"] is None or parsed["balance_at"] >= existing:
            bank.current_balance = parsed["balance"]
            bank.balance_updated_at = parsed["balance_at"] or utcnow()
            bank.balance_source = "auto"
            balance_updated = True
    return {"added": added, "confirmed": confirmed, "balance_updated": balance_updated}
