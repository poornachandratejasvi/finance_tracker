"""Turn bank SMS into a transaction without a per-bank Shortcut rule.

A saved sample remembers the sentence shape (the amount, the balance, dates,
account numbers and SHOUTING merchant names become slots). The next SMS with
that shape reuses the sample's debit/credit answer. When no sample fits, a
structural read handles the common "your account was debited, available
balance is ..." sentence. Anything still unclear is left for the AI fallback
in sms_sample_service, which then saves what it found so the same shape
does not need the model again.
"""

from __future__ import annotations

import re

_MONEY = re.compile(
    r"(?:rs\.?|inr|₹)\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)",
    re.IGNORECASE,
)
_DATE = re.compile(
    r"\b\d{1,2}[-/]\d{1,2}[-/]\d{2,4}\b|\b\d{1,2}\s+[A-Za-z]{3,9}\s+\d{2,4}\b",
)
_ACCT = re.compile(r"\b[xX*]{2,}\d{2,}\b|\b\d{6,}\b")
_NAME = re.compile(r"\b[A-Z][A-Z0-9]{3,}\b")
_DEBIT = re.compile(r"\b(debited|debit|withdrawn|withdrew|spent|paid|deducted|purchase|purchased)\b", re.IGNORECASE)
_CREDIT = re.compile(
    r"\b(credited|credit|received|deposited|refund|refunded|salary|reversal|reversed|cashback)\b",
    re.IGNORECASE,
)
_BALANCE_NEAR = re.compile(
    r"(avl\.?\s*bal|available\s+balance|available\s+limit|a/c\s+bal|account\s+balance)\b",
    re.IGNORECASE,
)


def _bare_amounts(text):
    """Numbers with no Rs/INR marker. Dates are not amounts."""
    spans = []
    dates = list(_DATE.finditer(text or ""))
    for match in re.finditer(r"(?<![\d.])(\d{1,7}(?:,\d{3})*(?:\.\d{1,2})?)(?![\d.])", text or ""):
        if any(date.start() <= match.start() and match.end() <= date.end() for date in dates):
            continue
        try:
            value = float(match.group(1).replace(",", ""))
        except ValueError:
            continue
        if value <= 0:
            continue
        spans.append({"start": match.start(), "end": match.end(), "value": value})
    return spans


def find_amounts(text):
    found = []
    for match in _MONEY.finditer(text or ""):
        try:
            value = float(match.group(1).replace(",", ""))
        except ValueError:
            continue
        if value <= 0:
            continue
        found.append({"start": match.start(), "end": match.end(), "value": value})
    return found


def slot_amounts(text):
    """Currency amounts when the SMS has them, otherwise the remaining numbers."""
    money = find_amounts(text)
    return money if money else _bare_amounts(text)


def _near_balance(text, span):
    window = text[max(0, span["start"] - 40): span["end"] + 24]
    return bool(_BALANCE_NEAR.search(window))


def _post_mask(text):
    text = _DATE.sub("{date}", text)
    text = _ACCT.sub("{acct}", text)
    text = _NAME.sub("{name}", text)
    return re.sub(r"\s+", " ", text).strip().lower()


def _replace_spans(text, replacements):
    for start, end, token in sorted(replacements, key=lambda item: item[0], reverse=True):
        text = text[:start] + token + text[end:]
    return text


def generic_skeleton(text):
    replaced = _replace_spans(
        text or "",
        [(span["start"], span["end"], "{money}") for span in find_amounts(text or "")],
    )
    return _post_mask(replaced)


def skeleton_for_sample(text, amount=None, balance=None, is_transaction=True):
    """None when a transaction sample's amount is not actually in the SMS."""
    if not is_transaction:
        return generic_skeleton(text)
    if amount is None:
        return None
    spans = slot_amounts(text or "")
    amount_span = next((span for span in spans if abs(span["value"] - float(amount)) < 0.001), None)
    if amount_span is None:
        return None
    replacements = [(amount_span["start"], amount_span["end"], "{amount}")]
    if balance is not None:
        balance_span = next(
            (
                span for span in spans
                if span is not amount_span and abs(span["value"] - float(balance)) < 0.001
            ),
            None,
        )
        if balance_span is not None:
            replacements.append((balance_span["start"], balance_span["end"], "{balance}"))
    return _post_mask(_replace_spans(text, replacements))


