"""Apply Wallet-style AutoRules: keyword(+record-type) match → assign category + labels."""
import json
import logging
import re
from typing import List, Optional

from sqlalchemy.orm import Session

from app.models.models import AutoRule, TransactionLabel

logger = logging.getLogger(__name__)

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


def remember_category(db: Session, user_id: int, description: Optional[str], category: Optional[str]) -> tuple:
    """Creates a new AutoRule (keyword = the merchant's most distinctive word ->
    category) so a merchant that was just categorized -- by AI or a user's manual
    edit -- doesn't need asking again next time, and immediately sweeps every
    OTHER still-uncategorized transaction for a match too (see
    _sweep_uncategorized), so historical occurrences of the same merchant get
    fixed retroactively, not just future ones. No-ops if no usable keyword can be
    extracted, or if an active rule already covers this keyword (regardless of
    that rule's own category -- an existing rule already governs this merchant,
    even if its category differs, and shouldn't be silently duplicated/overridden).
    Always returns (rule_created: bool, retroactively_fixed: int) -- never a bare
    bool, so callers can always unpack it."""
    if not category:
        return False, 0
    keyword = merchant_keyword(description)
    if not keyword:
        return False, 0
    existing_keywords = {
        str(kw).upper().strip() for r in get_active_rules(db, user_id) for kw in parse_list(r.keywords)
    }
    if keyword in existing_keywords:
        return False, 0
    rule = AutoRule(
        user_id=user_id, name=f"Auto: {keyword.title()}",
        keywords=json.dumps([keyword]), record_type="any", category=category,
        label_ids=json.dumps([]), priority=0, is_active=True,
    )
    db.add(rule)
    # Flushed (not committed -- caller owns the transaction) so a second call in the
    # same request/batch (e.g. two merchant groups that happen to share a keyword)
    # sees this rule via get_active_rules() above instead of creating a duplicate,
    # and so the sweep below can query against a rule that already has an id.
    db.flush()

    fixed = _sweep_uncategorized(db, user_id, rule)
    if fixed:
        logger.info("Retroactively categorized %d existing transaction(s) via new rule '%s'", fixed, rule.name)
    return True, fixed


def _sweep_uncategorized(db: Session, user_id: int, rule: AutoRule) -> int:
    """Immediately re-checks every OTHER still-uncategorized transaction against a
    JUST-created rule -- not just future ones. Catches a merchant that showed up
    unclassified many times before the first occurrence ever got a real category
    (from AI or a manual edit)."""
    from app.models.models import Transaction

    non_null_uncats = [v for v in UNCATEGORIZED_VALUES if v]
    candidates = db.query(Transaction).filter(
        Transaction.user_id == user_id,
        (Transaction.category.is_(None)) | (Transaction.category.in_(non_null_uncats)),
    ).all()
    fixed = 0
    for t in candidates:
        ttype = t.transaction_type.value if hasattr(t.transaction_type, "value") else str(t.transaction_type)
        if match_rule(t.description, ttype, [rule]) and apply_rule(db, t, rule):
            fixed += 1
    return fixed


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
