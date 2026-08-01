"""Household-scoped visibility helper.

A household is a shared-wallet visibility group (see models.Household) — members
see each other's banks/transactions, while personal settings (Gmail/Drive OAuth,
AI keys, Discord webhook, API tokens) stay per-user regardless of membership.
"""
from typing import List

from sqlalchemy.orm import Session

from app.models.models import User


def household_user_ids(db: Session, user: User) -> List[int]:
    """Return every user id that shares `user`'s household (including their own),
    or just `[user.id]` if they aren't in one (shouldn't normally happen — every
    user gets a private household on creation — but degrade safely if so)."""
    if not user.household_id:
        return [user.id]
    ids = [
        uid for (uid,) in
        db.query(User.id).filter(User.household_id == user.household_id).all()
    ]
    return ids or [user.id]


def ensure_household(db: Session, user: User) -> None:
    """Give a just-created user their own private household, if they don't
    already have one. Call this right after every User row is committed
    (register, Google sign-in find-or-create, OAuth account creation, admin
    create-user) — mirrors the existing seed_user_defaults() try/except pattern
    at each of those call sites."""
    if user.household_id:
        return
    from app.models.models import Household
    household = Household(name=f"{user.username}'s Household")
    db.add(household)
    db.commit()
    db.refresh(household)
    user.household_id = household.id
    db.commit()
