"""External transaction ingestion API (iOS Shortcuts, webhooks).

Authenticated with an API token (see /api/api-tokens). Callers POST arbitrary JSON; a
per-user field mapping normalises it into transactions, which then appear everywhere in
the app like any other transaction. A per-user "External" bank is auto-provisioned for
attribution when no bank is configured on the mapping.
"""
import json
import re
from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import APIRouter, Body, Depends, HTTPException, Response, status
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.api_auth import get_user_from_api_key, generate_api_token
from app.api.endpoints.auth import get_current_active_user
from app.models.models import User, Bank, Category, Transaction, IngestMapping, ApiToken
from app.services.transaction_service import TransactionService
from app.services import shortcut_service
from app.services import ai_sms_extraction
from app.services.transaction_hooks import dedupe_incoming_pending, dedupe_against_confirmed

router = APIRouter()

# Transaction fields an incoming payload may target.
TARGET_FIELDS = [
    "transaction_date", "description", "amount", "transaction_type",
    "balance", "reference_number", "category", "from_account", "to_account", "notes",
]
REQUIRED_FIELDS = ["transaction_date", "description", "amount"]

_CREDIT_TOKENS = {"credit", "cr", "c", "deposit", "in", "income", "received", "+"}
_DEBIT_TOKENS = {"debit", "dr", "d", "withdrawal", "out", "expense", "spent", "paid", "-"}

# Friendly aliases so an iOS Shortcut can send natural keys without a configured mapping.
ALIASES = {
    "date": "transaction_date", "time": "transaction_date", "datetime": "transaction_date",
    "timestamp": "transaction_date", "when": "transaction_date",
    "desc": "description", "merchant": "description", "payee": "description",
    "title": "description", "name": "description", "for": "description",
    "amt": "amount", "value": "amount", "price": "amount", "total": "amount",
    "type": "transaction_type", "direction": "transaction_type", "kind": "transaction_type",
    "cat": "category",
    "ref": "reference_number", "reference": "reference_number",
    "memo": "notes", "comment": "notes", "note": "notes",
}
# Keys (any of these) naming the target account/bank for a record.
ACCOUNT_KEYS = ("account", "bank", "account_name", "bank_name", "card")
# Keys carrying labels (csv string or list).
LABEL_KEYS = ("labels", "label", "tags", "tag")


# ─────────────────────────── coercion helpers ───────────────────────────

def _coerce_date(value: Any, date_format: Optional[str] = None) -> Optional[datetime]:
    if value is None:
        return None
    if isinstance(value, datetime):
        dt = value
    else:
        s = str(value).strip()
        if not s:
            return None
        dt = None
        if date_format:
            try:
                dt = datetime.strptime(s, date_format)
            except ValueError:
                dt = None
        if dt is None:
            try:
                dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
            except ValueError:
                dt = None
        if dt is None:
            try:
                from dateutil import parser as _dp
                dt = _dp.parse(s)
            except Exception:
                return None
    # Normalise tz-aware -> naive UTC (DB columns are naive UTC).
    if dt.tzinfo is not None:
        dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
    return dt


def _coerce_amount(value: Any):
    """Return (abs_amount, was_negative) or (None, False)."""
    if value is None:
        return None, False
    if isinstance(value, (int, float)):
        return abs(float(value)), value < 0
    s = str(value).strip()
    was_neg = (s.startswith("(") and s.endswith(")")) or s.lstrip().startswith("-")
    s = re.sub(r"[^0-9.]", "", s)
    if s in ("", "."):
        return None, False
    try:
        return abs(float(s)), was_neg
    except ValueError:
        return None, False


def _coerce_type(value: Any) -> Optional[str]:
    if value is None:
        return None
    s = str(value).strip().lower()
    if s in _CREDIT_TOKENS:
        return "credit"
    if s in _DEBIT_TOKENS:
        return "debit"
    return None


