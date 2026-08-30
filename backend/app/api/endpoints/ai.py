"""AI feature endpoints: multi-provider config (Claude/Gemini/Ollama with priority
fallback), model discovery, connection test, AI categorization, upcoming-transaction
prediction (statistical), insights, natural-language Q&A, anomalies, and summary."""
import json
import re
from collections import defaultdict
from datetime import datetime, timedelta
from typing import Optional, List

from fastapi import APIRouter, Depends, Query, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import func, case

from app.core.database import get_db
from app.api.endpoints.auth import get_current_active_user
from app.models.models import User, Transaction, Category, Bank, TransactionType, AppSetting, AutoRule
from app.services import ai_service, currency_service
from app.services.autorules import get_active_rules, parse_list

router = APIRouter()


# ── Per-user AI result cache (AppSetting) so repeated page loads don't re-call the provider ──
def _cache_get(db: Session, uid: int, kind: str):
    row = db.query(AppSetting).filter(AppSetting.key == f"ai_cache:{uid}:{kind}").first()
    if not row or not row.value:
        return None
    try:
        return json.loads(row.value)
    except (ValueError, TypeError):
        return None


def _cache_set(db: Session, uid: int, kind: str, value: str) -> None:
    key = f"ai_cache:{uid}:{kind}"
    row = db.query(AppSetting).filter(AppSetting.key == key).first()
    payload = json.dumps({"value": value, "at": datetime.utcnow().isoformat()})
    if row:
        row.value = payload
    else:
        db.add(AppSetting(key=key, value=payload))
    db.commit()


def _ai_error_message(db: Session, uid: int, e: Exception) -> str:
    """Turn a raw provider/config error into a clear, actionable message."""
    cfg = ai_service.get_config(db, uid)
    if not cfg.get("providers"):
        return "AI not configured — enable a provider and add a key in Settings → AI."
    reason = str(e)
    low = reason.lower()
    if "429" in reason or "quota" in low or "rate limit" in low or "resource_exhausted" in low:
        return ("AI provider quota/rate limit reached (429). Wait a bit, check your provider's "
                "plan/billing, or add a fallback provider (e.g. local Ollama) in Settings → AI.")
    if "401" in reason or "403" in reason or "api key" in low or "unauthorized" in low or "permission" in low:
        return "AI authentication failed — check the API key in Settings → AI."
    return f"AI request failed: {reason[:180]}"


def _providers_available() -> dict:
    avail = {"ollama": True}  # local; real reachability is checked on test/use
    try:
        import anthropic  # noqa: F401
        avail["claude"] = True
    except Exception:
        avail["claude"] = False
    try:
        import google.generativeai  # noqa: F401
        avail["gemini"] = True
    except Exception:
        avail["gemini"] = False
    return avail


def _config_payload(db: Session, uid: int) -> dict:
    cfg = ai_service.get_config(db, uid)
    return {
        **cfg,
        "claude_key_set": ai_service.has_key(db, uid, "claude"),
        "gemini_key_set": ai_service.has_key(db, uid, "gemini"),
        "available": _providers_available(),
    }


@router.get("/config")
def get_ai_config(db: Session = Depends(get_db), current_user: User = Depends(get_current_active_user)):
    return _config_payload(db, current_user.id)


class AIConfigUpdate(BaseModel):
    providers: Optional[List[str]] = None       # ordered priority
    claude: Optional[dict] = None                # {model}
    gemini: Optional[dict] = None                # {model}
    ollama: Optional[dict] = None                # {model, base_url}
    features: Optional[dict] = None
    claude_key: Optional[str] = None
    gemini_key: Optional[str] = None


@router.put("/config")
def update_ai_config(data: AIConfigUpdate, db: Session = Depends(get_db), current_user: User = Depends(get_current_active_user)):
    if data.claude_key is not None:
        ai_service.set_key(db, current_user.id, "claude", data.claude_key.strip() or None)
    if data.gemini_key is not None:
        ai_service.set_key(db, current_user.id, "gemini", data.gemini_key.strip() or None)
    ai_service.set_config(db, current_user.id, data.dict(exclude_unset=True))
    return _config_payload(db, current_user.id)