def _snippet(text):
    return re.sub(r"\s+", " ", text or "").strip()[:140]


def structural_parse(text):
    """A debit/credit read that refuses to guess when the sentence is ambiguous."""
    if not text:
        return None
    spans = find_amounts(text)
    if not spans:
        return None
    transaction_spans = [span for span in spans if not _near_balance(text, span)]
    balance_spans = [span for span in spans if _near_balance(text, span)]
    if len(transaction_spans) != 1:
        return None
    span = transaction_spans[0]
    # "your a/c is debited ... and credited to a/c XX5678" describes the other
    # party. "Rs 1,500 credited to your account" is the user's own credit, so
    # the cut only applies when a debit was already stated before it.
    region = text
    credited_to = re.search(r"credited to", text, re.IGNORECASE)
    if credited_to and _DEBIT.search(text[:credited_to.start()]):
        region = text[:credited_to.start()]
    debit = bool(_DEBIT.search(region))
    credit = bool(_CREDIT.search(region))
    if debit and credit:
        return None
    if debit:
        direction = "debit"
    elif credit:
        direction = "credit"
    else:
        return None
    return {
        "amount": span["value"],
        "transaction_type": direction,
        "description": _snippet(text),
        "balance": balance_spans[0]["value"] if len(balance_spans) == 1 else None,
    }


def _match_transaction_sample(text, sample):
    skeleton = sample.get("skeleton") or ""
    if "{amount}" not in skeleton:
        return None
    spans = slot_amounts(text)
    wants_balance = "{balance}" in skeleton
    for index, span in enumerate(spans):
        balance_choices = [None]
        if wants_balance:
            balance_choices = [other for other_index, other in enumerate(spans) if other_index != index]
        for balance_span in balance_choices:
            built = skeleton_for_sample(
                text,
                amount=span["value"],
                balance=balance_span["value"] if balance_span else None,
                is_transaction=True,
            )
            if built == skeleton:
                return {
                    "amount": span["value"],
                    "transaction_type": sample.get("transaction_type"),
                    "description": sample.get("description") or _snippet(text),
                    "bank_id": sample.get("bank_id"),
                    "balance": balance_span["value"] if balance_span else None,
                }
    return None


def decide(text, samples):
    """ignore, a transaction, or need_ai. Samples beat the structural read."""
    incoming_generic = generic_skeleton(text)
    for sample in samples or []:
        if sample.get("is_transaction") is False and sample.get("skeleton") == incoming_generic:
            return {"action": "ignore", "via": "sample"}

    manual = [sample for sample in samples or [] if sample.get("is_transaction") and sample.get("source") == "manual"]
    learned = [sample for sample in samples or [] if sample.get("is_transaction") and sample.get("source") != "manual"]
    for sample in manual + learned:
        hit = _match_transaction_sample(text, sample)
        if hit and hit.get("transaction_type") in ("credit", "debit"):
            return {"action": "transaction", "via": "sample", "learn": False, **hit}

    parsed = structural_parse(text)
    if parsed:
        return {"action": "transaction", "via": "structure", "learn": False, "bank_id": None, **parsed}
    return {"action": "need_ai"}


def apply_ai(decision, ai_result):
    if decision.get("action") != "need_ai":
        return decision
    amount = (ai_result or {}).get("amount")
    direction = (ai_result or {}).get("transaction_type")
    if not isinstance(amount, (int, float)) or amount <= 0 or direction not in ("credit", "debit"):
        return {"action": "unmatched", "learn": False}
    description = (ai_result or {}).get("description")
    return {
        "action": "transaction",
        "via": "ai",
        "learn": True,
        "amount": float(amount),
        "transaction_type": direction,
        "description": description.strip()[:140] if isinstance(description, str) and description.strip() else None,
        "bank_id": None,
        "balance": None,
    }
