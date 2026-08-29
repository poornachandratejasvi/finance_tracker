"""Import transactions from a user-uploaded CSV/Excel file.

Two-step, stateless flow (no server-side temp storage): /preview parses the file and
returns its columns + every row as raw strings, plus a best-guess field mapping; the
client lets the user adjust that mapping and posts the same columns/rows back to
/commit along with the final mapping. Reuses the same transaction-creation pipeline
(create_or_reconcile_transaction + apply_auto_rules_and_notify) that PDF/Gmail
ingestion already uses, tagged with source="import".
"""
import io
import re
from datetime import datetime
from typing import List, Optional, Tuple

import pandas as pd
from dateutil import parser as date_parser
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.endpoints.auth import get_current_active_user, require_write_access
from app.core.database import get_db
from app.models.models import Bank, Transaction, User
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


class ImportCommitRequest(BaseModel):
    bank_id: int
    columns: List[str]
    rows: List[List[str]]
    mapping: ImportMapping
    date_format: Optional[str] = None
    skip_duplicates: bool = True


class ImportCommitResponse(BaseModel):
    created: int
    skipped_duplicates: int
    errors: List[dict]


@router.post("/commit", response_model=ImportCommitResponse)
def commit_import(
    payload: ImportCommitRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_write_access),
):
    bank = db.query(Bank).filter(Bank.id == payload.bank_id, Bank.user_id == current_user.id).first()
    if not bank:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Bank not found")

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

            trans_data = {
                "transaction_date": txn_date,
                "description": description,
                "amount": amount,
                "transaction_type": txn_type,
                "category": category_raw or TransactionService.categorize_transaction(description),
                "notes": notes_raw or None,
            }
            transaction, _reconciled = create_or_reconcile_transaction(
                db, current_user.id, bank.id, trans_data, source="import"
            )
            apply_auto_rules_and_notify(db, current_user.id, transaction)
            created += 1
        except Exception as exc:
            errors.append({"row": i + 1, "message": str(exc)})

    db.commit()
    return ImportCommitResponse(created=created, skipped_duplicates=skipped_duplicates, errors=errors)