def _get_external_bank(db: Session, user: User) -> Bank:
    """Return (creating if needed) the per-user 'External' bank used for ingested rows."""
    bank = db.query(Bank).filter(
        Bank.user_id == user.id, Bank.name == "External"
    ).first()
    if bank:
        return bank
    bank = Bank(user_id=user.id, name="External", code="EXT", bank_type="other", is_active=True)
    db.add(bank)
    db.commit()
    db.refresh(bank)
    return bank


def _active_mapping(db: Session, user: User) -> Optional[IngestMapping]:
    return db.query(IngestMapping).filter(
        IngestMapping.user_id == user.id, IngestMapping.is_active == True  # noqa: E712
    ).order_by(IngestMapping.id.desc()).first()


def _ingest_one(db: Session, user: User, record: dict, mapping: Optional[IngestMapping],
                default_bank_id: int, allow_duplicates: bool, source: str = "ingest") -> dict:
    if not isinstance(record, dict):
        return {"created": False, "error": "record must be a JSON object"}

    field_map = {}
    if mapping and mapping.field_map:
        try:
            field_map = json.loads(mapping.field_map) or {}
        except (ValueError, TypeError):
            field_map = {}

    # Build target->value. With a mapping, translate source keys; also accept keys that
    # already match target field names directly, or a friendly alias (case-insensitive),
    # so a minimal payload from an iOS Shortcut works with no configured mapping.
    target = {}
    extras = {}
    account_name = None
    label_names = []
    for src_key, raw_val in record.items():
        low = str(src_key).strip().lower()
        if low in ACCOUNT_KEYS:
            account_name = str(raw_val).strip() if raw_val is not None else None
            continue
        if low in LABEL_KEYS:
            if isinstance(raw_val, list):
                label_names += [str(x).strip() for x in raw_val if str(x).strip()]
            elif raw_val is not None:
                label_names += [p.strip() for p in str(raw_val).split(",") if p.strip()]
            continue
        tgt = field_map.get(src_key)
        if tgt is None and src_key in TARGET_FIELDS:
            tgt = src_key
        if tgt is None and low in TARGET_FIELDS:
            tgt = low
        if tgt is None and low in ALIASES:
            tgt = ALIASES[low]
        if tgt in TARGET_FIELDS:
            target.setdefault(tgt, raw_val)
        else:
            extras[src_key] = raw_val

    date_format = mapping.date_format if mapping else None
    txn_date = _coerce_date(target.get("transaction_date"), date_format)
    if txn_date is None:  # date is optional for shortcuts — default to now
        txn_date = datetime.utcnow()
    description = str(target.get("description")).strip() if target.get("description") is not None else None
    amount, was_neg = _coerce_amount(target.get("amount"))

    missing = []
    if not description:
        missing.append("description")
    if amount is None:
        missing.append("amount")
    if missing:
        return {"created": False, "error": f"missing/invalid fields: {', '.join(missing)}"}

    # Per-record account override: resolve a bank by name for this user. Shortcuts users
    # naturally type a short form ("HDFC") rather than the exact configured Bank.name
    # ("HDFC Bank - Updated"), so try, in order: exact name, name contains, exact code —
    # falling back to the default/External bank (and noting the miss) rather than
    # silently guessing wrong.
    unmatched_account_name = None
    if account_name:
        low_name = account_name.lower()
        b = (
            db.query(Bank).filter(Bank.user_id == user.id, func.lower(Bank.name) == low_name).first()
            or db.query(Bank).filter(Bank.user_id == user.id, func.lower(Bank.name).contains(low_name)).first()
            or db.query(Bank).filter(Bank.user_id == user.id, func.lower(Bank.code) == low_name).first()
        )
        if b:
            default_bank_id = b.id
        else:
            unmatched_account_name = account_name

    ttype = _coerce_type(target.get("transaction_type"))
    if ttype is None:
        ttype = (mapping.default_type if mapping and mapping.default_type else "debit")

    from app.services.categorization import resolve_category
    category = target.get("category") or resolve_category(db, user.id, description)

    notes = str(target["notes"]) if target.get("notes") is not None else None
    if unmatched_account_name:
        miss_note = f"Account '{unmatched_account_name}' didn't match any bank — filed under the default account for review."
        notes = f"{notes}\n{miss_note}" if notes else miss_note

    # Duplicate check (exact match), unless the caller opts to allow duplicates.
    if not allow_duplicates:
        existing = db.query(Transaction.id).filter(
            Transaction.user_id == user.id,
            Transaction.bank_id == default_bank_id,
            Transaction.transaction_date == txn_date,
            Transaction.amount == amount,
            Transaction.description == description,
        ).first()
        if existing:
            return {"created": False, "skipped_duplicate": True, "transaction_id": existing[0]}

        # Cross-source duplicate check: the same purchase often also triggers a
        # Gmail alert email (or, for the /ingest/sms endpoint, an SMS reported
        # via a different route) -- a fuzzy match (amount/type/date, description
        # ignored) against any other still-pending source, not just an exact one.
        # Gmail always wins; see transaction_hooks._SOURCE_PRIORITY. Absorbing
        # this into the existing row (or dropping the incoming one, if the
        # existing row already outranks it) instead of creating a second pending
        # row is what lets a later PDF statement reconcile a single row instead
        # of leaving a duplicate stuck pending forever.
        dedupe_payload = {
            "transaction_date": txn_date, "amount": amount, "transaction_type": ttype,
            "description": description, "notes": notes,
        }
        dup, deduped = dedupe_incoming_pending(db, user.id, default_bank_id, dedupe_payload, source=source)
        if deduped:
            db.commit()
            return {"created": False, "skipped_duplicate": True, "transaction_id": dup.id, "merged_source": dup.source}

        # Also check against already-CONFIRMED transactions -- e.g. a statement
        # already recorded this purchase before this SMS/Shortcut report arrived,
        # or a manual entry a higher-priority real-time source should take over
        # (see dedupe_against_confirmed).
        confirmed_match, confirmed_hit = dedupe_against_confirmed(db, user.id, default_bank_id, dedupe_payload, source=source)
        if confirmed_hit:
            db.commit()
            return {"created": False, "skipped_duplicate": True, "transaction_id": confirmed_match.id, "already_confirmed": True}

    txn = Transaction(
        user_id=user.id,
        bank_id=default_bank_id,
        transaction_date=txn_date,
        description=description,
        amount=amount,
        transaction_type=ttype,
        balance=_coerce_amount(target.get("balance"))[0] if target.get("balance") is not None else None,
        reference_number=str(target["reference_number"]) if target.get("reference_number") is not None else None,
        category=category,
        from_account=str(target["from_account"]) if target.get("from_account") is not None else None,
        to_account=str(target["to_account"]) if target.get("to_account") is not None else None,
        notes=notes,
        is_manual=True,
        source=source,
        # Ingested rows are best-effort (no statement to cross-check against yet) — they
        # start Pending like alert-email transactions do, and get auto-confirmed by the
        # same reconciliation path (create_or_reconcile_transaction) once the real
        # statement transaction shows up, or manually via the Pending bulk-confirm action.
        is_confirmed=False,
        custom_fields=json.dumps(extras) if extras else None,
    )
    db.add(txn)

    try:
        from app.services.balance_service import adjust_credit_balance_for_new_transaction
        ingest_bank = db.query(Bank).filter(Bank.id == default_bank_id).first()
        if ingest_bank:
            adjust_credit_balance_for_new_transaction(ingest_bank, txn)
    except Exception:
        pass

    db.commit()
    db.refresh(txn)
    TransactionService.apply_auto_labels(db, txn.id, txn.description)

    # Apply Wallet-style AutoRules (category + labels) to ingested rows too.
    try:
        from app.services.autorules import get_active_rules, match_rule, apply_rule
        rule = match_rule(txn.description, ttype, get_active_rules(db, user.id))
        if rule:
            apply_rule(db, txn, rule)
            db.commit()
            if rule.notify_discord:
                from app.services import discord_service
                discord_service.send_rule_match_notification(db, user.id, txn, rule)
    except Exception:
        db.rollback()

    try:
        from app.services.notification_rules import check_match
        check_match(db, user.id, txn)
    except Exception:
        db.rollback()

    try:
        from app.services.transaction_hooks import check_transaction_watchers
        check_transaction_watchers(db, user.id, txn)
        db.commit()
    except Exception:
        db.rollback()

    # Attach any labels named in the payload (match existing labels case-insensitively).
    if label_names:
        try:
            from app.models.models import Label, TransactionLabel
            for lname in label_names:
                lab = db.query(Label).filter(
                    Label.user_id == user.id, func.lower(Label.name) == lname.lower()
                ).first()
                if lab and not db.query(TransactionLabel).filter(
                    TransactionLabel.transaction_id == txn.id, TransactionLabel.label_id == lab.id
                ).first():
                    db.add(TransactionLabel(transaction_id=txn.id, label_id=lab.id))
            db.commit()
        except Exception:
            db.rollback()

    return {"created": True, "transaction_id": txn.id}