class AITestRequest(BaseModel):
    provider: str
    api_key: Optional[str] = None
    model: Optional[str] = None


@router.post("/test")
def test_ai(data: AITestRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_active_user)):
    ok, msg = ai_service.test_provider(db, current_user.id, data.provider, data.api_key, data.model)
    return {"ok": ok, "message": msg}


@router.get("/models")
def list_ai_models(
    provider: str = Query(...),
    api_key: Optional[str] = None,
    base_url: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """List the models the given provider/key can use (for the settings dropdown)."""
    try:
        models = ai_service.list_models(db, current_user.id, provider, api_key, base_url)
        return {"ok": True, "models": models}
    except Exception as e:
        return {"ok": False, "models": [], "message": str(e)[:200]}


class AICategorizeRequest(BaseModel):
    only_uncategorized: bool = True
    limit: int = 200


@router.post("/categorize")
def ai_categorize_transactions(data: AICategorizeRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_active_user)):
    q = db.query(Transaction).filter(Transaction.user_id == current_user.id)
    if data.only_uncategorized:
        q = q.filter((Transaction.category.is_(None)) | (Transaction.category == "") |
                     (Transaction.category.in_(["Unknown", "Others"])))
    txns = q.order_by(Transaction.transaction_date.desc()).limit(max(1, min(data.limit, 500))).all()
    if not txns:
        return {"updated": 0, "considered": 0, "unique": 0}
    cats = [c.name for c in db.query(Category).filter(Category.user_id == current_user.id).all()]

    # Dedupe by normalized description: send each unique merchant to the AI once, then
    # apply the result to every matching transaction. Big token/quota saving.
    groups = defaultdict(list)          # norm_desc -> [txn]
    order = []                          # preserve first-seen order
    for t in txns:
        nd = _norm_desc(t.description)
        if nd not in groups:
            order.append(nd)
        groups[nd].append(t)
    rep_items = [{"id": i, "description": groups[nd][0].description or ""} for i, nd in enumerate(order)]

    try:
        mapping = ai_service.ai_categorize(db, current_user.id, rep_items, cats)
    except Exception as e:
        raise HTTPException(status_code=400, detail=_ai_error_message(db, current_user.id, e))

    # Remember each AI-picked category as an AutoRule keyed on the merchant's most
    # distinctive word, so the SAME merchant showing up again never needs to ask AI
    # again -- it hits this rule (via apply_auto_rules_and_notify, which every
    # ingest/sync/PDF path already runs) before ever falling through to here.
    existing_keywords = {
        str(kw).upper().strip() for r in get_active_rules(db, current_user.id) for kw in parse_list(r.keywords)
    }

    updated = 0
    rules_created = 0
    for idx, cat in mapping.items():
        if idx < 0 or idx >= len(order) or not cat:
            continue
        for t in groups[order[idx]]:
            if t.category != cat:
                t.category = cat
                updated += 1
        keyword = _merchant_keyword(order[idx])
        if keyword and keyword not in existing_keywords:
            db.add(AutoRule(
                user_id=current_user.id, name=f"Auto: {keyword.title()}",
                keywords=json.dumps([keyword]), record_type="any", category=cat,
                label_ids=json.dumps([]), priority=0, is_active=True,
            ))
            existing_keywords.add(keyword)
            rules_created += 1
    db.commit()
    return {"updated": updated, "considered": len(txns), "unique": len(rep_items), "rules_created": rules_created}


class AIQuickAddRequest(BaseModel):
    text: str


