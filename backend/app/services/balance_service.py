from datetime import datetime
from typing import Optional


def _stmt_end(parse_result: dict, fallback_date: Optional[datetime]) -> Optional[datetime]:
    return (parse_result.get("statement_period", {}) or {}).get("end") or fallback_date


def apply_statement_balance(
    bank, parse_result: dict, fallback_date: Optional[datetime] = None,
    ai_context: Optional[dict] = None,
) -> bool:
    """Update a bank's stored balance from a parsed statement, if available.

    For credit cards we prefer the statement's "Total Amount Due" (the real
    outstanding), stored as a positive amount-owed. For other accounts we use the
    per-row running ending balance.

    ``ai_context`` (optional {"db": Session, "user_id": int}): when the statement is
    a credit card and regex extraction of Total Amount Due comes up empty, ask the
    user's configured AI provider to read the statement text and find it — some
    issuer layouts split the label and figure across table cells in a way no single
    regex handles. Best-effort; failures are swallowed and fall through to the
    existing ending_balance/running-balance fallbacks below.

    Guard: an OLDER statement must not overwrite a balance that came from a newer
    one (statements are often uploaded out of chronological order). ``recompute_bank_balance``
    is the authoritative source for savings/other; this remains for the immediate
    per-upload update and for credit-card Total Amount Due.
    """
    is_credit = (getattr(bank, "bank_type", "") or "").lower() == "credit"

    new_balance = None
    if is_credit:
        # Credit cards: outstanding comes from the labelled Total Amount Due.
        new_balance = parse_result.get("total_amount_due")
        if new_balance is None and ai_context and parse_result.get("_raw_text"):
            try:
                from app.services import ai_pdf_extraction
                new_balance = ai_pdf_extraction.extract_total_amount_due_ai(
                    ai_context["db"], ai_context["user_id"], parse_result["_raw_text"]
                )
            except Exception:
                new_balance = None

    if new_balance is None:
        new_balance = parse_result.get("ending_balance")
    if new_balance is None:
        transactions = parse_result.get("transactions", [])
        balances = [t.get("balance") for t in transactions if t.get("balance") is not None]
        new_balance = balances[-1] if balances else None
    if new_balance is None:
        return False

    stmt_end = _stmt_end(parse_result, fallback_date)
    # Don't let an older statement clobber a newer stored balance.
    prev_at = getattr(bank, "balance_updated_at", None)
    if prev_at and stmt_end and stmt_end < prev_at:
        return False

    bank.current_balance = new_balance
    bank.balance_updated_at = stmt_end
    return True


def recompute_bank_balance(db, bank) -> bool:
    """Authoritatively recompute a bank's balance from its stored transactions.

    Savings/other: the running balance of the most recent transaction that has one
    (the statement's own closing balance — reliable even if statements were uploaded
    out of order). Credit cards keep their Total Amount Due (set on parse); if none is
    stored we leave current_balance as-is so the UI falls back to the computed owed.
    Returns True if the balance changed.
    """
    from app.models.models import Transaction

    is_credit = (getattr(bank, "bank_type", "") or "").lower() == "credit"
    if is_credit:
        return False

    row = (
        db.query(Transaction.balance, Transaction.transaction_date)
        .filter(Transaction.bank_id == bank.id, Transaction.balance.isnot(None))
        .order_by(Transaction.transaction_date.desc(), Transaction.id.desc())
        .first()
    )
    if not row or row[0] is None:
        return False
    new_balance = float(row[0])
    if bank.current_balance == new_balance:
        bank.balance_updated_at = row[1]
        return False
    bank.current_balance = new_balance
    bank.balance_updated_at = row[1]
    return True


def recompute_all_balances(db, user_id: int) -> int:
    """Recompute every bank's balance for a user. Returns how many changed."""
    from app.models.models import Bank

    banks = db.query(Bank).filter(Bank.user_id == user_id).all()
    changed = 0
    for b in banks:
        if recompute_bank_balance(db, b):
            changed += 1
    db.commit()
    return changed
