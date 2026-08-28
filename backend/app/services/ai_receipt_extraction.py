"""AI-assisted structured extraction from a receipt photo's raw OCR text.
Unlike bank SMS/statement parsing, receipts have no fixed layout (every store,
font and printer differs), so there's no viable regex path here -- this is
always the primary extraction step, not a fallback.
"""
import logging
from datetime import datetime

from sqlalchemy.orm import Session

from app.services import ai_service

logger = logging.getLogger(__name__)


def extract_receipt_transaction(db: Session, uid: int, ocr_text: str) -> dict:
    """Ask the user's configured AI provider to pull a purchase out of a
    receipt's raw OCR text. Returns {} (never raises) if no provider is
    configured, the call fails, or no amount comes back.

    Returned dict keys: amount (float), description (str), transaction_date
    (str YYYY-MM-DD or None), category (str or None).
    """
    if not ocr_text or not ocr_text.strip():
        return {}

    today = datetime.utcnow().strftime("%Y-%m-%d")
    system = (
        "You extract a purchase from raw OCR text of a receipt photo. OCR "
        "text is noisy: misread characters, jumbled line order, stray symbols. "
        f"Today's date is {today} -- use it to fill in a missing year or resolve "
        "a relative/partial date. Identify: the TOTAL amount actually paid (not "
        "a subtotal -- prefer a line labelled 'total' or 'grand total', or the "
        "largest amount near the bottom of the receipt), the merchant/store name "
        "(for the description), the purchase date if present, a likely spending "
        "category (e.g. Groceries, Dining, Fuel, Shopping, Pharmacy) if "
        "reasonably inferable, the individual line items with their prices (name "
        "+ price per item, skip a line you can't confidently parse as a "
        "purchased item rather than guessing), the tax amount, and the tip/"
        "service charge amount. Respond ONLY with a JSON object: {\"amount\": "
        '<number or null>, "description": "<merchant name or null>", '
        '"transaction_date": "<YYYY-MM-DD or null>", "category": "<string or '
        'null>", "items": [{"name": "<string>", "amount": <number>}, ...] (empty '
        'array if none confidently identified), "tax": <number or null>, "tip": '
        '<number or null>}. No prose, no markdown fences. Use null for anything '
        "you can't confidently identify."
    )
    prompt = f"RECEIPT OCR TEXT:\n{ocr_text.strip()[:2000]}"

    try:
        raw = ai_service.complete(db, uid, system, prompt, max_tokens=500)
    except Exception as e:
        logger.info("AI receipt extraction unavailable: %s", str(e)[:150])
        return {}

    data = ai_service._extract_json(raw)
    if not isinstance(data, dict):
        return {}

    amount = data.get("amount")
    if not (isinstance(amount, (int, float)) and amount > 0):
        return {}

    description = data.get("description")
    date = data.get("transaction_date")
    category = data.get("category")

    items = []
    for item in (data.get("items") or []):
        if not isinstance(item, dict):
            continue
        name = item.get("name")
        item_amount = item.get("amount")
        if isinstance(name, str) and name.strip() and isinstance(item_amount, (int, float)) and item_amount > 0:
            items.append({"name": name.strip()[:100], "amount": round(float(item_amount), 2)})

    tax = data.get("tax")
    tip = data.get("tip")

    return {
        "amount": float(amount),
        "description": description.strip()[:140] if isinstance(description, str) and description.strip() else "Receipt purchase",
        "transaction_date": date if isinstance(date, str) and len(date) == 10 else None,
        "category": category.strip() if isinstance(category, str) and category.strip() else None,
        "items": items,
        "tax": round(float(tax), 2) if isinstance(tax, (int, float)) and tax > 0 else None,
        "tip": round(float(tip), 2) if isinstance(tip, (int, float)) and tip > 0 else None,
    }
