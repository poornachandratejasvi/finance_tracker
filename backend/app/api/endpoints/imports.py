"""Import transactions from a user-uploaded CSV/Excel file.

Two-step, stateless flow (no server-side temp storage): /preview parses the file and
returns its columns + every row as raw strings, plus a best-guess field mapping; the
client lets the user adjust that mapping and posts the same columns/rows back to
/commit along with the final mapping. Reuses the same transaction-creation pipeline
(create_or_reconcile_transaction + apply_auto_rules_and_notify) that PDF/Gmail
ingestion already uses, tagged with source="import".
"""
import difflib
import io
import re
from datetime import datetime
from typing import Dict, List, Optional, Tuple

import pandas as pd
from dateutil import parser as date_parser
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.endpoints.auth import get_current_active_user, require_write_access
from app.core.database import get_db
from app.models.models import Bank, Currency, Transaction, User
from app.services.transaction_hooks import apply_auto_rules_and_notify, create_or_reconcile_transaction
from app.services.transaction_service import TransactionService

router = APIRouter()

MAX_IMPORT_ROWS = 2000

FIELD_HINTS = {
    "date": ["date", "txn date", "transaction date", "value date", "posting date"],
    "description": ["description", "narration", "particulars", "details", "remarks"],
    "amount": ["amount", "amt"],
    "type": ["type", "dr/cr", "debit/credit", "transaction type"],
    "category": ["category"],
    "notes": ["notes", "memo", "comments"],
    # Optional -- only relevant for a CSV covering multiple accounts/currencies
    # (an export from another app), where each row needs to be routed to a
    # different one of the user's own Banks rather than the single bank_id
    # every other field maps into by default. "Card" is folded in here too --
    # a card-type column is really just another clue for which Bank a row
    # belongs to, not a separate concept.
    "bank": ["bank", "account", "account name", "card", "card type", "wallet"],
    "currency": ["currency", "ccy"],
}
DEBIT_HINTS = ("debit", "dr", "withdrawal", "expense")
CREDIT_HINTS = ("credit", "cr", "deposit", "income")


def _guess_mapping(columns: List[str]) -> dict:
    lowered = [(c, c.strip().lower()) for c in columns]
    mapping: dict = {}
    for field, hints in FIELD_HINTS.items():
        match = None
        for col, low in lowered:
            if any(hint in low for hint in hints):
                match = col
                break
        mapping[field] = match
    return mapping


def _parse_amount(raw: str) -> float:
    cleaned = re.sub(r"[^\d.\-]", "", raw.replace(",", ""))
    if not cleaned or cleaned in ("-", "."):
        raise ValueError(f"Not a number: {raw!r}")
    return float(cleaned)


_ISO_DATE_RE = re.compile(r"^\d{4}[-/]\d{1,2}[-/]\d{1,2}")


def _parse_date(raw: str, date_format: Optional[str]) -> datetime:
    cleaned = raw.strip()
    if date_format:
        return datetime.strptime(cleaned, date_format)
    # dateutil's dayfirst=True also (mis-)reinterprets unambiguous YYYY-MM-DD input as
    # YYYY-DD-MM, so route those through a plain year-first parse instead; only fall back
    # to the dayfirst heuristic for genuinely ambiguous D/M/Y-style bank statement dates.
    if _ISO_DATE_RE.match(cleaned):
        return date_parser.parse(cleaned, yearfirst=True, dayfirst=False)
    return date_parser.parse(cleaned, dayfirst=True)


def _infer_type(amount_raw: str, type_raw: Optional[str]) -> Tuple[str, float]:
    amount = _parse_amount(amount_raw)
    if type_raw:
        low = type_raw.strip().lower()
        if any(h in low for h in DEBIT_HINTS):
            return "debit", abs(amount)
        if any(h in low for h in CREDIT_HINTS):
            return "credit", abs(amount)
    return ("debit" if amount < 0 else "credit"), abs(amount)


def _parse_ofx(content: bytes) -> "pd.DataFrame":
    """Parse an OFX/QFX file into the same canonical columns a CSV would have
    (Date/Description/Amount/Type), so it flows through the exact same
    preview -> mapping -> commit pipeline as CSV/Excel with a trivial 1:1 mapping."""
    import ofxparse

    try:
        ofx = ofxparse.OfxParser.parse(io.BytesIO(content))
    except Exception as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Couldn't read OFX/QFX file: {exc}")

    rows = []
    accounts = ofx.accounts if hasattr(ofx, "accounts") and ofx.accounts else ([ofx.account] if getattr(ofx, "account", None) else [])
    for acct in accounts:
        stmt = getattr(acct, "statement", None)
        if not stmt:
            continue
        for t in stmt.transactions:
            rows.append({
                "Date": t.date.strftime("%Y-%m-%d") if t.date else "",
                "Description": (t.payee or t.memo or "").strip(),
                "Amount": str(t.amount),
                "Type": "credit" if float(t.amount) >= 0 else "debit",
            })
    if not rows:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "No transactions found in this OFX/QFX file")
    return pd.DataFrame(rows)


