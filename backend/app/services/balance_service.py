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


def adjust_credit_balance_for_new_transaction(bank, transaction) -> bool:
    """Nudge a credit card's stored balance for a single newly-created transaction
    dated after the account's last known statement, so spending/payments show up
    immediately instead of staying frozen until the next statement PDF arrives.
    A debit (purchase) increases the amount owed; a credit (payment/refund)
    reduces it.

    Only call this for a genuinely NEW transaction (never for the "reconcile an
    existing pending alert" branch of create_or_reconcile_transaction) — the
    pending row already got this adjustment once, when it was first created as an
    alert; applying it again on reconciliation would double-count it. Once the
    next statement's Total Amount Due is applied via apply_statement_balance,
    balance_updated_at moves forward and this transaction naturally stops being
    "post-statement," so there's no ongoing drift to correct for later.
    """
    is_credit = (getattr(bank, "bank_type", "") or "").lower() == "credit"
    if not is_credit or bank.current_balance is None:
        return False
    if not bank.balance_updated_at or not transaction.transaction_date:
        return False
    if transaction.transaction_date <= bank.balance_updated_at:
        return False
    if transaction.amount is None:
        return False

    ttype = transaction.transaction_type
    ttype_value = ttype.value if hasattr(ttype, "value") else str(ttype)
    if ttype_value not in ("debit", "credit"):
        return False

    bank.current_balance += transaction.amount if ttype_value == "debit" else -transaction.amount
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


def get_computed_net_by_bank(db, user_ids) -> dict:
    """All-time credit-minus-debit per bank -- the fallback balance estimate for
    a bank that has never had a statement balance stored (current_balance is
    NULL). Shared by the dashboard summary and the net-worth-trend "current"
    aggregate so a bank in that state reads the same computed number on every
    surface instead of silently summing as zero on some and correctly on
    others (list_banks()'s own computed_balance is a separate, richer query
    that also needs last_transaction_at, so it isn't rebased on this).
    """
    from sqlalchemy import func, case
    from app.models.models import Transaction, TransactionType

    ids = [user_ids] if isinstance(user_ids, int) else list(user_ids)
    rows = (
        db.query(
            Transaction.bank_id,
            func.sum(case((Transaction.transaction_type == TransactionType.CREDIT, Transaction.amount), else_=0)).label("total_credit"),
            func.sum(case((Transaction.transaction_type == TransactionType.DEBIT, Transaction.amount), else_=0)).label("total_debit"),
        )
        .filter(Transaction.user_id.in_(ids))
        .group_by(Transaction.bank_id)
        .all()
    )
    return {row.bank_id: float(row.total_credit or 0) - float(row.total_debit or 0) for row in rows}


def signed_display_balance(bank, computed_net_by_bank: dict) -> float:
    """The balance to DISPLAY for a bank: stored current_balance if present,
    else the computed-net fallback above; a credit card's owed amount always
    renders negative regardless of source (mirrors signedAccountBalance() in
    frontend/src/utils/format.js -- current_balance is stored as a positive
    amount-owed for credit cards, per apply_statement_balance() above, and the
    computed net isn't a reliable sign on its own).
    """
    is_credit = (getattr(bank, "bank_type", "") or "").lower() == "credit"
    raw = bank.current_balance
    if raw is None:
        raw = computed_net_by_bank.get(bank.id)
    if raw is None:
        return 0.0
    return -abs(raw) if is_credit else float(raw)
