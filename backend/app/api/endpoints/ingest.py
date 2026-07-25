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
from app.models.models import User, Bank, Transaction, IngestMapping, ApiToken
from app.services.transaction_service import TransactionService
from app.services import shortcut_service

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
                default_bank_id: int, allow_duplicates: bool) -> dict:
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

    # Per-record account override: resolve a bank by name (case-insensitive) for this user.
    if account_name:
        b = db.query(Bank).filter(
            Bank.user_id == user.id, func.lower(Bank.name) == account_name.lower()
        ).first()
        if b:
            default_bank_id = b.id

    ttype = _coerce_type(target.get("transaction_type"))
    if ttype is None:
        ttype = (mapping.default_type if mapping and mapping.default_type else "debit")

    category = target.get("category") or TransactionService.categorize_transaction(description)

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
        notes=str(target["notes"]) if target.get("notes") is not None else None,
        is_manual=True,
        source="ingest",
        custom_fields=json.dumps(extras) if extras else None,
    )
    db.add(txn)
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
    include_category: bool = False              # ask Category (blank = auto)


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

    data = shortcut_service.build_add_transaction_shortcut(
        base_url=base,
        token=token,
        include_type=payload.include_type,
        include_category=payload.include_category,
    )
    return Response(
        content=data,
        media_type="application/octet-stream",
        headers={"Content-Disposition": 'attachment; filename="Add Transaction.shortcut"'},
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
