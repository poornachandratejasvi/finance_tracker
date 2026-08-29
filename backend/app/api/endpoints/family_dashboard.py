"""Admin-only combined view across every member of the admin's household.

Ordinary members are scoped to strictly their own banks/transactions
(app.core.household.visible_user_ids) -- an invited family member or friend
never sees anyone else's data. This is the one deliberate exception: an admin
can see everyone they've invited into their household combined, so they have
one place to check on the whole family's accounts.
"""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.api.endpoints.auth import get_current_admin_user
from app.core.household import household_user_ids
from app.models.models import User, Bank

router = APIRouter()


@router.get("/")
def get_family_dashboard(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin_user),
):
    """Every household member, their banks/balances, and combined totals."""
    member_ids = household_user_ids(db, current_user)
    members = db.query(User).filter(User.id.in_(member_ids)).all()
    # bank_type='investment' rows exist only to auto-download CAS/PPF statement
    # emails, not to hold a real balance -- excluded from assets/liabilities the
    # same way the main dashboard excludes them.
    banks = db.query(Bank).filter(
        Bank.user_id.in_(member_ids), Bank.is_active == True, Bank.bank_type != "investment"  # noqa: E712
    ).all()

    banks_by_user = {}
    for b in banks:
        banks_by_user.setdefault(b.user_id, []).append(b)

    member_rows = []
    total_assets = 0.0
    total_liabilities = 0.0
    for m in members:
        assets = 0.0
        liabilities = 0.0
        bank_rows = []
        for b in banks_by_user.get(m.id, []):
            bal = b.current_balance or 0.0
            if b.bank_type == "credit":
                liabilities += bal
            else:
                assets += bal
            bank_rows.append({
                "bank_id": b.id,
                "bank_name": b.name,
                "bank_type": b.bank_type,
                "current_balance": round(bal, 2),
                "currency_code": b.currency_code,
                "balance_updated_at": b.balance_updated_at.isoformat() if b.balance_updated_at else None,
            })
        total_assets += assets
        total_liabilities += liabilities
        member_rows.append({
            "user_id": m.id,
            "username": m.username,
            "full_name": m.full_name,
            "role": m.role.value if hasattr(m.role, "value") else m.role,
            "is_you": m.id == current_user.id,
            "banks": bank_rows,
            "assets": round(assets, 2),
            "liabilities": round(liabilities, 2),
            "net": round(assets - liabilities, 2),
        })

    member_rows.sort(key=lambda r: (not r["is_you"], r["username"]))

    return {
        "members": member_rows,
        "totals": {
            "total_assets": round(total_assets, 2),
            "total_liabilities": round(total_liabilities, 2),
            "net_worth": round(total_assets - total_liabilities, 2),
        },
    }
