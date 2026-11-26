"""Load SMS samples, run the extractor, and remember new shapes."""

from __future__ import annotations

from sqlalchemy.orm import Session

from app.models.models import SmsSample, User
from app.services.sms_patterns import (
    apply_ai,
    decide,
    generic_skeleton,
    skeleton_for_sample,
)


def _sample_dict(row: SmsSample) -> dict:
    return {
        "skeleton": row.skeleton,
        "is_transaction": row.is_transaction,
        "transaction_type": row.transaction_type,
        "description": row.description,
        "bank_id": row.bank_id,
        "source": row.source or "manual",
    }


def _existing_skeleton(db: Session, user_id: int, skeleton: str, is_transaction):
    query = db.query(SmsSample).filter(SmsSample.user_id == user_id, SmsSample.skeleton == skeleton)
    if is_transaction is None:
        query = query.filter(SmsSample.is_transaction.is_(None))
    else:
        query = query.filter(SmsSample.is_transaction.is_(is_transaction))
    return query.first()


def remember(db: Session, user_id: int, text: str, sender: str, decision: dict, source: str) -> None:
    """Store a shape the extractor should reuse. Skips a skeleton already saved."""
    is_transaction = decision.get("action") == "transaction"
    if is_transaction:
        skeleton = skeleton_for_sample(
            text,
            amount=decision.get("amount"),
            balance=decision.get("balance"),
            is_transaction=True,
        )
    else:
        skeleton = generic_skeleton(text)
    if not skeleton:
        if source != "ai":
            return
        if db.query(SmsSample).filter(SmsSample.user_id == user_id, SmsSample.raw_text == (text or "")[:4000]).first():
            return
    elif _existing_skeleton(db, user_id, skeleton, True if is_transaction else None):
        return
    db.add(SmsSample(
        user_id=user_id,
        raw_text=(text or "")[:4000],
        sender=(sender or None),
        is_transaction=True if is_transaction else None,
        amount=decision.get("amount"),
        transaction_type=decision.get("transaction_type"),
        description=(decision.get("description") or None),
        bank_id=decision.get("bank_id"),
        balance_amount=decision.get("balance"),
        skeleton=skeleton,
        source=source,
    ))
    db.commit()


def interpret(db: Session, user: User, text: str, sender: str = None, use_ai: bool = True, remember_result: bool = False) -> dict:
    rows = (
        db.query(SmsSample)
        .filter(SmsSample.user_id == user.id, SmsSample.skeleton.isnot(None))
        .order_by(SmsSample.id.desc())
        .all()
    )
    decision = decide(text or "", [_sample_dict(row) for row in rows])
    if decision.get("action") == "need_ai" and use_ai:
        from app.services.ai_sms_extraction import extract_sms_transaction
        decision = apply_ai(decision, extract_sms_transaction(db, user.id, text or ""))
    if remember_result and decision.get("learn"):
        remember(db, user.id, text, sender, decision, source="ai")
    elif remember_result and decision.get("action") == "unmatched":
        remember(db, user.id, text, sender, decision, source="unmatched")
    return decision


def save_labeled_sample(db: Session, user: User, payload: dict, sample_id: int = None) -> SmsSample:
    text = (payload.get("raw_text") or "").strip()
    if not text:
        raise ValueError("Paste the SMS text first.")
    is_transaction = bool(payload.get("is_transaction"))
    amount = payload.get("amount")
    balance = payload.get("balance_amount")
    skeleton = skeleton_for_sample(
        text,
        amount=amount,
        balance=balance,
        is_transaction=is_transaction,
    )
    if is_transaction and payload.get("transaction_type") not in ("credit", "debit"):
        raise ValueError("Choose debit or credit.")
    if is_transaction and amount is None:
        raise ValueError("Enter the transaction amount.")
    if is_transaction and skeleton is None:
        raise ValueError("That amount does not appear in the SMS, so it cannot teach the next one.")
    row = None
    if sample_id is not None:
        row = db.query(SmsSample).filter(SmsSample.id == sample_id, SmsSample.user_id == user.id).first()
        if row is None:
            raise ValueError("Sample not found.")
    if row is None:
        row = SmsSample(user_id=user.id)
        db.add(row)
    row.raw_text = text[:4000]
    row.sender = (payload.get("sender") or None)
    row.is_transaction = is_transaction
    row.amount = float(amount) if is_transaction and amount is not None else None
    row.transaction_type = payload.get("transaction_type") if is_transaction else None
    row.description = (payload.get("description") or None)
    row.bank_id = payload.get("bank_id") or None
    row.balance_amount = float(balance) if balance not in (None, "") else None
    row.skeleton = skeleton
    row.source = "manual"
    db.commit()
    db.refresh(row)
    return row
