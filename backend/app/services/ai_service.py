"""Provider-agnostic AI layer supporting Anthropic Claude, Google Gemini, and a
local Ollama model (works offline after a one-time model pull).

Multiple providers can be enabled at once with an ordered PRIORITY chain: a call
tries each provider in order and falls back to the next if one is missing a
key/errors out. Config + API keys live per-user in AppSetting (keys encrypted).
"""
import json
import logging
import re
from typing import Optional, List, Dict, Tuple

from sqlalchemy.orm import Session

from app.models.models import AppSetting
from app.core.crypto import encrypt_value, decrypt_value

logger = logging.getLogger(__name__)

ALL_PROVIDERS = ["claude", "gemini", "ollama"]
KEYED_PROVIDERS = ["claude", "gemini"]  # ollama uses a base_url, no key

DEFAULT_CONFIG = {
    "providers": [],  # ordered priority; empty = AI disabled
    "claude": {"model": "claude-opus-4-8"},
    "gemini": {"model": "gemini-1.5-flash"},
    "ollama": {"model": "llama3.2", "base_url": "http://host.docker.internal:11434"},
    "features": {
        "categorize": True, "insights": True, "predict": True,
        "query": True, "anomalies": True, "summary": True,
    },
}


# ---------- config + key storage ----------
def _cfg_key(uid: int) -> str:
    return f"ai_config:{uid}"


def _api_key_key(uid: int, provider: str) -> str:
    return f"ai_key_{provider}:{uid}"


def get_config(db: Session, uid: int) -> dict:
    row = db.query(AppSetting).filter(AppSetting.key == _cfg_key(uid)).first()
    cfg = json.loads(json.dumps(DEFAULT_CONFIG))  # deep copy
    if row and row.value:
        try:
            saved = json.loads(row.value)
        except (ValueError, TypeError):
            saved = {}
        # migrate legacy single-provider shape
        if "providers" not in saved and saved.get("provider") in ALL_PROVIDERS:
            saved["providers"] = [saved["provider"]]
        # legacy flat model fields
        if "claude_model" in saved:
            cfg["claude"]["model"] = saved["claude_model"]
        if "gemini_model" in saved:
            cfg["gemini"]["model"] = saved["gemini_model"]
        if isinstance(saved.get("providers"), list):
            cfg["providers"] = [p for p in saved["providers"] if p in ALL_PROVIDERS]
        for prov in ALL_PROVIDERS:
            if isinstance(saved.get(prov), dict):
                cfg[prov].update(saved[prov])
        if isinstance(saved.get("features"), dict):
            cfg["features"].update(saved["features"])
    return cfg


def set_config(db: Session, uid: int, patch: dict) -> dict:
    cfg = get_config(db, uid)
    if isinstance(patch.get("providers"), list):
        cfg["providers"] = [p for p in patch["providers"] if p in ALL_PROVIDERS]
    for prov in ALL_PROVIDERS:
        if isinstance(patch.get(prov), dict):
            cfg[prov].update(patch[prov])
    # legacy flat fields still accepted
    if patch.get("claude_model"):
        cfg["claude"]["model"] = patch["claude_model"]
    if patch.get("gemini_model"):
        cfg["gemini"]["model"] = patch["gemini_model"]
    if isinstance(patch.get("features"), dict):
        cfg["features"].update({k: bool(v) for k, v in patch["features"].items()})
    row = db.query(AppSetting).filter(AppSetting.key == _cfg_key(uid)).first()
    if row:
        row.value = json.dumps(cfg)
    else:
        db.add(AppSetting(key=_cfg_key(uid), value=json.dumps(cfg)))
    db.commit()
    return cfg


def set_key(db: Session, uid: int, provider: str, key: Optional[str]) -> None:
    k = _api_key_key(uid, provider)
    row = db.query(AppSetting).filter(AppSetting.key == k).first()
    if not key:
        if row:
            db.delete(row)
            db.commit()
        return
    enc = encrypt_value(key)
    if row:
        row.value = enc
    else:
        db.add(AppSetting(key=k, value=enc))
    db.commit()