# ─────────────────────────── ingestion endpoints (API key) ───────────────────────────

@router.get("/ping")
def ingest_ping(user: User = Depends(get_user_from_api_key)):
    """Verify an API token works (handy when setting up an iOS Shortcut)."""
    return {"ok": True, "user": user.username}


class ShortcutRequest(BaseModel):
    base_url: str                              # server URL reachable from the phone
    token: Optional[str] = None                # embed an existing token; else a fresh one is created
    token_name: Optional[str] = "iOS Shortcut"
    include_type: bool = True                   # ask Expense/Income
    include_category: bool = True               # ask Category (a real picker of your categories + Auto-detect)
    include_account: bool = True                # ask which account/bank it belongs to
    include_date: bool = False                  # ask the transaction date (defaults to now if skipped)
    include_notes: bool = False                 # ask free-text notes
    include_from_account: bool = False          # ask a free-text "from account" (for transfers)


@router.post("/shortcut")
def generate_ios_shortcut(
    payload: ShortcutRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Generate an importable iOS Shortcut (.shortcut plist) that posts to /api/ingest/transaction.

    The server URL and an API token are baked in so the shortcut works with no setup. When no
    token is supplied, a fresh API token is created and embedded (its plaintext lives only inside
    the returned file).
    """
    base = (payload.base_url or "").strip().rstrip("/")
    if not (base.startswith("http://") or base.startswith("https://")):
        raise HTTPException(status_code=422, detail="base_url must start with http:// or https://")

    token = (payload.token or "").strip()
    if not token:
        full_token, prefix, token_hash = generate_api_token()
        db.add(ApiToken(
            user_id=current_user.id,
            name=(payload.token_name or "iOS Shortcut")[:100],
            token_prefix=prefix,
            token_hash=token_hash,
            is_active=True,
        ))
        db.commit()
        token = full_token

    account_names = [b.name for b in db.query(Bank).filter(Bank.user_id == current_user.id).all()]
    category_names = [c.name for c in db.query(Category).filter(Category.user_id == current_user.id).all()]
    data = shortcut_service.build_add_transaction_shortcut(
        base_url=base,
        token=token,
        include_type=payload.include_type,
        include_category=payload.include_category,
        include_account=payload.include_account,
        include_date=payload.include_date,
        include_notes=payload.include_notes,
        include_from_account=payload.include_from_account,
        account_names=account_names,
        category_names=category_names,
    )
    return Response(
        content=data,
        media_type="application/octet-stream",
        headers={"Content-Disposition": 'attachment; filename="Add Transaction.shortcut"'},
    )


class SmsShortcutRequest(BaseModel):
    base_url: str
    token: Optional[str] = None
    token_name: Optional[str] = "iOS SMS Auto-Detect"


@router.post("/sms-shortcut")
def generate_sms_shortcut(
    payload: SmsShortcutRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Generate a Shortcut that forwards a message's raw text to /api/ingest/sms --
    meant to be attached to a Settings -> Shortcuts -> Automation with trigger
    "When I receive a message" (enable "Run Immediately" so it fires with no
    confirmation prompt). Apple gives no way to read the SMS inbox directly (unlike
    Android's SmsReceiver.kt), so this Automation-triggered-Shortcut is the closest
    iOS equivalent; the actual amount/debit-credit parsing happens server-side in
    /api/ingest/sms, not in the Shortcut itself.
    """
    base = (payload.base_url or "").strip().rstrip("/")
    if not (base.startswith("http://") or base.startswith("https://")):
        raise HTTPException(status_code=422, detail="base_url must start with http:// or https://")

    token = (payload.token or "").strip()
    if not token:
        full_token, prefix, token_hash = generate_api_token()
        db.add(ApiToken(
            user_id=current_user.id,
            name=(payload.token_name or "iOS SMS Auto-Detect")[:100],
            token_prefix=prefix,
            token_hash=token_hash,
            is_active=True,
        ))
        db.commit()
        token = full_token

    data = shortcut_service.build_sms_forward_shortcut(base_url=base, token=token)
    return Response(
        content=data,
        media_type="application/octet-stream",
        headers={"Content-Disposition": 'attachment; filename="SMS Auto-Detect.shortcut"'},
    )


@router.post("/transaction", status_code=status.HTTP_201_CREATED)
def ingest_transaction(
    payload: dict = Body(...),
    allow_duplicates: bool = False,
    db: Session = Depends(get_db),
    user: User = Depends(get_user_from_api_key),
):
    """Ingest a single transaction from an external source (iOS Shortcut / webhook)."""
    mapping = _active_mapping(db, user)
    bank_id = mapping.default_bank_id if (mapping and mapping.default_bank_id) else _get_external_bank(db, user).id
    # Ensure the mapping's bank still belongs to the user; otherwise fall back to External.
    if not db.query(Bank.id).filter(Bank.id == bank_id, Bank.user_id == user.id).first():
        bank_id = _get_external_bank(db, user).id

    result = _ingest_one(db, user, payload, mapping, bank_id, allow_duplicates)
    if result.get("error"):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=result["error"])
    return result


