"""Tax-saving dashboard -- 80C / 80D / 80CCD(1B) utilization, computed purely
from data already tracked elsewhere (InsurancePolicy premiums, InvestmentEntry
contributions, Payslip provident fund) plus an HRA exemption estimate from
uploaded payslips. Indian financial year: April 1 - March 31.

Each contributing source is reported as its OWN breakdown line, never
silently merged -- e.g. Provident Fund from a payslip and an 'epf'-category
InvestmentAccount both count toward 80C, and a user tracking both would
double count unless they can see and turn one off.
"""
from datetime import datetime
from typing import Optional

LIMIT_80C = 150000.0
LIMIT_80D_REGULAR = 25000.0
LIMIT_80D_SENIOR = 50000.0
LIMIT_80CCD_1B = 50000.0

_PREMIUM_MULTIPLIER = {"monthly": 12, "quarterly": 4, "yearly": 1}


def fy_range(financial_year: str):
    """'2026-27' -> (2026-04-01, 2027-04-01) [end exclusive]."""
    start_year = int(financial_year.split("-")[0])
    return datetime(start_year, 4, 1), datetime(start_year + 1, 4, 1)


def current_financial_year(now=None) -> str:
    from app.core.time_utils import utcnow

    now = now or utcnow()
    start_year = now.year if now.month >= 4 else now.year - 1
    return f"{start_year}-{str(start_year + 1)[2:]}"


def _fy_months(financial_year: str) -> set:
    start_year = int(financial_year.split("-")[0])
    months = [f"{start_year}-{m:02d}" for m in range(4, 13)]
    months += [f"{start_year + 1}-{m:02d}" for m in range(1, 4)]
    return set(months)


def _annualize_premium(policy) -> float:
    mult = _PREMIUM_MULTIPLIER.get(policy.premium_frequency, 1)
    return (policy.premium_amount or 0.0) * mult


def _entries_total_in_fy(db, account_ids, start, end) -> float:
    from app.models.models import InvestmentEntry

    if not account_ids:
        return 0.0
    entries = (
        db.query(InvestmentEntry)
        .filter(InvestmentEntry.investment_account_id.in_(account_ids), InvestmentEntry.entry_type.in_(["buy", "contribution"]))
        .all()
    )
    total = 0.0
    for e in entries:
        d = e.entry_date or e.created_at
        if d and start <= d < end:
            total += e.amount or 0.0
    return total


def _section(limit: float, breakdown: list) -> dict:
    utilized = round(sum(b["amount"] for b in breakdown), 2)
    return {
        "limit": limit,
        "utilized": utilized,
        "remaining": round(max(0.0, limit - utilized), 2),
        "breakdown": breakdown,
    }


def dashboard(db, user_id: int, financial_year: Optional[str] = None, senior_citizen: bool = False) -> dict:
    from sqlalchemy import or_
    from app.models.models import InsurancePolicy, InvestmentAccount, Payslip

    financial_year = financial_year or current_financial_year()
    start, end = fy_range(financial_year)
    fy_months = _fy_months(financial_year)

    # ---- 80C ----
    breakdown_80c = []
    life_policies = (
        db.query(InsurancePolicy)
        .filter(InsurancePolicy.user_id == user_id, InsurancePolicy.policy_type == "life", InsurancePolicy.is_active.is_(True))
        .all()
    )
    life_total = sum(_annualize_premium(p) for p in life_policies)
    if life_total:
        breakdown_80c.append({"label": "Life insurance premiums", "amount": round(life_total, 2)})

    accounts_80c = (
        db.query(InvestmentAccount)
        .filter(InvestmentAccount.user_id == user_id, or_(InvestmentAccount.category.in_(["ppf", "epf"]), InvestmentAccount.tax_section == "80c"))
        .all()
    )
    invest_80c_total = _entries_total_in_fy(db, [a.id for a in accounts_80c], start, end)
    if invest_80c_total:
        breakdown_80c.append({"label": "PPF / EPF / ELSS contributions", "amount": round(invest_80c_total, 2)})

    payslips = db.query(Payslip).filter(Payslip.user_id == user_id, Payslip.month.in_(fy_months)).all()
    payslip_pf_total = sum(p.provident_fund or 0.0 for p in payslips)
    if payslip_pf_total:
        breakdown_80c.append({"label": "Provident Fund (from uploaded payslips)", "amount": round(payslip_pf_total, 2)})

    # ---- 80D ----
    breakdown_80d = []
    health_policies = (
        db.query(InsurancePolicy)
        .filter(InsurancePolicy.user_id == user_id, InsurancePolicy.policy_type == "health", InsurancePolicy.is_active.is_(True))
        .all()
    )
    for p in health_policies:
        amt = _annualize_premium(p)
        if amt:
            breakdown_80d.append({"label": f"Health insurance — {p.provider or 'policy'}", "amount": round(amt, 2)})

    # ---- 80CCD(1B) ----
    accounts_ccd = (
        db.query(InvestmentAccount)
        .filter(InvestmentAccount.user_id == user_id, or_(InvestmentAccount.category == "nps", InvestmentAccount.tax_section == "80ccd_1b"))
        .all()
    )
    invest_ccd_total = _entries_total_in_fy(db, [a.id for a in accounts_ccd], start, end)
    breakdown_ccd = []
    if invest_ccd_total:
        breakdown_ccd.append({"label": "NPS contributions", "amount": round(invest_ccd_total, 2)})

    result = {
        "financial_year": financial_year,
        "sections": {
            "80c": _section(LIMIT_80C, breakdown_80c),
            "80d": _section(LIMIT_80D_SENIOR if senior_citizen else LIMIT_80D_REGULAR, breakdown_80d),
            "80ccd_1b": _section(LIMIT_80CCD_1B, breakdown_ccd),
        },
        "hra_exemption": _hra_exemption(db, user_id, payslips),
    }
    return result


def _hra_exemption(db, user_id: int, payslips: list) -> Optional[dict]:
    """min(HRA received, rent paid - 10% of basic, 50%/40% of basic for
    metro/non-metro) -- annualized from whatever payslip months are on file
    for this FY, since rent/city aren't printed on a payslip and stay a small
    manual input (see users.py's prefs convention)."""
    if not payslips:
        return None

    from app.api.endpoints.users import _prefs_key, DEFAULT_PREFS
    from app.models.models import AppSetting
    import json

    row = db.query(AppSetting).filter(AppSetting.key == _prefs_key(user_id)).first()
    prefs = dict(DEFAULT_PREFS)
    if row and row.value:
        try:
            prefs.update(json.loads(row.value))
        except (ValueError, TypeError):
            pass
    monthly_rent = float(prefs.get("monthly_rent") or 0)
    city_metro = bool(prefs.get("city_metro"))

    if not monthly_rent:
        return {"configured": False, "monthly_rent": 0, "city_metro": city_metro, "exemption": 0.0}

    sum_basic = sum(p.basic or 0.0 for p in payslips)
    sum_hra = sum(p.hra_received or 0.0 for p in payslips)
    months_on_file = len(payslips)
    rent_paid = monthly_rent * months_on_file

    exemption = min(
        sum_hra,
        max(0.0, rent_paid - 0.10 * sum_basic),
        (0.50 if city_metro else 0.40) * sum_basic,
    )
    return {
        "configured": True,
        "monthly_rent": monthly_rent,
        "city_metro": city_metro,
        "months_on_file": months_on_file,
        "basic_total": round(sum_basic, 2),
        "hra_received_total": round(sum_hra, 2),
        "rent_paid_total": round(rent_paid, 2),
        "exemption": round(exemption, 2),
    }
