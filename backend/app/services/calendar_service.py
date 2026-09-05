"""Merges tracked Package delivery dates and Subscription due-dates into one
sorted list -- the single source of truth for both the Calendar page's
GET /api/calendar endpoint and the daily due-date reminder task, so there's no
duplicated aggregation/expansion logic between the two.
"""
from datetime import timedelta
from typing import List, Optional


def add_calendar_months(dt, n: int):
    """Step forward n calendar months, clamping the day to the target month's
    length (so a 31st-of-the-month date doesn't drift earlier every cycle
    through a 30-day month) -- shared by expand_occurrences below and the
    credit-card due-date projection in get_upcoming_items."""
    month = dt.month - 1 + n
    year = dt.year + month // 12
    month = month % 12 + 1
    day = min(dt.day, [31, 29 if year % 4 == 0 and (year % 100 != 0 or year % 400 == 0) else 28,
                       31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1])
    return dt.replace(year=year, month=month, day=day)


def expand_occurrences(due_date, recurrence: str, window_start, window_end) -> List:
    """Return every occurrence of a (possibly recurring) due_date that falls
    within [window_start, window_end]. recurrence='none' returns [due_date] if
    it's in the window (even if in the past -- an overdue one-off should still
    surface), otherwise []. weekly/monthly/yearly step forward from due_date by
    the period until the occurrence is >= window_start, then keep collecting
    while <= window_end."""
    if due_date is None:
        return []

    if recurrence == "none" or not recurrence:
        return [due_date] if window_start <= due_date <= window_end else []

    def _step(dt, n=1):
        if recurrence == "weekly":
            return dt + timedelta(days=7 * n)
        if recurrence == "monthly":
            return add_calendar_months(dt, n)
        if recurrence == "yearly":
            try:
                return dt.replace(year=dt.year + n)
            except ValueError:
                # Feb 29 due date landing on a non-leap year.
                return dt.replace(year=dt.year + n, day=28)
        return dt

    occurrences = []
    n = 0
    occ = due_date
    # Fast-forward past occurrences before the window without emitting them.
    while occ < window_start:
        n += 1
        occ = _step(due_date, n)
        if n > 10000:  # pathological safety valve, not a real limit in practice
            return occurrences
    while occ <= window_end:
        occurrences.append(occ)
        n += 1
        occ = _step(due_date, n)
    return occurrences


