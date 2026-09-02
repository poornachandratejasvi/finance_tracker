"""Detects whether a credit-card bill (CreditCardBill, see models.py) has
actually been paid, by fuzzy-matching against the user's transaction history --
same amount+date-window approach as transaction_hooks.find_confirmed_match, but
NOT scoped to a single bank_id: a card's payment is normally a DEBIT from a
different account (savings/checking), not a transaction on the card's own
ledger. Also allows a CREDIT on the card's own account, for the rarer case
where a "payment received" alert is itself tracked as a transaction.

Auto-confirms only when exactly one candidate exists in the window (unambiguous);
otherwise the bill stays 'unpaid' and candidates are surfaced via the API for the
user to manually map ("this is the payment") -- never guesses among several.
"""
import logging
from datetime import timedelta
from typing import List, Optional

from sqlalchemy import and_, or_

logger = logging.getLogger(__name__)

# Payment is typically made anywhere from a couple weeks before the due date
# (as soon as the statement arrives) to a few days after (a slightly late but
# still-intended payment) -- wider than same-bank alert/statement reconciliation
# since this isn't matching the SAME event reported twice, just a plausible
# real-world payment near the deadline.
_WINDOW_BEFORE_DAYS = 20
_WINDOW_AFTER_DAYS = 7
_AMOUNT_TOLERANCE = 1.0


def find_payment_candidates(db, bill) -> List:
    """Transactions that could plausibly be this bill's payment, most recent
    first. Empty list if the bill has no due_date/total_amount_due to match
    against yet (still nothing but a payment-less summary)."""
    from app.models.models import Transaction, TransactionType

    if bill.total_amount_due is None or not bill.due_date:
        return []

    window_start = bill.due_date - timedelta(days=_WINDOW_BEFORE_DAYS)
    window_end = bill.due_date + timedelta(days=_WINDOW_AFTER_DAYS)
    lo, hi = bill.total_amount_due - _AMOUNT_TOLERANCE, bill.total_amount_due + _AMOUNT_TOLERANCE

    return (
        db.query(Transaction)
        .filter(
            Transaction.user_id == bill.user_id,
            Transaction.amount >= lo,
            Transaction.amount <= hi,
            Transaction.transaction_date >= window_start,
            Transaction.transaction_date <= window_end,
            or_(
                and_(Transaction.transaction_type == TransactionType.DEBIT, Transaction.bank_id != bill.bank_id),
                and_(Transaction.transaction_type == TransactionType.CREDIT, Transaction.bank_id == bill.bank_id),
            ),
        )
        .order_by(Transaction.transaction_date.desc())
        .all()
    )


def run_auto_match(db, bill) -> bool:
    """Attempt to auto-resolve one bill. Returns True if it (already was, or
    just got) matched/paid -- callers use this to decide whether a "did you
    pay this?" reminder is still needed. Never overwrites an existing
    manual/auto match."""
    if bill.payment_status in ("paid", "auto_matched"):
        return True

    candidates = find_payment_candidates(db, bill)
    if len(candidates) == 1:
        bill.payment_transaction_id = candidates[0].id
        bill.payment_status = "auto_matched"
        db.commit()
        return True
    return False


def confirm_payment(db, bill, transaction_id: int) -> None:
    """User-confirmed mapping ('map it') -- picking one of the candidates (or
    any transaction id at all) as this bill's payment."""
    bill.payment_transaction_id = transaction_id
    bill.payment_status = "paid"
    db.commit()


def mark_paid_manually(db, bill) -> None:
    """No matching transaction exists to link (e.g. paid via a UPI app that
    isn't synced) -- mark paid without a transaction reference."""
    bill.payment_status = "paid"
    bill.payment_transaction_id = None
    db.commit()