def get_key(db: Session, uid: int, provider: str) -> Optional[str]:
    row = db.query(AppSetting).filter(AppSetting.key == _api_key_key(uid, provider)).first()
    if not row or not row.value:
        return None
    try:
        return decrypt_value(row.value)
    except Exception:
        return None


def has_key(db: Session, uid: int, provider: str) -> bool:
    return get_key(db, uid, provider) is not None


# ---------- token-usage tracking (per provider:model, per user, resets each calendar month) ----------
def _usage_key(uid: int) -> str:
    return f"ai_usage:{uid}"


def _current_month() -> str:
    from datetime import datetime
    return datetime.utcnow().strftime("%Y-%m")


def _load_usage_entries(db: Session, uid: int):
    """Returns (entries, row). Entries from a previous calendar month are
    discarded here rather than via a scheduled job -- no cron to miss if the
    server happens to be down on the 1st; the very next AI call or usage-page
    view of the new month just starts from empty."""
    row = db.query(AppSetting).filter(AppSetting.key == _usage_key(uid)).first()
    if not row or not row.value:
        return {}, row
    try:
        payload = json.loads(row.value)
    except (ValueError, TypeError):
        return {}, row
    if payload.get("month") != _current_month():
        return {}, row
    return payload.get("entries") or {}, row


def _record_usage(db: Session, uid: int, provider: str, model: str, usage: dict) -> None:
    if not usage:
        return
    entries, row = _load_usage_entries(db, uid)
    k = f"{provider}:{model or 'default'}"
    entry = entries.get(k) or {"input": 0, "output": 0, "calls": 0}
    entry["input"] += int(usage.get("input") or 0)
    entry["output"] += int(usage.get("output") or 0)
    entry["calls"] += 1
    entries[k] = entry
    payload = json.dumps({"month": _current_month(), "entries": entries})
    if row:
        row.value = payload
    else:
        db.add(AppSetting(key=_usage_key(uid), value=payload))
    db.commit()


def get_usage(db: Session, uid: int) -> list:
    entries, _ = _load_usage_entries(db, uid)
    out = []
    for k, v in entries.items():
        provider, _, model = k.partition(":")
        out.append({
            "provider": provider, "model": model,
            "input_tokens": v.get("input", 0), "output_tokens": v.get("output", 0),
            "total_tokens": v.get("input", 0) + v.get("output", 0), "calls": v.get("calls", 0),
        })
    out.sort(key=lambda x: x["total_tokens"], reverse=True)
    return out


def usage_month(db: Session, uid: int) -> str:
    """The calendar month the current usage figures cover (for display), e.g. '2026-08'."""
    return _current_month()


def reset_usage(db: Session, uid: int) -> None:
    row = db.query(AppSetting).filter(AppSetting.key == _usage_key(uid)).first()
    if row:
        db.delete(row)
        db.commit()


# ---------- provider calls (return (text, usage_dict)) ----------
def _claude_complete(api_key: str, model: str, system: str, prompt: str, max_tokens: int = 1024):
    import anthropic
    client = anthropic.Anthropic(api_key=api_key)
    resp = client.messages.create(
        model=model or "claude-opus-4-8",
        max_tokens=max_tokens,
        system=system,
        messages=[{"role": "user", "content": prompt}],
    )
    text = "".join(b.text for b in resp.content if getattr(b, "type", None) == "text")
    u = getattr(resp, "usage", None)
    usage = {"input": getattr(u, "input_tokens", 0) or 0, "output": getattr(u, "output_tokens", 0) or 0}
    return text, usage


def _gemini_complete(api_key: str, model: str, system: str, prompt: str, max_tokens: int = 1024):
    import google.generativeai as genai
    genai.configure(api_key=api_key)
    gm = genai.GenerativeModel(model or "gemini-1.5-flash", system_instruction=system or None)
    resp = gm.generate_content(prompt)
    text = (getattr(resp, "text", None) or "").strip()
    m = getattr(resp, "usage_metadata", None)
    usage = {"input": getattr(m, "prompt_token_count", 0) or 0, "output": getattr(m, "candidates_token_count", 0) or 0}
    return text, usage


