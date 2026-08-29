"""Computes the value for a user-defined 'custom formula' dashboard widget --
pick one or more accounts and an operation (sum/difference/average/percentage),
get a single derived number back. No new aggregation table: it reads straight
off Bank.current_balance, the same field every other balance display in the
app already uses."""
from typing import Optional

from sqlalchemy.orm import Session

from app.models.models import Bank, User

OPERATIONS = ("sum", "difference", "average", "percentage")


def compute_custom_formula(db: Session, user: User, config: dict) -> dict:
    bank_ids = [int(x) for x in (config.get("bank_ids") or []) if str(x).strip()]
    operation = config.get("operation") or "sum"
    if operation not in OPERATIONS:
        operation = "sum"

    banks = (
        db.query(Bank)
        .filter(Bank.id.in_(bank_ids), Bank.user_id == user.id)
        .all()
    )
    by_id = {b.id: b for b in banks}
    # Preserve the order the user picked them in -- matters for difference/percentage,
    # where operand order changes the result (A - B != B - A).
    ordered = [by_id[i] for i in bank_ids if i in by_id]
    values = [b.current_balance or 0.0 for b in ordered]

    currencies = {b.currency_code or "INR" for b in ordered}
    currency_code = next(iter(currencies)) if len(currencies) == 1 else None

    result: Optional[float]
    if not values:
        result = None
    elif operation == "difference":
        result = values[0] - sum(values[1:]) if len(values) >= 2 else values[0]
    elif operation == "average":
        result = sum(values) / len(values)
    elif operation == "percentage":
        result = (values[0] / values[1] * 100) if len(values) >= 2 and values[1] else None
    else:  # "sum"
        result = sum(values)

    return {
        "result": result,
        "operation": operation,
        "currency_code": currency_code,
        "breakdown": [
            {
                "bank_id": b.id,
                "bank_name": b.name,
                "balance": b.current_balance or 0.0,
                "currency_code": b.currency_code or "INR",
            }
            for b in ordered
        ],
    }
