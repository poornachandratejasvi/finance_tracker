"""Payslip PDF parser -- regex over PDFParser.extract_text's output, NOT the
table extractor (confirmed via a real sample: pdfplumber's table extraction
mangles the deductions column, merging multiple rows' values into one cell,
while the flattened text comes out as one clean row per line: "<Earning
Label> <Amount> <YTD> [<Deduction Label> <Amount> <YTD>]"). Same
never-raises, best-effort shape as every other parser in pdf_parser.py.
"""
import logging
import re
from typing import Optional

logger = logging.getLogger(__name__)

_MONTH_HEADER_RE = re.compile(r"PAYSLIP FOR THE MONTH OF\s+([A-Za-z]+)\s+(\d{4})", re.IGNORECASE)
_EMP_NAME_RE = re.compile(r"Emp Code\s+\S+\s+Emp Name\s+(.+)", re.IGNORECASE)
_REGIME_RE = re.compile(r"Regime Type\s*\n?\s*(New Regime|Old Regime)", re.IGNORECASE)
_NET_PAY_RE = re.compile(r"Net Pay\s*:\s*Rs\.?\s*([\d,]+\.\d{2})", re.IGNORECASE)

# One table row: a label followed by two amounts, optionally followed by a
# second label + two amounts (earnings side / deductions side on the same
# visual row). Both sides are optional so a short row (earnings ran out of
# deduction rows to pair with) still matches on the first triple alone.
_ROW_RE = re.compile(
    r"^(?P<label1>.+?)\s+(?P<amt1>[\d,]+\.\d{2})\s+(?P<ytd1>[\d,]+\.\d{2})"
    r"(?:\s+(?P<label2>[A-Za-z][^\d]*?)\s+(?P<amt2>[\d,]+\.\d{2})\s+(?P<ytd2>[\d,]+\.\d{2}))?\s*$"
)

_MONTHS = {
    "january": 1, "february": 2, "march": 3, "april": 4, "may": 5, "june": 6,
    "july": 7, "august": 8, "september": 9, "october": 10, "november": 11, "december": 12,
}


def _to_float(s: str) -> float:
    return float(s.replace(",", ""))


def parse_payslip(text: str) -> Optional[dict]:
    """Returns a dict with the fields Payslip needs, or None if this doesn't
    look like a recognizable payslip (missing the two core anchors)."""
    if not text:
        return None

    month_m = _MONTH_HEADER_RE.search(text)
    net_pay_m = _NET_PAY_RE.search(text)
    if not month_m or not net_pay_m:
        return None

    month_name, year = month_m.group(1).lower(), month_m.group(2)
    month_num = _MONTHS.get(month_name)
    if not month_num:
        return None
    month = f"{year}-{month_num:02d}"

    emp_m = _EMP_NAME_RE.search(text)
    employee_name = emp_m.group(1).strip() if emp_m else None
    regime_m = _REGIME_RE.search(text)
    regime_type = regime_m.group(1) if regime_m else None
    net_pay = _to_float(net_pay_m.group(1))

    basic = hra_received = provident_fund = income_tax_deducted = None
    total_earnings = total_deductions = None
    other_earnings_total = 0.0
    other_deductions_total = 0.0

    for line in text.splitlines():
        line = line.strip()
        if not line or line.lower().startswith("earnings") and "deductions" in line.lower():
            continue  # header row: "Earnings Amount YTD Deductions Amount YTD"
        m = _ROW_RE.match(line)
        if not m:
            continue

        label1 = m.group("label1").strip()
        amt1 = _to_float(m.group("amt1"))
        if label1.lower() == "total earnings":
            total_earnings = amt1
        elif label1.lower() == "basic":
            basic = amt1
        elif label1.lower() == "house rent allowance":
            hra_received = amt1
        elif label1:
            other_earnings_total += amt1

        if m.group("label2"):
            label2 = m.group("label2").strip()
            amt2 = _to_float(m.group("amt2"))
            if label2.lower() == "total deductions":
                total_deductions = amt2
            elif label2.lower() == "provident fund":
                provident_fund = amt2
            elif label2.lower() == "income tax":
                income_tax_deducted = amt2
            elif label2:
                other_deductions_total += amt2

    return {
        "month": month,
        "employee_name": employee_name,
        "regime_type": regime_type,
        "basic": basic,
        "hra_received": hra_received,
        "provident_fund": provident_fund,
        "income_tax_deducted": income_tax_deducted,
        "other_earnings_total": round(other_earnings_total, 2) if other_earnings_total else 0.0,
        "other_deductions_total": round(other_deductions_total, 2) if other_deductions_total else 0.0,
        "total_earnings": total_earnings,
        "total_deductions": total_deductions,
        "net_pay": net_pay,
    }
