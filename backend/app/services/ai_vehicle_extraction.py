"""AI-assisted structured extraction from a photo of a vehicle RC (registration
certificate) or an insurance policy document/card. Same shape as
ai_receipt_extraction.py: OCR text in, best-guess structured fields out, no
non-AI fallback (document layouts vary too much for a regex parser)."""
import logging
from datetime import datetime

from sqlalchemy.orm import Session

from app.services import ai_service

logger = logging.getLogger(__name__)


def extract_vehicle_document(db: Session, uid: int, ocr_text: str, doc_type: str) -> dict:
    """doc_type is "rc" or "insurance". Returns {} (never raises) if no
    provider is configured, the call fails, or nothing useful comes back."""
    if not ocr_text or not ocr_text.strip():
        return {}

    today = datetime.utcnow().strftime("%Y-%m-%d")
    if doc_type == "insurance":
        system = (
            "You extract motor insurance policy details from raw OCR text of a "
            "policy document or insurance card. OCR text is noisy: misread "
            f"characters, jumbled line order. Today's date is {today} -- use it "
            "to resolve a partial/relative date. Identify: the vehicle "
            "registration number, the insurance provider/company name, the "
            "policy number, the policy type (third_party or comprehensive -- "
            "guess comprehensive if unclear), the premium amount paid, the "
            "policy start date, and the policy expiry/valid-until date. Respond "
            'ONLY with a JSON object: {"registration_number": "<string or '
            'null>", "provider": "<string or null>", "policy_number": "<string '
            'or null>", "policy_type": "third_party" or "comprehensive" or '
            'null, "premium_amount": <number or null>, "start_date": "<YYYY-'
            'MM-DD or null>", "expiry_date": "<YYYY-MM-DD or null>"}. No prose, '
            "no markdown fences. Use null for anything you can't confidently "
            "identify."
        )
    else:
        system = (
            "You extract vehicle registration certificate (RC) details from raw "
            "OCR text. OCR text is noisy: misread characters, jumbled line "
            "order. Identify: the registration number, the vehicle make "
            "(manufacturer, e.g. Maruti Suzuki, Honda), the model (e.g. Swift, "
            "Activa), and the fuel type (petrol, diesel, electric, cng, or "
            'hybrid). Respond ONLY with a JSON object: {"registration_number": '
            '"<string or null>", "make": "<string or null>", "model": "<string '
            'or null>", "fuel_type": "<string or null>"}. No prose, no markdown '
            "fences. Use null for anything you can't confidently identify."
        )
    prompt = f"DOCUMENT OCR TEXT:\n{ocr_text.strip()[:2000]}"

    try:
        raw = ai_service.complete(db, uid, system, prompt, max_tokens=250)
    except Exception as e:
        logger.info("AI vehicle-document extraction unavailable: %s", str(e)[:150])
        return {}

    data = ai_service._extract_json(raw)
    if not isinstance(data, dict):
        return {}

    def _clean(key, max_len=140):
        v = data.get(key)
        return v.strip()[:max_len] if isinstance(v, str) and v.strip() else None

    result = {k: _clean(k) for k in
               (["registration_number", "provider", "policy_number", "start_date", "expiry_date"]
                if doc_type == "insurance" else
                ["registration_number", "make", "model", "fuel_type"])}
    if doc_type == "insurance":
        ptype = data.get("policy_type")
        result["policy_type"] = ptype if ptype in ("third_party", "comprehensive") else None
        premium = data.get("premium_amount")
        result["premium_amount"] = float(premium) if isinstance(premium, (int, float)) and premium > 0 else None

    if not any(result.values()):
        return {}
    return result
