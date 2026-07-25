"""AI-assisted fallback for extracting individual transaction rows from a
statement PDF when the regex/table-based parsers in pdf_parser.py find NOTHING —
a layout none of the per-issuer parsers recognize (e.g. a bank/format not yet
supported, or a table structure that defeats column detection).

This is a last-resort fallback, not the primary path: pdf_parser.py's existing
parsers are faster, free, and battle-tested against real statements — this only
engages when they return zero transactions for a statement that clearly has
some (non-trivial extracted text).
"""
import json
import logging
import re
from datetime import datetime
from typing import Dict, List, Optional, Tuple

from sqlalchemy.orm import Session

from app.services import ai_service

logger = logging.getLogger(__name__)

MAX_CHUNKS = 10           # bounds AI calls (and quota/cost) per statement
CHUNK_CHARS = 3500        # per-chunk excerpt size
CHUNK_OVERLAP_LINES = 2   # repeat a couple of lines across chunk boundaries so a
                          # transaction row split across the boundary isn't lost

_TYPE_CREDIT = {"credit", "cr", "deposit", "in", "income", "received", "payment", "refund"}
_TYPE_DEBIT = {"debit", "dr", "withdrawal", "out", "expense", "spent", "purchase"}


def _chunks(text: str) -> List[str]:
    lines = text.splitlines()
    chunks = []
    i = 0
    while i < len(lines) and len(chunks) < MAX_CHUNKS:
        buf = []
        length = 0
        start = i
        while i < len(lines) and length < CHUNK_CHARS:
            buf.append(lines[i])
            length += len(lines[i]) + 1
            i += 1
        chunks.append("\n".join(buf))
        # back up a couple of lines so a row split at the boundary appears whole
        # in the next chunk too (dedup handles the resulting overlap).
        i = max(i - CHUNK_OVERLAP_LINES, start + 1)
    return chunks


def _normalize_type(raw) -> Optional[str]:
    s = str(raw or "").strip().lower()
    if s in _TYPE_CREDIT:
        return "credit"
    if s in _TYPE_DEBIT:
        return "debit"
    return None


def _normalize_amount(raw) -> Optional[float]:
    if raw is None:
        return None
    if isinstance(raw, (int, float)):
        return abs(float(raw))
    s = re.sub(r"[^0-9.]", "", str(raw))
    if not s or s == ".":
        return None
    try:
        return abs(float(s))
    except ValueError:
        return None


def _normalize_date(raw) -> Optional[datetime]:
    if not raw:
        return None
    s = str(raw).strip()
    for fmt in ("%Y-%m-%d", "%d-%m-%Y", "%d/%m/%Y"):
        try:
            return datetime.strptime(s, fmt)
        except ValueError:
            continue
    try:
        from dateutil import parser as _dp
        return _dp.parse(s, dayfirst=True)
    except Exception:
        return None


def _row_key(row: dict) -> Tuple:
    return (
        row["transaction_date"].strftime("%Y-%m-%d") if row.get("transaction_date") else "",
        round(row.get("amount") or 0, 2),
        (row.get("description") or "")[:40].strip().lower(),
    )


def extract_transactions_via_ai(
    db: Session, uid: int, text: str, statement_period: Optional[dict] = None
) -> List[Dict]:
    """Ask the user's configured AI provider to read the statement chunk-by-chunk
    and return transaction rows in the exact shape Transaction(**row) expects:
    {transaction_date, description, amount, transaction_type, balance, reference_number}.
    Best-effort — returns [] (never raises) on any failure so callers can fall back
    to the parser's (empty) result rather than breaking the upload."""
    if not text:
        return []

    period_hint = ""
    if statement_period and (statement_period.get("start") or statement_period.get("end")):
        period_hint = (
            f"This statement covers the period {statement_period.get('start')} to "
            f"{statement_period.get('end')} — use it to resolve any date that's missing a year."
        )

    system = (
        "You extract transaction rows from a bank/credit-card statement excerpt (one page or "
        "part of one). The excerpt is plain text flattened from a PDF table, so columns may be "
        "reordered or run together. For EVERY real transaction row (not headers, page totals, "
        "or footer/T&C text) return an object: "
        '{"date": "YYYY-MM-DD", "description": "...", "amount": <positive number>, '
        '"type": "debit" or "credit", "balance": <number or null>, "reference": <string or null>}. '
        "\"debit\" = money out (purchase/withdrawal/payment made); \"credit\" = money in "
        "(deposit/refund/payment received). " + period_hint + " "
        "Respond ONLY with a JSON array (use [] if this excerpt has no transaction rows). "
        "No prose, no markdown fences."
    )

    all_rows: List[dict] = []
    seen = set()
    chunks = _chunks(text)
    if len(text.splitlines()) > MAX_CHUNKS * (CHUNK_CHARS / 40):
        logger.info("AI transaction extraction: statement longer than %d chunks — only the first %d chunks were processed", MAX_CHUNKS, MAX_CHUNKS)

    for chunk in chunks:
        prompt = f"STATEMENT EXCERPT:\n{chunk}"
        try:
            raw = ai_service.complete(db, uid, system, prompt, max_tokens=1500)
        except Exception as e:
            logger.info("AI transaction extraction failed on a chunk: %s", str(e)[:150])
            continue
        parsed = ai_service._extract_json(raw)
        if not isinstance(parsed, list):
            continue
        for item in parsed:
            if not isinstance(item, dict):
                continue
            tdate = _normalize_date(item.get("date"))
            amount = _normalize_amount(item.get("amount"))
            ttype = _normalize_type(item.get("type"))
            desc = str(item.get("description") or "").strip()
            if not (tdate and amount and ttype and desc):
                continue
            row = {
                "transaction_date": tdate,
                "description": desc,
                "amount": amount,
                "transaction_type": ttype,
                "balance": _normalize_amount(item.get("balance")) if item.get("balance") is not None else None,
                "reference_number": (str(item["reference"])[:100] if item.get("reference") else None),
            }
            key = _row_key(row)
            if key in seen:
                continue
            seen.add(key)
            all_rows.append(row)

    all_rows.sort(key=lambda r: r["transaction_date"])
    return all_rows


def fill_missing_transactions(db: Session, uid: int, parse_result: dict) -> bool:
    """If the regex/table parsers found zero transactions for this statement, try
    the AI fallback using the raw text pdf_parser.parse_statement() stashed at
    parse_result['_raw_text']. Mutates parse_result['transactions'] in place when
    the AI finds rows. Returns True if it filled anything."""
    if parse_result.get("transactions"):
        return False
    text = parse_result.get("_raw_text")
    if not text:
        return False
    try:
        rows = extract_transactions_via_ai(db, uid, text, parse_result.get("statement_period"))
    except Exception as e:
        logger.info("AI transaction fallback errored: %s", str(e)[:150])
        return False
    if rows:
        parse_result["transactions"] = rows
        parse_result["transactions_source"] = "ai"
        if parse_result.get("ending_balance") is None:
            balances = [r["balance"] for r in rows if r.get("balance") is not None]
            if balances:
                parse_result["ending_balance"] = balances[-1]
        logger.info("AI transaction fallback filled %d rows", len(rows))
        return True
    return False
