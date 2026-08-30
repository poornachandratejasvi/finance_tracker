"""Apply Wallet-style AutoRules: keyword(+record-type) match → assign category + labels."""
import json
import re
from typing import List, Optional

from sqlalchemy.orm import Session

from app.models.models import AutoRule, TransactionLabel

# Categories considered "not really categorized" -- a merchant in this state is a
# candidate to remember a rule for once a real category is provided (by AI or a
# user's manual edit), same set /duplicates/find and AI-categorize already treat
# as "needs categorization".
UNCATEGORIZED_VALUES = (None, "", "Unknown", "Others")

# Generic banking/UPI boilerplate words that show up in most descriptions and would
# make a useless (over-broad) AutoRule keyword if picked instead of the actual merchant.
_GENERIC_DESC_WORDS = {
    "UPI", "POS", "NEFT", "IMPS", "RTGS", "ACH", "REF", "TXN", "PYMT", "PAY", "PAYMENT",
    "FROM", "VIA", "THE", "AND", "FOR", "INFO", "CARD",
    "PURCHASE", "SPENT", "DEBIT", "CREDIT", "TRANSFER", "BANK",
}
_NUM_RE = re.compile(r"\d+")
_WORD_RE = re.compile(r"[A-Z]{4,}")


def merchant_keyword(description: Optional[str]) -> Optional[str]:
    """Picks the single most distinctive word out of a description to use as a new
    AutoRule's keyword -- e.g. "SWIGGY" out of "UPI-SWIGGY-YBL@ICICI", not the whole
    (fragile, reference-code-sensitive) string. Digits are stripped first (bank
    reference numbers, not part of a merchant name), then split on any non-letter
    run (hyphens/underscores/@ are common in UPI IDs, not just spaces). Longest
    word wins, generic banking terms excluded. None if nothing usable."""
    norm = _NUM_RE.sub("", (description or "").upper())
    words = [w for w in _WORD_RE.findall(norm) if w not in _GENERIC_DESC_WORDS]
    return max(words, key=len) if words else None


def remember_category(db: Session, user_id: int, description: Optional[str], category: Optional[str]) -> bool:
    """Creates a new AutoRule (keyword = the merchant's most distinctive word ->
    category) so a merchant that was just categorized -- by AI or a user's manual
    edit -- doesn't need asking again next time. No-ops if no usable keyword can be
    extracted, or if an active rule already covers this keyword (regardless of
    that rule's own category -- an existing rule already governs this merchant,
    even if its category differs, and shouldn't be silently duplicated/overridden).
    Returns True if a new rule was created."""
    if not category:
        return False
    keyword = merchant_keyword(description)
    if not keyword:
        return False
    existing_keywords = {
        str(kw).upper().strip() for r in get_active_rules(db, user_id) for kw in parse_list(r.keywords)
    }
    if keyword in existing_keywords:
        return False
    db.add(AutoRule(
        user_id=user_id, name=f"Auto: {keyword.title()}",
        keywords=json.dumps([keyword]), record_type="any", category=category,
        label_ids=json.dumps([]), priority=0, is_active=True,
    ))
    # Flushed (not committed -- caller owns the transaction) so a second call in the
    # same request/batch (e.g. two merchant groups that happen to share a keyword)
    # sees this rule via get_active_rules() above instead of creating a duplicate.
    db.flush()
    return True


def parse_list(txt):
    if not txt:
        return []
    if isinstance(txt, list):
        return txt
    try:
        v = json.loads(txt)
        return v if isinstance(v, list) else []
    except (ValueError, TypeError):
        return []


def get_active_rules(db: Session, user_id: int) -> List[AutoRule]:
    return (
        db.query(AutoRule)
        .filter(AutoRule.user_id == user_id, AutoRule.is_active.is_(True))
        .order_by(AutoRule.priority.desc(), AutoRule.id.asc())
        .all()
    )


def match_rule(description: Optional[str], ttype_value: Optional[str], rules: List[AutoRule]) -> Optional[AutoRule]:
    d = (description or "").upper()
    if not d:
        return None
    for r in rules:
        rt = (r.record_type or "any").lower()
        if rt in ("debit", "credit") and (ttype_value or "") != rt:
            continue
        for kw in parse_list(r.keywords):
            if kw and str(kw).upper().strip() in d:
                return r
    return None


def apply_rule(db: Session, transaction, rule: AutoRule) -> bool:
    """Apply a matched rule's category + labels to a transaction. Returns True if changed.

    record_type='transfer' rules are a distinct action, not just a filter: they
    mark the matching transaction as a transfer (category="Transfer", the same
    convention the Add/Edit Transaction forms use for transfer mode) instead of
    whatever category the rule itself has configured -- a Transfer Rule's
    category/labels fields are hidden client-side for exactly this reason.
    """
    changed = False
    if (rule.record_type or "any").lower() == "transfer":
        if transaction.category != "Transfer":
            transaction.category = "Transfer"
            changed = True
        return changed
    if rule.category and transaction.category != rule.category:
        transaction.category = rule.category
        changed = True
    for lid in parse_list(rule.label_ids):
        try:
            lid = int(lid)
        except (ValueError, TypeError):
            continue
        exists = (
            db.query(TransactionLabel)
            .filter(TransactionLabel.transaction_id == transaction.id, TransactionLabel.label_id == lid)
            .first()
        )
        if not exists:
            db.add(TransactionLabel(transaction_id=transaction.id, label_id=lid))
            changed = True
    return changed