# Same generic amount/direction detection Android's SmsReceiver.kt does natively in
# Kotlin before POSTing to /transaction above -- iOS has no equivalent (Apple doesn't
# allow apps to read the SMS inbox), so a Shortcuts Automation on "message received"
# instead forwards the raw, unparsed message text here and this endpoint does the
# same parsing server-side. Deliberately generic (not per-bank regex like the Gmail
# alert-email parser in alert_email_service.py) to match Android's proven approach:
# less precise, but works across every bank's SMS wording without needing a sample
# from each one.
_SMS_AMOUNT_RE = re.compile(r"(?:rs\.?|inr)\s?([0-9][0-9,]*(?:\.[0-9]{1,2})?)", re.IGNORECASE)
_SMS_CREDIT_RE = re.compile(r"credited|received|deposited", re.IGNORECASE)
_SMS_DEBIT_RE = re.compile(r"debited|withdrawn|withdrew|spent", re.IGNORECASE)


def _match_bank_from_sms(db: Session, user: User, sender: Optional[str], body: str) -> Optional[int]:
    """Best-effort: identify which of the caller's OWN banks this SMS is from,
    using signals unlikely to false-positive (unlike guessing a per-bank SMS
    template blind, which the generic amount regex above deliberately avoids).

    Strongest signal: the user's own explicit `sms_sender_pattern` (e.g.
    "HDFCBK", "AD-SBIINB") appearing in the sender id -- set once via the Bank
    form, same idea as `sender_email` for the Gmail-sync side. Next: the
    account number's last 4 digits appearing in the message body -- issuers
    print exactly this in their own alert SMS ("... ending 6951..."). Weakest:
    the bank's short `code` (e.g. "hdfc", "icici") appearing in the SENDER id
    specifically, not the free-form body -- some codes (e.g. "sc", "yes") are
    common English words and would false-positive constantly against real
    message text. Only returns a match when exactly one bank fits at each
    tier, so an ambiguous SMS falls through to the existing default-bank
    behaviour instead of guessing wrong.
    """
    banks = db.query(Bank).filter(Bank.user_id == user.id, Bank.is_active == True).all()  # noqa: E712
    sender_upper = (sender or "").upper()

    pattern_matches = {
        b.id for b in banks
        if (pattern := (b.sms_sender_pattern or "").upper()) and pattern in sender_upper
    }
    if len(pattern_matches) == 1:
        return next(iter(pattern_matches))

    body_upper = (body or "").upper()
    last4_matches = {
        b.id for b in banks
        if len(digits := re.sub(r"\D", "", b.account_number or "")) >= 4 and digits[-4:] in body_upper
    }
    if len(last4_matches) == 1:
        return next(iter(last4_matches))

    code_matches = {
        b.id for b in banks
        if (code := (b.code or "").upper()) and len(code) >= 3 and code in sender_upper
    }
    if len(code_matches) == 1:
        return next(iter(code_matches))

    return None