@router.post("/quick-add")
def ai_quick_add_parse(data: AIQuickAddRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_active_user)):
    """Parse a free-text sentence like 'Spent 450 on coffee and lunch at Starbucks
    yesterday' into a draft transaction {amount, description, transaction_type,
    category, transaction_date, bank_id}. Returns a DRAFT only -- the caller still
    posts to POST /transactions (the normal create path) so the user can review/
    edit before it's saved, same as every other AI-assisted entry point in this
    app (SMS/receipt/PDF extraction)."""
    text = (data.text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="text is required")

    cats = [c.name for c in db.query(Category).filter(Category.user_id == current_user.id).all()]
    banks = db.query(Bank).filter(Bank.user_id == current_user.id, Bank.is_active == True).all()  # noqa: E712
    today = datetime.utcnow().strftime("%Y-%m-%d")

    system = (
        "You extract a single transaction from a short free-text note a user typed or "
        "dictated (e.g. 'spent 450 on coffee at Starbucks yesterday', 'got 20000 salary "
        "today', 'paid 1200 electricity bill from HDFC on the 3rd'). "
        f"Today's date is {today} — resolve relative dates ('yesterday', 'last Friday', "
        "'the 3rd') against it. "
        f"Categories available: {json.dumps(cats) if cats else '[]'} (pick the closest match, "
        "or \"Others\" if nothing fits — never invent a new category name). "
        "Respond ONLY with one JSON object: "
        '{"amount": <positive number>, "description": "<merchant/purpose, short>", '
        '"type": "debit" or "credit", "category": "<one of the categories above, or null>", '
        '"date": "YYYY-MM-DD", "account_hint": "<bank/account name mentioned, or null>"}. '
        "No prose, no markdown fences."
    )

    try:
        raw = ai_service.complete(db, current_user.id, system, f"NOTE: {text}", max_tokens=300)
    except Exception as e:
        raise HTTPException(status_code=400, detail=_ai_error_message(db, current_user.id, e))

    parsed = ai_service._extract_json(raw)
    if not isinstance(parsed, dict) or parsed.get("amount") is None:
        raise HTTPException(status_code=422, detail="Couldn't parse a transaction out of that text — try rephrasing with an amount, e.g. 'Spent 450 on lunch'.")

    try:
        amount = abs(float(parsed["amount"]))
    except (TypeError, ValueError):
        raise HTTPException(status_code=422, detail="Couldn't parse a valid amount from that text.")

    ttype = str(parsed.get("type") or "debit").strip().lower()
    if ttype not in ("debit", "credit"):
        ttype = "debit"

    tdate = None
    try:
        tdate = datetime.strptime(str(parsed.get("date")), "%Y-%m-%d")
    except (TypeError, ValueError):
        tdate = datetime.utcnow()

    category = parsed.get("category") or None
    if category and cats and category not in cats:
        category = None  # AI invented a name outside the allowed list -- leave for the user to pick

    bank_id = None
    hint = (parsed.get("account_hint") or "").strip().lower()
    if hint:
        for b in banks:
            if hint in b.name.lower() or b.name.lower() in hint:
                bank_id = b.id
                break

    return {
        "amount": round(amount, 2),
        "description": str(parsed.get("description") or text)[:200],
        "transaction_type": ttype,
        "category": category,
        "transaction_date": tdate.strftime("%Y-%m-%d"),
        "bank_id": bank_id,
    }


_NUM_RE = re.compile(r"\d+")


def _norm_desc(desc: str) -> str:
    d = _NUM_RE.sub("", (desc or "").upper())
    return " ".join(d.split())[:40]


# Generic banking/UPI boilerplate words that show up in most descriptions and would
# make a useless (over-broad) AutoRule keyword if picked instead of the actual merchant.
_GENERIC_DESC_WORDS = {
    "UPI", "POS", "NEFT", "IMPS", "RTGS", "ACH", "REF", "TXN", "PYMT", "PAY", "PAYMENT",
    "FROM", "VIA", "THE", "AND", "FOR", "INFO", "CARD",
    "PURCHASE", "SPENT", "DEBIT", "CREDIT", "TRANSFER", "BANK",
}
_WORD_RE = re.compile(r"[A-Z]{4,}")