class ImportPreviewResponse(BaseModel):
    columns: List[str]
    rows: List[List[str]]
    total_rows: int
    suggested_mapping: dict


@router.post("/preview", response_model=ImportPreviewResponse)
async def preview_import(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_active_user),
):
    filename = (file.filename or "").lower()
    if not filename.endswith((".csv", ".xlsx", ".ofx", ".qfx")):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Only .csv, .xlsx, .ofx, or .qfx files are supported")

    content = await file.read()
    try:
        if filename.endswith((".ofx", ".qfx")):
            df = _parse_ofx(content)
        elif filename.endswith(".csv"):
            df = pd.read_csv(io.BytesIO(content), dtype=str, keep_default_na=False)
        else:
            df = pd.read_excel(io.BytesIO(content), dtype=str, engine="openpyxl", keep_default_na=False)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Couldn't read file: {exc}")

    if df.empty:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "The file has no data rows")
    if len(df) > MAX_IMPORT_ROWS:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, f"File has {len(df)} rows; the import limit is {MAX_IMPORT_ROWS}"
        )

    columns = [str(c) for c in df.columns]
    rows = df.astype(str).values.tolist()

    return ImportPreviewResponse(
        columns=columns,
        rows=rows,
        total_rows=len(df),
        suggested_mapping=_guess_mapping(columns),
    )


class ImportMapping(BaseModel):
    date: str
    description: str
    amount: str
    type: Optional[str] = None
    category: Optional[str] = None
    notes: Optional[str] = None
    # Optional -- see FIELD_HINTS's comment on "bank". When set, each row's
    # value in this column is looked up in value_map.bank (below) to pick that
    # row's actual target bank, instead of every row going to the one bank_id.
    bank: Optional[str] = None
    currency: Optional[str] = None


class ImportValueMap(BaseModel):
    bank: Optional[Dict[str, int]] = None
    currency: Optional[Dict[str, str]] = None


class ImportCommitRequest(BaseModel):
    bank_id: int  # fallback target for rows whose bank value isn't in value_map (or mapping.bank is unset)
    columns: List[str]
    rows: List[List[str]]
    mapping: ImportMapping
    value_map: Optional[ImportValueMap] = None
    date_format: Optional[str] = None
    skip_duplicates: bool = True


class ImportCommitResponse(BaseModel):
    created: int
    skipped_duplicates: int
    errors: List[dict]


class ValueSuggestion(BaseModel):
    value: str
    suggested_id: Optional[int] = None      # Bank.id, when target == "bank"
    suggested_code: Optional[str] = None    # Currency.code, when target == "currency"
    suggested_label: str = ""
    score: float = 0.0
    auto_matched: bool = False              # score cleared a "confident enough" bar


class SuggestValueMapRequest(BaseModel):
    values: List[str]
    target: str  # "bank" | "currency"


# Below this, a suggestion is shown but not pre-selected -- the user picks
# explicitly rather than trusting a weak guess (e.g. "HDFC" vs "HSBC" scoring
# ~0.6 on a naive ratio would be a bad silent default).
_AUTO_MATCH_THRESHOLD = 0.72