class SmsIngestRequest(BaseModel):
    text: str
    sender: Optional[str] = None
    bank_id: Optional[int] = None  # optional override; falls back to auto-match, then the mapping's default/External bank


@router.post("/sms", status_code=status.HTTP_201_CREATED)
def ingest_sms(
    payload: SmsIngestRequest,
    allow_duplicates: bool = False,
    db: Session = Depends(get_db),
    user: User = Depends(get_user_from_api_key),
):
    """Ingest a raw bank transaction SMS. Created unconfirmed (is_confirmed=False,
    source='sms', distinct from the generic 'ingest' source so it's filterable
    in the Transactions list) -- same semantics as every other real-time-alert path, later
    superseded by the matching statement PDF row via create_or_reconcile_transaction
    once the real statement arrives."""
    amount = None
    transaction_type = None
    description = payload.text.strip()[:140]
    used_ai = False

    m = _SMS_AMOUNT_RE.search(payload.text)
    if m:
        try:
            amount = float(m.group(1).replace(",", ""))
        except ValueError:
            amount = None
        if amount is not None:
            credit_m = _SMS_CREDIT_RE.search(payload.text)
            debit_m = _SMS_DEBIT_RE.search(payload.text)
            if credit_m and debit_m:
                # Both keywords present -- common for an outgoing UPI transfer
                # ("Your a/c XX1234 is debited ... and credited to a/c XX5678"),
                # where "credited" describes the OTHER party's account, not the
                # user's own. Regex can't safely tell which account is "yours"
                # here -- leave it unresolved rather than guess wrong, and let
                # the AI fallback below disambiguate instead.
                transaction_type = None
            elif debit_m:
                transaction_type = "debit"
            elif credit_m:
                transaction_type = "credit"
            else:
                transaction_type = "debit"  # neither keyword present -- safe default

    if amount is None or transaction_type is None:
        # Either the generic regex couldn't find/parse an amount, or it found
        # one but the debit/credit direction is ambiguous -- bank SMS templates
        # vary too much for one regex to cover reliably (see ai_sms_extraction.py).
        # Best-effort fallback via the user's own configured AI provider; never
        # raises, just returns {} if nothing usable comes back.
        ai_result = ai_sms_extraction.extract_sms_transaction(db, user.id, payload.text)
        if ai_result:
            if amount is None:
                amount = ai_result["amount"]
            if transaction_type is None:
                transaction_type = ai_result["transaction_type"]
            if ai_result.get("description"):
                description = ai_result["description"]
            used_ai = True
        elif transaction_type is None:
            transaction_type = "debit"  # AI unavailable/unhelpful -- same safe default as before

    if amount is None or amount <= 0:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Couldn't find a Rs./INR amount in this text.")

    mapping = _active_mapping(db, user)
    matched_bank_id = _match_bank_from_sms(db, user, payload.sender, payload.text)
    bank_id = (
        payload.bank_id
        or matched_bank_id
        or (mapping.default_bank_id if (mapping and mapping.default_bank_id) else _get_external_bank(db, user).id)
    )
    if not db.query(Bank.id).filter(Bank.id == bank_id, Bank.user_id == user.id).first():
        bank_id = _get_external_bank(db, user).id

    notes = "Auto-detected from SMS" + (", AI-parsed" if used_ai else "") + (f" ({payload.sender})" if payload.sender else "")
    record = {
        "amount": amount,
        "description": description,
        "transaction_type": transaction_type,
        "notes": notes,
    }
    result = _ingest_one(db, user, record, None, bank_id, allow_duplicates, source="sms")
    if result.get("error"):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=result["error"])
    return result