def get_upcoming_items(db, user_id: int, days_ahead: int = 60, days_back: int = 60) -> List[dict]:
    """Merge Package delivery dates + expanded Subscription occurrences +
    credit-card statement/due dates (real AND, for cycles not yet parsed from
    a statement, projected one month past the last known due date) into one
    sorted-by-date list covering [now - days_back, now + days_ahead]:
    [{type, id, date, title, subtitle, amount, link, is_overdue}, ...].

    days_back exists so the Calendar page's month view shows real history when
    browsing to a past month, not just "still actionable" items -- a delivered
    package or an already-paid bill still shows (marked as such) within this
    window, it just doesn't get the "is_overdue"/nagging treatment a live one
    does.
    """
    from sqlalchemy import and_, or_
    from app.models.models import Package, Subscription, CreditCardBill, Bank
    from app.core.time_utils import utcnow

    now = utcnow()
    horizon = now + timedelta(days=days_ahead)
    window_start = now - timedelta(days=days_back)
    items = []

    packages = (
        db.query(Package)
        .filter(
            Package.user_id == user_id,
            Package.expected_delivery_date.isnot(None),
            Package.expected_delivery_date <= horizon,
            # A delivered package still shows within the back-window (real
            # history), just without ever counting as overdue; a NON-delivered
            # one shows regardless of how far in the past its estimate was
            # (still genuinely unresolved, like an overdue bill).
            or_(Package.status != "delivered", Package.expected_delivery_date >= window_start),
        )
        .all()
    )
    for p in packages:
        delivered = p.status == "delivered"
        items.append({
            "type": "package", "id": p.id, "date": p.expected_delivery_date,
            "title": p.item_description or p.merchant or p.carrier.replace("_", " ").title(),
            "subtitle": f"{p.carrier.replace('_', ' ').title()} · {p.status.replace('_', ' ')}",
            "amount": None, "link": p.tracking_url,
            "is_overdue": (not delivered) and p.expected_delivery_date < now,
        })

    subscriptions = db.query(Subscription).filter(Subscription.user_id == user_id, Subscription.is_active.is_(True)).all()
    for s in subscriptions:
        for occ_date in expand_occurrences(s.due_date, s.recurrence, window_start, horizon):
            items.append({
                "type": "subscription", "id": s.id, "date": occ_date,
                "title": s.name, "subtitle": s.item_type,
                "amount": s.amount, "link": None,
                "is_overdue": occ_date < now,
            })

    credit_bills = (
        db.query(CreditCardBill, Bank.name)
        .join(Bank, CreditCardBill.bank_id == Bank.id)
        .filter(
            CreditCardBill.user_id == user_id,
            or_(
                and_(CreditCardBill.statement_date.isnot(None), CreditCardBill.statement_date >= window_start, CreditCardBill.statement_date <= horizon),
                # A still-unpaid due date has no lower bound -- like a
                # non-delivered Package, it's genuinely overdue regardless of
                # how long ago the window would otherwise cut it off. A
                # paid/auto-matched one is real history and uses the normal
                # back-window like everything else.
                and_(CreditCardBill.due_date.isnot(None), CreditCardBill.due_date <= horizon,
                     or_(CreditCardBill.payment_status == "unpaid", CreditCardBill.due_date >= window_start)),
            ),
        )
        .all()
    )
    latest_due_by_bank = {}
    for bill, bank_name in credit_bills:
        if bill.statement_date and window_start <= bill.statement_date <= horizon:
            items.append({
                "type": "credit_card_statement", "id": bill.id, "date": bill.statement_date,
                "title": f"{bank_name} statement", "subtitle": "Statement generated",
                "amount": bill.total_amount_due, "link": None,
                "is_overdue": False,
            })
        due_in_range = bill.due_date and (bill.due_date <= horizon) and (bill.payment_status == "unpaid" or bill.due_date >= window_start)
        if due_in_range:
            is_paid = bill.payment_status in ("paid", "auto_matched")
            items.append({
                "type": "credit_card_due", "id": bill.id, "date": bill.due_date,
                "title": f"{bank_name} bill due",
                "subtitle": "Paid" if is_paid else "Payment due",
                "amount": bill.total_amount_due, "link": None,
                "is_overdue": bill.due_date < now and not is_paid,
                "payment_status": bill.payment_status,
            })
        if bill.due_date:
            prev = latest_due_by_bank.get(bill.bank_id)
            if not prev or bill.due_date > prev[0].due_date:
                latest_due_by_bank[bill.bank_id] = (bill, bank_name)

    # Project future cycles that haven't had a real statement parsed yet --
    # without this, a card's calendar entries just stop dead after its last
    # known due date until the next statement email/redetect happens to run,
    # which can be weeks; credit-card billing is reliably monthly, so stepping
    # forward from the last known due date is a safe estimate. Only emitted
    # while no REAL bill exists at/after that projected date yet (a real
    # parsed statement always supersedes a guess).
    for bank_id, (latest_bill, bank_name) in latest_due_by_bank.items():
        projected = add_calendar_months(latest_bill.due_date, 1)
        n = 1
        while projected <= horizon:
            has_real = any(
                b.due_date and b.bank_id == bank_id and b.due_date.date() == projected.date()
                for b, _ in credit_bills
            )
            if not has_real and projected >= window_start:
                items.append({
                    "type": "credit_card_due", "id": None, "date": projected,
                    "title": f"{bank_name} bill due (estimated)",
                    "subtitle": "Estimated -- statement not received yet",
                    "amount": latest_bill.total_amount_due, "link": None,
                    "is_overdue": False, "payment_status": "projected",
                })
            n += 1
            projected = add_calendar_months(latest_bill.due_date, n)

    from app.models.models import Vehicle, VehicleInsurancePolicy, VehiclePucCertificate

    # Only ever the CURRENT (latest-by-expiry) policy/PUC per vehicle -- a
    # renewed-every-year record otherwise means N years of history all
    # separately (and permanently, since an expired-but-superseded one is
    # still "in the past") cluttering the calendar forever.
    def _latest_per_vehicle(rows):
        latest = {}
        for row, vehicle in rows:
            prev = latest.get(row.vehicle_id)
            if not prev or row.expiry_date > prev[0].expiry_date:
                latest[row.vehicle_id] = (row, vehicle)
        return latest.values()

    insurance_rows = (
        db.query(VehicleInsurancePolicy, Vehicle)
        .join(Vehicle, VehicleInsurancePolicy.vehicle_id == Vehicle.id)
        .filter(VehicleInsurancePolicy.user_id == user_id, VehicleInsurancePolicy.expiry_date.isnot(None))
        .all()
    )
    for policy, vehicle in _latest_per_vehicle(insurance_rows):
        if policy.expiry_date <= horizon and (policy.expiry_date >= window_start or policy.expiry_date < now):
            label = vehicle.nickname or vehicle.registration_number
            items.append({
                "type": "vehicle_insurance", "id": policy.id, "date": policy.expiry_date,
                "title": f"{label} insurance expiry", "subtitle": policy.provider or "Insurance",
                "amount": policy.premium_amount, "link": None,
                "is_overdue": policy.expiry_date < now,
            })

    puc_rows = (
        db.query(VehiclePucCertificate, Vehicle)
        .join(Vehicle, VehiclePucCertificate.vehicle_id == Vehicle.id)
        .filter(VehiclePucCertificate.user_id == user_id, VehiclePucCertificate.expiry_date.isnot(None))
        .all()
    )
    for puc, vehicle in _latest_per_vehicle(puc_rows):
        if puc.expiry_date <= horizon and (puc.expiry_date >= window_start or puc.expiry_date < now):
            label = vehicle.nickname or vehicle.registration_number
            items.append({
                "type": "vehicle_puc", "id": puc.id, "date": puc.expiry_date,
                "title": f"{label} PUC expiry", "subtitle": "Pollution certificate",
                "amount": None, "link": None,
                "is_overdue": puc.expiry_date < now,
            })

    from app.models.models import AutopayMandate, InsurancePolicy, Warranty, Iou, CreditCardFee

    mandates = (
        db.query(AutopayMandate)
        .filter(AutopayMandate.user_id == user_id, AutopayMandate.status == "active", AutopayMandate.next_debit_date.isnot(None))
        .all()
    )
    for m in mandates:
        # expand_occurrences only understands none/weekly/monthly/yearly --
        # frequency='other' is a single one-off reminder, not a recurrence to
        # step through (passing it straight through would either silently
        # drop it or, worse, loop forever re-appending the same date, since
        # its internal _step() has no case for an unrecognized recurrence).
        occurrences = (
            expand_occurrences(m.next_debit_date, m.frequency, window_start, horizon)
            if m.frequency in ("weekly", "monthly", "yearly")
            else ([m.next_debit_date] if window_start <= m.next_debit_date <= horizon else [])
        )
        for occ_date in occurrences:
            items.append({
                "type": "autopay_mandate", "id": m.id, "date": occ_date,
                "title": f"{m.merchant_name} autopay", "subtitle": "UPI/bank autopay mandate",
                "amount": m.max_amount, "link": None,
                "is_overdue": occ_date < now,
            })

    policies = db.query(InsurancePolicy).filter(
        InsurancePolicy.user_id == user_id, InsurancePolicy.is_active.is_(True), InsurancePolicy.expiry_date.isnot(None),
    ).all()
    for p in policies:
        if p.expiry_date <= horizon and (p.expiry_date >= window_start or p.expiry_date < now):
            items.append({
                "type": "insurance_expiry", "id": p.id, "date": p.expiry_date,
                "title": f"{(p.provider or p.policy_type.title())} insurance expiry",
                "subtitle": f"{p.policy_type.title()} insurance",
                "amount": p.premium_amount, "link": None,
                "is_overdue": p.expiry_date < now,
            })

    warranties = db.query(Warranty).filter(Warranty.user_id == user_id).all()
    for w in warranties:
        if w.warranty_expiry and w.warranty_expiry <= horizon and (w.warranty_expiry >= window_start or w.warranty_expiry < now):
            items.append({
                "type": "warranty_expiry", "id": w.id, "date": w.warranty_expiry,
                "title": f"{w.item_name} warranty expiry", "subtitle": w.category.title(),
                "amount": None, "link": None,
                "is_overdue": w.warranty_expiry < now,
            })
        if w.amc_expiry and w.amc_expiry <= horizon and (w.amc_expiry >= window_start or w.amc_expiry < now):
            items.append({
                "type": "amc_expiry", "id": w.id, "date": w.amc_expiry,
                "title": f"{w.item_name} AMC expiry", "subtitle": w.amc_provider or "AMC",
                "amount": None, "link": None,
                "is_overdue": w.amc_expiry < now,
            })

    ious = db.query(Iou).filter(Iou.user_id == user_id, Iou.status == "open", Iou.due_date.isnot(None)).all()
    for i in ious:
        if i.due_date <= horizon and (i.due_date >= window_start or i.due_date < now):
            verb = "owes you" if i.direction == "lent" else "you owe"
            items.append({
                "type": "iou_due", "id": i.id, "date": i.due_date,
                "title": f"{i.person_name} {verb}", "subtitle": "IOU due",
                "amount": i.outstanding_amount, "link": None,
                "is_overdue": i.due_date < now,
            })

    fee_rows = (
        db.query(CreditCardFee, Bank)
        .join(Bank, CreditCardFee.bank_id == Bank.id)
        .filter(CreditCardFee.user_id == user_id)
        .all()
    )
    for fee, bank in fee_rows:
        # Project the next annual occurrence -- same 12-month-step technique
        # already used above for un-parsed future credit-card DUE dates, just
        # yearly instead of monthly.
        next_date = fee.fee_anniversary_date
        n = 0
        while next_date < window_start:
            n += 1
            next_date = add_calendar_months(fee.fee_anniversary_date, 12 * n)
        while next_date <= horizon:
            items.append({
                "type": "credit_card_fee", "id": fee.id, "date": next_date,
                "title": f"{bank.name} annual fee", "subtitle": "Credit card annual fee",
                "amount": fee.annual_fee_amount, "link": None,
                "is_overdue": next_date < now,
            })
            n += 1
            next_date = add_calendar_months(fee.fee_anniversary_date, 12 * n)

    from app.models.models import RewardPointEntry

    reward_rows = (
        db.query(RewardPointEntry, Bank)
        .join(Bank, RewardPointEntry.bank_id == Bank.id)
        .filter(
            RewardPointEntry.user_id == user_id, RewardPointEntry.entry_type == "earned",
            RewardPointEntry.expiry_date.isnot(None),
        )
        .all()
    )
    for entry, bank in reward_rows:
        if entry.expiry_date <= horizon and (entry.expiry_date >= window_start or entry.expiry_date < now):
            items.append({
                "type": "reward_points_expiry", "id": entry.id, "date": entry.expiry_date,
                "title": f"{entry.points:,.0f} pts expiring — {bank.name}", "subtitle": "Reward points",
                "amount": None, "link": None,
                "is_overdue": entry.expiry_date < now,
            })

    from app.models.models import PlannedItem, PlannedItemOccurrence
    from app.services.planned_item_service import ensure_occurrences

    planned_items = db.query(PlannedItem).filter(PlannedItem.user_id == user_id, PlannedItem.is_active == True).all()  # noqa: E712
    for planned_item in planned_items:
        ensure_occurrences(db, planned_item)
    db.commit()

    planned_rows = (
        db.query(PlannedItemOccurrence, PlannedItem)
        .join(PlannedItem, PlannedItemOccurrence.planned_item_id == PlannedItem.id)
        .filter(
            PlannedItemOccurrence.user_id == user_id,
            or_(
                and_(PlannedItemOccurrence.due_date >= window_start, PlannedItemOccurrence.due_date <= horizon),
                # An unresolved one has no lower bound -- same "still overdue
                # regardless of how long ago" treatment as an unpaid credit-card bill.
                and_(PlannedItemOccurrence.due_date <= horizon, PlannedItemOccurrence.status == "open"),
            ),
        )
        .all()
    )
    for occurrence, planned_item in planned_rows:
        is_settled = occurrence.status in ("matched", "closed")
        items.append({
            "type": "planned_item_due", "id": occurrence.id, "date": occurrence.due_date,
            "title": planned_item.name,
            "subtitle": "Planned income" if planned_item.direction == "income" else "Planned expense",
            "amount": occurrence.expected_amount, "link": None,
            "is_overdue": occurrence.due_date < now and not is_settled,
            "payment_status": occurrence.status,
            "direction": planned_item.direction,
        })

    items.sort(key=lambda i: i["date"])
    return items