def _ollama_complete(base_url: str, model: str, system: str, prompt: str, max_tokens: int = 1024):
    import httpx
    url = (base_url or "http://host.docker.internal:11434").rstrip("/") + "/api/chat"
    messages = []
    if system:
        messages.append({"role": "system", "content": system})
    messages.append({"role": "user", "content": prompt})
    r = httpx.post(url, json={
        "model": model or "llama3.2",
        "messages": messages,
        "stream": False,
        "options": {"num_predict": max_tokens},
    }, timeout=300)
    r.raise_for_status()
    data = r.json()
    text = (data.get("message", {}).get("content") or "").strip()
    usage = {"input": data.get("prompt_eval_count", 0) or 0, "output": data.get("eval_count", 0) or 0}
    return text, usage


_MAX_MODEL_ATTEMPTS = 4  # the configured model, plus up to 3 fallbacks


def _call_provider(db: Session, uid: int, provider: str, cfg: dict, system: str, prompt: str, max_tokens: int):
    """Returns (text, model, usage). Tries the configured model first; if it
    errors (a specific model tier can be deprecated, rate-limited, or
    quota-exhausted independently of the API key itself still being valid),
    fetches the provider's other available models and tries a few more
    before giving up on this provider entirely and moving to the next
    provider in the priority chain (handled by complete(), below)."""
    if provider == "claude":
        key = get_key(db, uid, "claude")
        if not key:
            raise RuntimeError("Claude key not set")
        call = lambda model: _claude_complete(key, model, system, prompt, max_tokens)
        configured_model = cfg["claude"].get("model")
    elif provider == "gemini":
        key = get_key(db, uid, "gemini")
        if not key:
            raise RuntimeError("Gemini key not set")
        call = lambda model: _gemini_complete(key, model, system, prompt, max_tokens)
        configured_model = cfg["gemini"].get("model")
    elif provider == "ollama":
        oc = cfg.get("ollama", {})
        call = lambda model: _ollama_complete(oc.get("base_url"), model, system, prompt, max_tokens)
        configured_model = oc.get("model")
    else:
        raise RuntimeError(f"Unknown provider {provider}")

    candidates = [configured_model]
    last_err = None
    for attempt, model in enumerate(candidates):
        if not model:
            continue
        try:
            text, usage = call(model)
            return text, model, usage
        except Exception as e:
            last_err = e
            logger.info("AI model %s/%s failed, trying next model: %s", provider, model, str(e)[:120])
            if attempt == 0:
                # Only fetch alternates once, on the first failure -- avoids
                # hammering the provider's model-list endpoint on every retry.
                try:
                    for m in list_models(db, uid, provider):
                        if m not in candidates:
                            candidates.append(m)
                        if len(candidates) >= _MAX_MODEL_ATTEMPTS:
                            break
                except Exception:
                    pass
    raise last_err or RuntimeError(f"No usable model for {provider}")


def complete(db: Session, uid: int, system: str, prompt: str, max_tokens: int = 1024) -> str:
    """Try enabled providers in priority order; fall back to the next on failure.
    Records token usage per provider:model on success."""
    cfg = get_config(db, uid)
    providers = cfg.get("providers") or []
    if not providers:
        raise RuntimeError("AI is not configured. Enable a provider in Settings → AI.")
    last_err = None
    for provider in providers:
        try:
            text, model, usage = _call_provider(db, uid, provider, cfg, system, prompt, max_tokens)
            if text:
                try:
                    _record_usage(db, uid, provider, model, usage)
                except Exception:
                    db.rollback()
                return text
            last_err = RuntimeError(f"{provider} returned empty output")
        except Exception as e:
            last_err = e
            logger.info("AI provider %s failed, trying next: %s", provider, str(e)[:120])
            continue
    raise last_err or RuntimeError("All AI providers failed")