@router.post("/transactions")
def ingest_transactions(
    payload: Any = Body(...),
    allow_duplicates: bool = False,
    db: Session = Depends(get_db),
    user: User = Depends(get_user_from_api_key),
):
    """Bulk ingest. Body may be a JSON array or {"transactions": [...]}."""
    if isinstance(payload, dict) and "transactions" in payload:
        records = payload["transactions"]
    elif isinstance(payload, list):
        records = payload
    else:
        raise HTTPException(status_code=422, detail="Body must be a JSON array or {transactions: [...]}")

    if not isinstance(records, list):
        raise HTTPException(status_code=422, detail="'transactions' must be a list")

    mapping = _active_mapping(db, user)
    bank_id = mapping.default_bank_id if (mapping and mapping.default_bank_id) else _get_external_bank(db, user).id
    if not db.query(Bank.id).filter(Bank.id == bank_id, Bank.user_id == user.id).first():
        bank_id = _get_external_bank(db, user).id

    results = [_ingest_one(db, user, rec, mapping, bank_id, allow_duplicates) for rec in records]
    created = sum(1 for r in results if r.get("created"))
    skipped = sum(1 for r in results if r.get("skipped_duplicate"))
    errors = sum(1 for r in results if r.get("error"))
    return {"total": len(records), "created": created, "skipped_duplicates": skipped, "errors": errors, "results": results}