def _merchant_keyword(norm_desc: str) -> Optional[str]:
    """Picks the single most distinctive word out of an already-digit-stripped,
    normalized description to use as a new AutoRule's keyword -- e.g. "SWIGGY" out
    of "UPI-SWIGGY-YBL@ICICI", not the whole (fragile, reference-code-sensitive)
    string. Splits on any non-letter run (hyphens/underscores/@ are common in UPI
    IDs, not just spaces) so a hyphen-joined merchant name still tokenizes.
    Longest word wins, generic banking terms excluded. None if nothing usable."""
    words = [w for w in _WORD_RE.findall(norm_desc) if w not in _GENERIC_DESC_WORDS]
    return max(words, key=len) if words else None


@router.get("/predictions")
def upcoming_predictions(
    days_ahead: int = 45,
    lookback_days: int = 180,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    since = datetime.utcnow() - timedelta(days=lookback_days)
    txns = (
        db.query(Transaction)
        .filter(Transaction.user_id == current_user.id, Transaction.transaction_date >= since)
        .order_by(Transaction.transaction_date.asc())
        .all()
    )
    groups = defaultdict(list)
    for t in txns:
        groups[(_norm_desc(t.description), t.transaction_type)].append(t)

    predictions = []
    now = datetime.utcnow()
    horizon = now + timedelta(days=days_ahead)
    for (key, ttype), rows in groups.items():
        if len(rows) < 2 or not key:
            continue
        dates = [r.transaction_date for r in rows]
        gaps = [(dates[i] - dates[i - 1]).days for i in range(1, len(dates))]
        gaps = [g for g in gaps if g > 0]
        if not gaps:
            continue
        avg_gap = sum(gaps) / len(gaps)
        if avg_gap < 3 or avg_gap > 120:
            continue
        next_date = dates[-1] + timedelta(days=round(avg_gap))
        while next_date < now:
            next_date += timedelta(days=round(avg_gap))
        if next_date > horizon:
            continue
        predictions.append({
            "description": rows[-1].description,
            "category": rows[-1].category,
            "bank_name": rows[-1].bank.name if rows[-1].bank else None,
            "amount": round(sum(r.amount for r in rows) / len(rows), 2),
            "transaction_type": ttype.value if hasattr(ttype, "value") else str(ttype),
            "predicted_date": next_date.strftime("%Y-%m-%d"),
            "occurrences": len(rows),
            "avg_interval_days": round(avg_gap),
        })
    predictions.sort(key=lambda p: p["predicted_date"])
    return {
        "predictions": predictions,
        "expected_expense": round(sum(p["amount"] for p in predictions if p["transaction_type"] == "debit"), 2),
        "expected_income": round(sum(p["amount"] for p in predictions if p["transaction_type"] == "credit"), 2),
        "days_ahead": days_ahead,
    }


def _base_ccy(db: Session, uid: int):
    """(code, symbol) of the user's base currency — falls back to INR/₹."""
    base = currency_service.get_base_currency(db, uid)
    if base:
        return base.code, (base.symbol or "")
    return "INR", "₹"


def _spend_summary_text(db: Session, uid: int, days: int = 90) -> str:
    """Spending summary with every amount converted to the user's base currency and the
    currency stated up front, so the AI reports the right currency (not hardcoded INR)."""
    since = datetime.utcnow() - timedelta(days=days)
    code, symbol = _base_ccy(db, uid)
    rate_map = currency_service.get_rate_map(db, uid)
    bank_ccy = currency_service.bank_currency_map(db, uid)
    rows = (
        db.query(
            Transaction.category, Transaction.amount, Transaction.transaction_type,
            Transaction.currency_code, Transaction.bank_id,
        )
        .filter(Transaction.user_id == uid, Transaction.transaction_date >= since)
        .all()
    )
    spent_by: dict = defaultdict(float)
    total_spent = 0.0
    total_earned = 0.0
    for cat, amount, ttype, ccode, bid in rows:
        ccy = ccode or bank_ccy.get(bid) or code
        base_amt = currency_service.to_base(amount, ccy, rate_map)
        if ttype == TransactionType.DEBIT:
            spent_by[cat or "Uncategorized"] += base_amt
            total_spent += base_amt
        elif ttype == TransactionType.CREDIT:
            total_earned += base_amt
    lines = [f"- {cat}: spent {round(v, 2)} {code}" for cat, v in spent_by.items() if v > 0]
    return (
        f"All amounts below are in the user's base currency: {code} ({symbol}).\n"
        f"Period: last {days} days\nTotal income: {round(total_earned, 2)} {code}\n"
        f"Total expense: {round(total_spent, 2)} {code}\nBy category:\n"
        + "\n".join(sorted(lines, reverse=True))
    )


def _per_bank_monthly_breakdown_text(db: Session, uid: int, months: int = 6) -> str:
    """Per-account, per-month income/expense/net -- without this, the AI only ever
    sees each account's CURRENT balance snapshot plus an all-accounts-combined
    summary, so it has no way to answer a question scoped to one specific bank
    ("how's my cash flow in Standard Chartered", "am I saving in this account") even
    though that data exists; it just can't see it."""
    code, _ = _base_ccy(db, uid)
    rate_map = currency_service.get_rate_map(db, uid)
    bank_ccy = currency_service.bank_currency_map(db, uid)
    since = datetime.utcnow() - timedelta(days=months * 31 + 5)
    rows = (
        db.query(
            Transaction.bank_id, Transaction.transaction_date, Transaction.amount,
            Transaction.transaction_type, Transaction.currency_code,
        )
        .filter(Transaction.user_id == uid, Transaction.transaction_date >= since)
        .all()
    )
    per_bank: dict = defaultdict(lambda: defaultdict(lambda: [0.0, 0.0]))  # bank_id -> "YYYY-MM" -> [income, expense]
    for bid, tdate, amount, ttype, ccode in rows:
        if not tdate:
            continue
        ccy = ccode or bank_ccy.get(bid) or code
        base_amt = currency_service.to_base(amount, ccy, rate_map)
        key = tdate.strftime("%Y-%m")
        if ttype == TransactionType.CREDIT:
            per_bank[bid][key][0] += base_amt
        elif ttype == TransactionType.DEBIT:
            per_bank[bid][key][1] += base_amt
    if not per_bank:
        return ""

    bank_names = {b.id: b.name for b in db.query(Bank).filter(Bank.user_id == uid).all()}
    blocks = []
    for bid, buckets in per_bank.items():
        name = bank_names.get(bid, f"Account #{bid}")
        lines = [
            f"  - {k}: income {round(v[0], 2)} {code}, expense {round(v[1], 2)} {code}, net {round(v[0] - v[1], 2)} {code}"
            for k, v in sorted(buckets.items(), reverse=True)[:months]
        ]
        blocks.append(f"{name}:\n" + "\n".join(lines))
    return f"Monthly breakdown per account, last {months} months (most recent first):\n" + "\n\n".join(blocks)


@router.get("/insights")
def ai_spending_insights(
    generate: bool = False,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Cached by default (no provider call). Pass generate=true to (re)generate."""
    uid = current_user.id
    if not generate:
        cached = _cache_get(db, uid, "insights")
        if cached:
            return {"insight": cached["value"], "ai": True, "cached": True, "generated_at": cached.get("at")}
        return {"insight": "", "ai": False, "needs_generate": True}
    text = _spend_summary_text(db, uid, 90)
    if text[-13:] == "By category:\n":
        return {"insight": "Not enough data for insights yet.", "ai": False}
    try:
        out = ai_service.ai_insights(db, uid, text)
        _cache_set(db, uid, "insights", out)
        return {"insight": out, "ai": True, "cached": False}
    except Exception as e:
        return {"insight": _ai_error_message(db, uid, e), "ai": False}


@router.get("/summary")
def ai_monthly_summary(
    generate: bool = False,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Cached by default (no provider call). Pass generate=true to (re)generate."""
    uid = current_user.id
    if not generate:
        cached = _cache_get(db, uid, "summary")
        if cached:
            return {"summary": cached["value"], "ai": True, "cached": True, "generated_at": cached.get("at")}
        return {"summary": "", "ai": False, "needs_generate": True}
    text = _spend_summary_text(db, uid, 30)
    try:
        out = ai_service.ai_summary(db, uid, text)
        _cache_set(db, uid, "summary", out)
        return {"summary": out, "ai": True, "cached": False}
    except Exception as e:
        return {"summary": _ai_error_message(db, uid, e), "ai": False}


@router.get("/roast")
def ai_roast_spending(
    generate: bool = False,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Opt-in, blunt/funny commentary on the user's own recent spending -- same
    cached-by-default pattern as /insights and /summary, just a different system
    prompt. Purely for entertainment/behavioral-nudge value; never used elsewhere."""
    uid = current_user.id
    if not generate:
        cached = _cache_get(db, uid, "roast")
        if cached:
            return {"roast": cached["value"], "ai": True, "cached": True, "generated_at": cached.get("at")}
        return {"roast": "", "ai": False, "needs_generate": True}
    text = _spend_summary_text(db, uid, 30)
    if text[-13:] == "By category:\n":
        return {"roast": "Not enough data yet to roast you. Log a few transactions first.", "ai": False}
    system = (
        "You are a blunt, funny financial 'roast' comedian in the style of the Cleo app -- "
        "given a user's last-30-days spending breakdown, call out their worst habits with "
        "sharp, witty, PG-13 humor. Be specific (name categories/amounts), not generic. Keep "
        "it to 3-5 short punchy sentences, no bullet points, no markdown. Never be cruel about "
        "things outside their control (income level, medical costs, etc.) -- roast CHOICES "
        "(takeout, subscriptions, impulse categories), not circumstances."
    )
    try:
        out = ai_service.complete(db, uid, system, text, max_tokens=300)
        _cache_set(db, uid, "roast", out)
        return {"roast": out, "ai": True, "cached": False}
    except Exception as e:
        return {"roast": _ai_error_message(db, uid, e), "ai": False}


class AIQueryRequest(BaseModel):
    question: str


@router.post("/query")
def ai_query_endpoint(data: AIQueryRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_active_user)):
    """Natural-language Q&A over the user's finances."""
    uid = current_user.id
    code, symbol = _base_ccy(db, uid)
    rate_map = currency_service.get_rate_map(db, uid)
    bank_ccy = currency_service.bank_currency_map(db, uid)
    # Build a compact context: accounts, 90-day totals + categories, recent large txns.
    parts = [
        f"Currency: unless a line explicitly shows another currency, every amount is in the "
        f"user's base currency {code} ({symbol}). Report figures in {code}; do NOT assume rupees.",
        "",
        _spend_summary_text(db, uid, 90),
        "",
    ]
    per_bank_monthly = _per_bank_monthly_breakdown_text(db, uid, 6)
    if per_bank_monthly:
        parts.append(per_bank_monthly)
        parts.append("")
    parts.append("Accounts:")
    for b in db.query(Bank).filter(Bank.user_id == uid).all():
        if b.current_balance is None:
            parts.append(f"- {b.name} ({b.bank_type}): balance n/a")
            continue
        native_code = b.currency_code or code
        base_bal = currency_service.to_base(b.current_balance, native_code, rate_map)
        if native_code != code:
            parts.append(f"- {b.name} ({b.bank_type}): balance {b.current_balance} {native_code} "
                         f"(= {round(base_bal, 2)} {code})")
        else:
            parts.append(f"- {b.name} ({b.bank_type}): balance {round(base_bal, 2)} {code}")
    parts.append(f"\nLargest recent transactions (last 60 days, in {code}):")
    since = datetime.utcnow() - timedelta(days=60)
    big = (
        db.query(Transaction)
        .filter(Transaction.user_id == uid, Transaction.transaction_date >= since)
        .order_by(Transaction.amount.desc()).limit(20).all()
    )
    for t in big:
        sign = "-" if t.transaction_type == TransactionType.DEBIT else "+"
        ccy = t.currency_code or bank_ccy.get(t.bank_id) or code
        base_amt = currency_service.to_base(t.amount, ccy, rate_map)
        parts.append(f"- {t.transaction_date.strftime('%Y-%m-%d')} {sign}{round(base_amt, 2)} {code} "
                     f"{t.category or ''} — {(t.description or '')[:50]}")
    context = "\n".join(parts)
    try:
        answer = ai_service.ai_query(db, uid, data.question, context)
        return {"answer": answer, "ai": True}
    except Exception as e:
        return {"answer": _ai_error_message(db, uid, e), "ai": False}


@router.get("/anomalies")
def ai_anomaly_detection(
    use_ai: bool = False,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Statistical by default (free, no provider call). Pass use_ai=true to refine with AI."""
    uid = current_user.id
    since = datetime.utcnow() - timedelta(days=90)
    txns = (
        db.query(Transaction)
        .filter(Transaction.user_id == uid, Transaction.transaction_date >= since,
                Transaction.transaction_type == TransactionType.DEBIT)
        .order_by(Transaction.amount.desc()).limit(60).all()
    )
    if not txns:
        return {"anomalies": [], "ai": False}
    if use_ai:
        listing = "\n".join(
            f"{t.transaction_date.strftime('%Y-%m-%d')} | {t.amount} | {t.category or ''} | {(t.description or '')[:50]}"
            for t in txns
        )
        try:
            found = ai_service.ai_anomalies(db, uid, "Transactions (date | amount | category | description):\n" + listing)
            if found:
                return {"anomalies": found[:10], "ai": True}
        except Exception:
            pass
    # Statistical (default): amounts above mean + 2*std
    amounts = [t.amount for t in txns]
    mean = sum(amounts) / len(amounts)
    var = sum((a - mean) ** 2 for a in amounts) / len(amounts)
    std = var ** 0.5
    thresh = mean + 2 * std
    anomalies = [
        {"description": t.description, "amount": t.amount,
         "date": t.transaction_date.strftime("%Y-%m-%d"),
         "reason": f"Unusually large (> mean+2σ ≈ {round(thresh, 0)})"}
        for t in txns if t.amount > thresh
    ][:10]
    return {"anomalies": anomalies, "ai": False}


@router.get("/usage")
def ai_token_usage(db: Session = Depends(get_db), current_user: User = Depends(get_current_active_user)):
    """Per provider:model token usage (input/output/total + call count) for this
    user, for the current calendar month -- auto-resets on the 1st (see
    ai_service._load_usage_entries), no manual action needed."""
    rows = ai_service.get_usage(db, current_user.id)
    return {
        "usage": rows,
        "month": ai_service.usage_month(db, current_user.id),
        "totals": {
            "input_tokens": sum(r["input_tokens"] for r in rows),
            "output_tokens": sum(r["output_tokens"] for r in rows),
            "total_tokens": sum(r["total_tokens"] for r in rows),
            "calls": sum(r["calls"] for r in rows),
        },
    }


@router.post("/usage/reset")
def ai_reset_usage(db: Session = Depends(get_db), current_user: User = Depends(get_current_active_user)):
    ai_service.reset_usage(db, current_user.id)
    return {"ok": True}