def test_provider(db: Session, uid: int, provider: str, api_key: Optional[str] = None, model: Optional[str] = None) -> Tuple[bool, str]:
    cfg = get_config(db, uid)
    try:
        if provider == "claude":
            key = api_key or get_key(db, uid, "claude")
            if not key:
                return False, "No Claude API key."
            out, _ = _claude_complete(key, model or cfg["claude"].get("model"), "You are a test.", "Reply with OK.", 20)
        elif provider == "gemini":
            key = api_key or get_key(db, uid, "gemini")
            if not key:
                return False, "No Gemini API key."
            out, _ = _gemini_complete(key, model or cfg["gemini"].get("model"), "You are a test.", "Reply with OK.", 20)
        elif provider == "ollama":
            oc = cfg.get("ollama", {})
            out, _ = _ollama_complete(oc.get("base_url"), model or oc.get("model"), "You are a test.", "Reply with OK.", 20)
        else:
            return False, "Unknown provider"
        return True, f"Connected. Replied: {(out or 'OK').strip()[:40]}"
    except Exception as e:
        return False, str(e)[:200]


def list_models(db: Session, uid: int, provider: str, api_key: Optional[str] = None, base_url: Optional[str] = None) -> List[str]:
    """List models the given provider/key is allowed to use, for the UI dropdown."""
    if provider == "claude":
        import anthropic
        key = api_key or get_key(db, uid, "claude")
        if not key:
            raise RuntimeError("No Claude API key")
        client = anthropic.Anthropic(api_key=key)
        return [m.id for m in client.models.list()]
    if provider == "gemini":
        import google.generativeai as genai
        key = api_key or get_key(db, uid, "gemini")
        if not key:
            raise RuntimeError("No Gemini API key")
        genai.configure(api_key=key)
        out = []
        for m in genai.list_models():
            methods = getattr(m, "supported_generation_methods", []) or []
            if "generateContent" in methods:
                out.append((m.name or "").replace("models/", ""))
        return out
    if provider == "ollama":
        import httpx
        cfg = get_config(db, uid)
        base = (base_url or cfg.get("ollama", {}).get("base_url") or "http://host.docker.internal:11434").rstrip("/")
        r = httpx.get(base + "/api/tags", timeout=15)
        r.raise_for_status()
        return [m.get("name") for m in r.json().get("models", []) if m.get("name")]
    raise RuntimeError("Unknown provider")


# ---------- higher-level features ----------
def _extract_json(text: str):
    if not text:
        return None
    m = re.search(r"[\[{].*[\]}]", text, re.DOTALL)
    if not m:
        return None
    try:
        return json.loads(m.group(0))
    except (ValueError, TypeError):
        return None


def ai_categorize(db: Session, uid: int, items: List[Dict], categories: List[str]) -> Dict[int, str]:
    result: Dict[int, str] = {}
    cats = [c for c in categories if c] or ["Others", "Unknown"]
    system = (
        "You are a personal-finance transaction categorizer. Assign each transaction to "
        "exactly one category from the provided list. If none fits, use 'Unknown'. "
        "Respond ONLY with a JSON object mapping the transaction id (string) to the chosen "
        "category name. No prose."
    )
    BATCH = 40
    for i in range(0, len(items), BATCH):
        chunk = items[i:i + BATCH]
        prompt = (
            f"Categories: {json.dumps(cats)}\n\n"
            f"Transactions: {json.dumps([{'id': it['id'], 'description': it.get('description', '')} for it in chunk])}\n\n"
            "Return JSON like {\"123\": \"Food & Dining\", ...}."
        )
        raw = complete(db, uid, system, prompt, max_tokens=1500)
        parsed = _extract_json(raw) or {}
        for k, v in parsed.items():
            try:
                tid = int(k)
            except (ValueError, TypeError):
                continue
            if v in cats or v == "Unknown":
                result[tid] = v
    return result


def is_configured(db: Session, uid: int) -> bool:
    """True if the user has at least one AI provider enabled -- used to skip
    users entirely in the automatic daily sweep (auto_categorize_user) rather
    than let every uncategorized user hit the 'AI is not configured' exception
    path in complete()."""
    return bool(get_config(db, uid).get("providers"))


_NUM_RE = re.compile(r"\d+")


def _norm_desc(desc: Optional[str]) -> str:
    d = _NUM_RE.sub("", (desc or "").upper())
    return " ".join(d.split())[:40]