# ─────────────────────────── mapping CRUD (JWT session) ───────────────────────────

class IngestMappingPayload(BaseModel):
    name: Optional[str] = "default"
    field_map: dict = {}
    default_bank_id: Optional[int] = None
    date_format: Optional[str] = None
    default_type: Optional[str] = "debit"


@router.get("/target-fields")
def get_target_fields(current_user: User = Depends(get_current_active_user)):
    """List the Transaction fields an ingest payload can map to."""
    return {"target_fields": TARGET_FIELDS, "required": REQUIRED_FIELDS}


@router.get("/mapping")
def get_mapping(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Return the current user's active ingest mapping (or null if none)."""
    mapping = _active_mapping(db, current_user)
    if not mapping:
        return None
    try:
        fm = json.loads(mapping.field_map) if mapping.field_map else {}
    except (ValueError, TypeError):
        fm = {}
    return {
        "id": mapping.id,
        "name": mapping.name,
        "field_map": fm,
        "default_bank_id": mapping.default_bank_id,
        "date_format": mapping.date_format,
        "default_type": mapping.default_type,
        "is_active": mapping.is_active,
    }


@router.post("/mapping")
def upsert_mapping(
    payload: IngestMappingPayload,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Create or update the current user's ingest mapping."""
    # Validate targets
    invalid = [v for v in payload.field_map.values() if v not in TARGET_FIELDS]
    if invalid:
        raise HTTPException(
            status_code=422,
            detail=f"Invalid target field(s): {invalid}. Allowed: {TARGET_FIELDS}",
        )
    # Validate default bank ownership if provided.
    if payload.default_bank_id is not None:
        owns = db.query(Bank.id).filter(
            Bank.id == payload.default_bank_id, Bank.user_id == current_user.id
        ).first()
        if not owns:
            raise HTTPException(status_code=404, detail="default_bank_id not found")

    mapping = _active_mapping(db, current_user)
    if not mapping:
        mapping = IngestMapping(user_id=current_user.id)
        db.add(mapping)
    mapping.name = payload.name or "default"
    mapping.field_map = json.dumps(payload.field_map or {})
    mapping.default_bank_id = payload.default_bank_id
    mapping.date_format = payload.date_format
    mapping.default_type = (payload.default_type or "debit")
    mapping.is_active = True
    db.commit()
    db.refresh(mapping)
    return {"success": True, "id": mapping.id}