@router.post("/suggest-value-map", response_model=List[ValueSuggestion])
def suggest_value_map(
    payload: SuggestValueMapRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Best-guess a target Bank/Currency for each distinct value found in a
    mapped CSV column, via plain string similarity (difflib, stdlib -- no new
    dependency, and this only ever runs over a handful of distinct values, not
    every row). The client still shows every suggestion for confirmation;
    auto_matched only controls whether it's pre-selected."""
    if payload.target not in ("bank", "currency"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "target must be 'bank' or 'currency'")

    suggestions: List[ValueSuggestion] = []

    if payload.target == "bank":
        banks = db.query(Bank).filter(Bank.user_id == current_user.id).all()
        candidates = [(b.id, b.name) for b in banks]
    else:
        currencies = db.query(Currency).filter(Currency.user_id == current_user.id).all()
        candidates = [(c.code, f"{c.code} — {c.name}" if c.name else c.code) for c in currencies]

    for raw_value in payload.values:
        value = (raw_value or "").strip()
        best_key, best_label, best_score = None, "", 0.0
        for key, label in candidates:
            score = difflib.SequenceMatcher(None, value.lower(), str(key).lower()).ratio()
            label_score = difflib.SequenceMatcher(None, value.lower(), label.lower()).ratio()
            score = max(score, label_score)
            if score > best_score:
                best_key, best_label, best_score = key, label, score

        auto_matched = best_score >= _AUTO_MATCH_THRESHOLD
        if payload.target == "bank":
            suggestions.append(ValueSuggestion(
                value=raw_value, suggested_id=best_key if auto_matched else None,
                suggested_label=best_label, score=round(best_score, 3), auto_matched=auto_matched,
            ))
        else:
            suggestions.append(ValueSuggestion(
                value=raw_value, suggested_code=best_key if auto_matched else None,
                suggested_label=best_label, score=round(best_score, 3), auto_matched=auto_matched,
            ))

    return suggestions


@router.post("/commit", response_model=ImportCommitResponse)
def commit_import(
    payload: ImportCommitRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_write_access),
):
    bank = db.query(Bank).filter(Bank.id == payload.bank_id, Bank.user_id == current_user.id).first()
    if not bank:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Bank not found")

    # Validate every bank_id referenced by value_map up front (not per-row) --
    # a value_map is client-supplied, so this is the only thing standing
    # between an import and writing transactions into a bank the caller
    # doesn't own.
    bank_value_map: Dict[str, int] = (payload.value_map.bank if payload.value_map and payload.value_map.bank else {})
    currency_value_map: Dict[str, str] = (payload.value_map.currency if payload.value_map and payload.value_map.currency else {})
    if bank_value_map:
        referenced_ids = set(bank_value_map.values()) | {payload.bank_id}
        owned_ids = {
            r[0] for r in db.query(Bank.id).filter(Bank.id.in_(referenced_ids), Bank.user_id == current_user.id).all()
        }
        not_owned = referenced_ids - owned_ids
        if not_owned:
            raise HTTPException(status.HTTP_403_FORBIDDEN, f"value_map references a bank you don't own: {sorted(not_owned)}")

    col_index = {c: i for i, c in enumerate(payload.columns)}
    for field_name, col in [
        ("date", payload.mapping.date),
        ("description", payload.mapping.description),
        ("amount", payload.mapping.amount),
    ]:
        if col not in col_index:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Mapped column for '{field_name}' not found in file")

    def _cell(row: List[str], col_name: Optional[str]) -> Optional[str]:
        if not col_name or col_name not in col_index:
            return None
        return row[col_index[col_name]]

    created = 0
    skipped_duplicates = 0
    errors: List[dict] = []

    for i, row in enumerate(payload.rows):
        try:
            date_raw = _cell(row, payload.mapping.date)
            desc_raw = _cell(row, payload.mapping.description)
            amount_raw = _cell(row, payload.mapping.amount)

            if not date_raw or not desc_raw or not amount_raw:
                errors.append({"row": i + 1, "message": "Missing date, description, or amount"})
                continue

            txn_date = _parse_date(date_raw, payload.date_format)
            txn_type, amount = _infer_type(amount_raw, _cell(row, payload.mapping.type))
            description = desc_raw.strip()

            if payload.skip_duplicates:
                dup = (
                    db.query(Transaction)
                    .filter(
                        Transaction.user_id == current_user.id,
                        Transaction.amount == amount,
                        Transaction.transaction_date == txn_date,
                    )
                    .filter(Transaction.description.ilike(description))
                    .first()
                )
                if dup:
                    skipped_duplicates += 1
                    continue

            category_raw = (_cell(row, payload.mapping.category) or "").strip()
            notes_raw = (_cell(row, payload.mapping.notes) or "").strip()

            # Per-row bank: only relevant when a bank/account column was mapped
            # and this row's raw value has an entry in value_map -- otherwise
            # every row falls back to the single bank_id, exactly like before
            # this feature existed.
            row_bank_id = payload.bank_id
            bank_raw = (_cell(row, payload.mapping.bank) or "").strip()
            if bank_raw and bank_raw in bank_value_map:
                row_bank_id = bank_value_map[bank_raw]

            currency_raw = (_cell(row, payload.mapping.currency) or "").strip()
            currency_code = currency_value_map.get(currency_raw) if currency_raw else None

            from app.services.categorization import resolve_category
            trans_data = {
                "transaction_date": txn_date,
                "description": description,
                "amount": amount,
                "transaction_type": txn_type,
                "category": category_raw or resolve_category(db, current_user.id, description),
                "notes": notes_raw or None,
                "currency_code": currency_code,
            }
            transaction, _reconciled = create_or_reconcile_transaction(
                db, current_user.id, row_bank_id, trans_data, source="import"
            )
            apply_auto_rules_and_notify(db, current_user.id, transaction)
            created += 1
        except Exception as exc:
            errors.append({"row": i + 1, "message": str(exc)})

    db.commit()
    return ImportCommitResponse(created=created, skipped_duplicates=skipped_duplicates, errors=errors)