def auto_categorize_user(db: Session, user_id: int, only_uncategorized: bool = True, limit: int = 200) -> dict:
    """Sends a batch of a user's transaction descriptions to their configured AI
    provider and applies the category it picks, deduped by normalized description
    (one AI call per unique merchant, not per transaction). Shared by the manual
    'AI Categorize' endpoint (app/api/endpoints/ai.py) and the daily
    ai.auto_categorize_all Celery task -- same logic either way, since the whole
    point of the periodic version is "the same result a human would have gotten
    by clicking the button, just without needing to click it".

    Each newly-picked category is remembered as an AutoRule (autorules.
    remember_category), which also retroactively fixes every other matching
    Uncategorized/Others transaction -- not just the ones in this batch.
    """
    from app.models.models import Transaction, Category
    from app.services.autorules import remember_category

    q = db.query(Transaction).filter(Transaction.user_id == user_id)
    if only_uncategorized:
        q = q.filter((Transaction.category.is_(None)) | (Transaction.category == "") |
                     (Transaction.category.in_(["Unknown", "Others"])))
    txns = q.order_by(Transaction.transaction_date.desc()).limit(max(1, min(limit, 500))).all()
    if not txns:
        return {"updated": 0, "considered": 0, "unique": 0, "rules_created": 0, "retroactively_fixed": 0}
    cats = [c.name for c in db.query(Category).filter(Category.user_id == user_id).all()]

    groups: Dict[str, list] = {}
    order: List[str] = []
    for t in txns:
        nd = _norm_desc(t.description)
        if nd not in groups:
            order.append(nd)
            groups[nd] = []
        groups[nd].append(t)
    rep_items = [{"id": i, "description": groups[nd][0].description or ""} for i, nd in enumerate(order)]

    mapping = ai_categorize(db, user_id, rep_items, cats)

    updated = 0
    rules_created = 0
    retroactively_fixed = 0
    for idx, cat in mapping.items():
        if idx < 0 or idx >= len(order) or not cat:
            continue
        for t in groups[order[idx]]:
            if t.category != cat:
                t.category = cat
                updated += 1
        created, fixed = remember_category(db, user_id, order[idx], cat)
        if created:
            rules_created += 1
            retroactively_fixed += fixed

    return {
        "updated": updated, "considered": len(txns), "unique": len(rep_items),
        "rules_created": rules_created, "retroactively_fixed": retroactively_fixed,
    }


def ai_insights(db: Session, uid: int, summary_text: str) -> str:
    system = (
        "You are a friendly personal-finance analyst. Given a spending summary, write a short "
        "practical insight (3-5 '-' bullets) about patterns, notable changes, and one actionable "
        "suggestion. Plain text, concise. Report all amounts in the exact currency stated in the "
        "summary (see its first line) — do NOT assume rupees or convert to any other currency."
    )
    return complete(db, uid, system, summary_text, max_tokens=400)


def ai_query(db: Session, uid: int, question: str, context_text: str) -> str:
    system = (
        "You are a personal-finance assistant. Answer the user's question using ONLY the financial "
        "data provided below. If the data is insufficient, say so. Be concise and specific with "
        "numbers. Amounts are in the user's base currency."
    )
    prompt = f"FINANCIAL DATA:\n{context_text}\n\nQUESTION: {question}"
    return complete(db, uid, system, prompt, max_tokens=600)


def ai_anomalies(db: Session, uid: int, transactions_text: str) -> list:
    system = (
        "You are a personal-finance anomaly detector. From the transactions provided, identify the "
        "unusual or noteworthy ones (unexpectedly large, rare merchants, possible duplicates, "
        "out-of-pattern spending). Respond ONLY with a JSON array of objects "
        "{\"description\":..., \"amount\":..., \"date\":..., \"reason\":...}. Max 10. No prose."
    )
    raw = complete(db, uid, system, transactions_text, max_tokens=1200)
    parsed = _extract_json(raw)
    return parsed if isinstance(parsed, list) else []


def ai_summary(db: Session, uid: int, summary_text: str) -> str:
    system = (
        "You are a personal-finance analyst writing a brief monthly report. Given the totals and "
        "category breakdown, write a clear 4-6 sentence summary: total income vs expense, biggest "
        "categories, notable changes, and one suggestion. Plain text. Report all amounts in the exact "
        "currency stated in the summary (see its first line) — do NOT assume rupees."
    )
    return complete(db, uid, system, summary_text, max_tokens=400)
