"""Celery task: remind about upcoming credit-card bill due dates -- 5 days'
lead time, enough to still act on before the deadline without nagging daily.
Tries an auto-match first (credit_card_bill_service.run_auto_match) so a bill
that's already been paid never generates a "did you pay this?" reminder.
"""
import logging
from datetime import timedelta

from app.core.celery_app import celery_app

logger = logging.getLogger(__name__)

_LEAD_DAYS = 5
# Keep nagging a couple of days past the due date if it's STILL unmatched --
# after that, check_upcoming_bills widens past the reminder window on its own
# (this cap only stops the reminder loop from running forever on a bill the
# user marked paid-without-a-transaction and moved on from).
_OVERDUE_GRACE_DAYS = 2


@celery_app.task(name="credit_card_bills.check_reminders")
def check_bill_reminders():
    """For every unpaid bill due within _LEAD_DAYS (or up to _OVERDUE_GRACE_DAYS
    past due), notify via Discord + mobile push once per due date."""
    from app.core.database import SessionLocal
    from app.core.time_utils import utcnow
    from app.models.models import CreditCardBill, Bank
    from app.services.credit_card_bill_service import run_auto_match
    from app.services.discord_service import send_discord_message
    from app.services.expo_push_service import send_push_to_user

    db = SessionLocal()
    sent = 0
    try:
        now = utcnow()
        horizon = now + timedelta(days=_LEAD_DAYS)
        overdue_cutoff = now - timedelta(days=_OVERDUE_GRACE_DAYS)
        bills = (
            db.query(CreditCardBill)
            .filter(
                CreditCardBill.due_date.isnot(None),
                CreditCardBill.due_date <= horizon,
                CreditCardBill.due_date >= overdue_cutoff,
            )
            .all()
        )
        for bill in bills:
            try:
                if run_auto_match(db, bill):
                    continue  # already paid, or just auto-matched -- nothing to remind about
                if bill.last_reminder_sent_for == bill.due_date:
                    continue  # already reminded for this exact due date

                bank = db.query(Bank).filter(Bank.id == bill.bank_id).first()
                bank_name = bank.name if bank else "Credit card"
                amount_str = f"₹{bill.total_amount_due:,.0f}" if bill.total_amount_due else "your bill"
                days_left = (bill.due_date - now).days
                due_str = "overdue" if days_left < 0 else "due today" if days_left == 0 else f"due in {days_left}d"

                title = f"💳 {bank_name} bill {due_str}"
                body = f"{amount_str} due {bill.due_date.strftime('%d %b')} -- check if you've paid it."

                try:
                    send_discord_message(db, bill.user_id, title, body)
                except Exception:
                    logger.warning("Discord bill reminder failed for bill %s", bill.id, exc_info=True)
                try:
                    send_push_to_user(db, bill.user_id, title, body, data={"type": "credit_card_bill", "bill_id": bill.id})
                except Exception:
                    logger.warning("Push bill reminder failed for bill %s", bill.id, exc_info=True)

                bill.last_reminder_sent_for = bill.due_date
                db.commit()
                sent += 1
            except Exception:
                logger.warning("Bill reminder failed for bill %s", bill.id, exc_info=True)
                db.rollback()
    finally:
        db.close()

    if sent:
        logger.info("Credit card bill reminders: %d sent", sent)
    return {"sent": sent}
