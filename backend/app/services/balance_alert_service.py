"""Balance threshold notifications: alerts (via the existing Discord/Apprise
notify path) when an account's current_balance crosses below/above a
user-configured limit -- e.g. "warn me if my checking account drops under
₹5,000" or "let me know if this card's balance exceeds ₹50,000".
"""
import logging

from sqlalchemy.orm import Session

from app.models.models import Bank

logger = logging.getLogger(__name__)


def _state_for(bank: Bank) -> str:
    """Which threshold (if any) the bank's current balance is currently past."""
    bal = bank.current_balance
    if bal is None:
        return ""
    if bank.balance_below_limit_enabled and bank.balance_below_threshold is not None and bal < bank.balance_below_threshold:
        return "below"
    if bank.balance_above_limit_enabled and bank.balance_above_threshold is not None and bal > bank.balance_above_threshold:
        return "above"
    return ""


def check_balance_alerts(db: Session, user_id: int) -> int:
    """Check every one of a user's accounts with a threshold enabled. Notifies
    only on a state TRANSITION (idempotent via last_balance_alert_state) --
    staying past the threshold across repeated checks doesn't re-notify, and
    crossing back to normal silently resets the guard so a future re-breach
    notifies again. Returns the number of alerts sent."""
    from app.services.discord_notifier import discord_notifier

    if not discord_notifier.enabled:
        return 0

    sent = 0
    banks = (
        db.query(Bank)
        .filter(
            Bank.user_id == user_id,
            Bank.is_active == True,  # noqa: E712
            (Bank.balance_below_limit_enabled == True) | (Bank.balance_above_limit_enabled == True),  # noqa: E712
        )
        .all()
    )
    for bank in banks:
        try:
            state = _state_for(bank)
            if state == (bank.last_balance_alert_state or ""):
                continue
            bank.last_balance_alert_state = state or None
            if not state:
                continue  # crossed back to normal -- just reset the guard, no alert
            if state == "below":
                msg = f"**{bank.name}** balance (₹{bank.current_balance:,.0f}) dropped below your ₹{bank.balance_below_threshold:,.0f} limit."
            else:
                msg = f"**{bank.name}** balance (₹{bank.current_balance:,.0f}) went above your ₹{bank.balance_above_threshold:,.0f} limit."
            discord_notifier.send_notification(
                title="⚠️ Balance Alert" if state == "below" else "💰 Balance Alert",
                description=msg,
                color=0xE15759 if state == "below" else 0x59A14F,
            )
            sent += 1
        except Exception:
            logger.warning("Balance alert check failed for bank %s", bank.id, exc_info=True)
    if sent or banks:
        db.commit()
    return sent
