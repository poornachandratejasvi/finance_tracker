"""AI-assisted fallback for extracting a credit-card statement's billing summary
(Total Amount Due, Minimum Amount Due, due date) when the regex-based parser in
pdf_parser.py can't find it — issuer statement layouts vary too much for one
regex to cover reliably (labels and numbers land in different table cells,
historical payment-history tables repeat the same labels with stale numbers,
etc). This is a fallback, not the primary path: it only runs if configured and
only when the regex path comes back empty.

Kept deliberately narrow-scope and cheap: a short excerpt (not the whole
statement) and a small max_tokens, since this may run over many PDFs.
"""
import logging
from typing import Optional

from sqlalchemy.orm import Session

from app.services import ai_service

logger = logging.getLogger(__name__)

# Keywords whose surrounding lines matter — the statement's billing-summary box
# is usually short and appears once or twice; grab lines near these to build a
# compact excerpt instead of sending the entire (often 5-10 page) statement.
_SUMMARY_KEYWORDS = (
    "amount due", "minimum due", "min. amt", "min amt", "total due",
    "outstanding balance", "outstanding due", "payment due", "due date",
    "closing balance", "statement balance", "net outstanding",
)


def _build_excerpt(text: str, max_chars: int = 3500, window: int = 3, keywords=_SUMMARY_KEYWORDS) -> str:
    """Pull a window of lines around each keyword hit, not just the matching line
    itself — statement tables often print the label on one line and the actual
    figures on the next (or split across cells before/after it), so the label
    alone gives the AI nothing to extract. Preferring earlier matches (the
    summary box is normally on page 1; later hits are more likely stale
    historical-table rows), and de-duplicating overlapping windows."""
    if not text:
        return ""
    lines = text.splitlines()
    included = set()
    ordered_chunks = []
    total_len = 0
    for i, line in enumerate(lines):
        if total_len > max_chars:
            break
        low = line.lower()
        if not any(k in low for k in keywords):
            continue
        lo, hi = max(0, i - window), min(len(lines), i + window + 1)
        new_idx = [j for j in range(lo, hi) if j not in included]
        if not new_idx:
            continue
        for j in new_idx:
            included.add(j)
        chunk = "\n".join(lines[j].strip() for j in range(lo, hi))
        ordered_chunks.append(chunk)
        total_len += len(chunk)
    excerpt = "\n---\n".join(ordered_chunks) if ordered_chunks else text[:max_chars]
    return excerpt[:max_chars]


def extract_billing_summary(db: Session, uid: int, text: str) -> dict:
    """Ask the user's configured AI provider to extract billing-summary fields
    from a credit-card statement's text. Returns {} (never raises) if no
    provider is configured, the call fails, or nothing parseable comes back.

    Returned dict keys (all optional): total_amount_due, minimum_amount_due,
    due_date (ISO date string), statement_date (ISO date string).
    """
    excerpt = _build_excerpt(text)
    if not excerpt:
        return {}

    system = (
        "You extract billing-summary figures from a credit-card statement excerpt. The "
        "excerpt is several separate windows (split by '---') of text lines pulled from "
        "around each mention of a due/balance keyword — a PDF table's columns were "
        "flattened into plain text, so a label like 'Total Amount Due' often appears on "
        "one line while its actual number sits on the line just before or after it (in the "
        "same relative column position), or the currency symbol renders as a stray letter "
        "like 'C' or 'Rs.' immediately before the digits. Some windows are stale historical "
        "payment-table rows (often near old-looking dates) rather than the current summary — "
        "prefer the window nearest the statement's own Statement Date / Payment Due Date. "
        "Identify the CURRENT statement's Total Amount Due (the full outstanding balance to "
        "pay in full) as a positive number. Respond ONLY with a JSON object: "
        '{"total_amount_due": <number or null>, "minimum_amount_due": <number or null>, '
        '"due_date": "<YYYY-MM-DD or null>", "statement_date": "<YYYY-MM-DD or null>"}. '
        "No prose, no markdown fences. Use null for anything you can't confidently identify."
    )
    prompt = f"STATEMENT EXCERPT (windows separated by ---):\n{excerpt}"

    try:
        raw = ai_service.complete(db, uid, system, prompt, max_tokens=250)
    except Exception as e:
        logger.info("AI statement-summary extraction unavailable: %s", str(e)[:150])
        # Surface *why* it failed (e.g. quota) rather than silently looking like "AI
        # found nothing" — callers can report this distinctly instead of "not_found".
        return {"_error": str(e)[:200]}

    data = ai_service._extract_json(raw)
    if not isinstance(data, dict):
        return {}

    out = {}
    tad = data.get("total_amount_due")
    if isinstance(tad, (int, float)) and tad > 0:
        out["total_amount_due"] = float(tad)
    mad = data.get("minimum_amount_due")
    if isinstance(mad, (int, float)) and mad >= 0:
        out["minimum_amount_due"] = float(mad)
    for k in ("due_date", "statement_date"):
        v = data.get(k)
        if isinstance(v, str) and v.strip() and v.lower() != "null":
            out[k] = v.strip()
    return out


def extract_total_amount_due_ai(db: Session, uid: int, text: str) -> Optional[float]:
    """Convenience wrapper: just the number, or None."""
    return extract_billing_summary(db, uid, text).get("total_amount_due")


_REWARD_POINTS_KEYWORDS = (
    "reward point", "reward points", "loyalty point", "loyalty points",
    "bonus point", "bonus points", "neu point", "neu points", "cashpoint", "cash points",
)


def extract_reward_points_ai(db: Session, uid: int, text: str) -> Optional[float]:
    """Ask the user's configured AI provider for a credit-card statement's reward/
    loyalty points closing balance, when pdf_parser.extract_reward_points's regex
    comes up empty. Returns None (never raises) if no provider is configured, the
    call fails, or nothing parseable comes back."""
    if not _has_reward_keyword(text):
        return None
    excerpt = _build_excerpt(text, window=3, keywords=_REWARD_POINTS_KEYWORDS)
    if not excerpt:
        return None

    system = (
        "You extract a reward/loyalty points figure from a credit-card statement excerpt. "
        "The excerpt is separate windows (split by '---') of text lines pulled from around "
        "each mention of a points-related keyword -- a PDF table's columns were flattened "
        "into plain text, so a label like 'Reward Points' often appears on one line while its "
        "actual number sits on the line just before or after it. Identify the CURRENT "
        "statement's CLOSING reward/loyalty points balance (not points earned this cycle "
        "alone, not a redemption catalog value) as a non-negative number. Respond ONLY with a "
        'JSON object: {"reward_points": <number or null>}. No prose, no markdown fences. Use '
        "null if you can't confidently identify it."
    )
    prompt = f"STATEMENT EXCERPT (windows separated by ---):\n{excerpt}"

    try:
        raw = ai_service.complete(db, uid, system, prompt, max_tokens=100)
    except Exception as e:
        logger.info("AI reward-points extraction unavailable: %s", str(e)[:150])
        return None

    data = ai_service._extract_json(raw)
    if not isinstance(data, dict):
        return None
    val = data.get("reward_points")
    if isinstance(val, (int, float)) and val >= 0:
        return float(val)
    return None


def _has_reward_keyword(text: str) -> bool:
    low = text.lower()
    return any(k in low for k in _REWARD_POINTS_KEYWORDS)
