"""Parses shipping-confirmation / out-for-delivery / delivered emails from
Amazon.in, Flipkart, and Indian couriers into normalized dicts a Package row
can be created/updated from -- mirrors alert_email_service.py's registry shape:
one parser function per sender, a (sender_substring, parser_fn) list checked in
order, and a dispatch function that never raises.

Every parser returns a LIST of dicts (usually 0 or 1 entries) rather than a
single dict, because Amazon's "Ordered"/"Shipped" digest emails can bundle
MULTIPLE distinct orders into one message (confirmed against real inbox
samples -- see _amazon below) -- one Package must be created/updated per order
block, not just the first one found.

The Amazon parser below was built and verified against REAL emails pulled from
the user's own inbox (not guessed), following the same principle as
alert_email_service.py. Flipkart and the courier-direct parsers were NOT --
no Flipkart/courier shipment emails existed in the scanned inbox at the time
this was written, so those regexes are a best-effort starting point from the
couriers' publicly-documented formats and should be tightened against real
samples once they're actually seen.
"""
import re
import logging
from datetime import datetime, timedelta
from typing import Optional, Dict, List

from dateutil import parser as date_parser

logger = logging.getLogger(__name__)

_WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]


def _naive(dt) -> Optional[datetime]:
    if dt is None:
        return None
    if getattr(dt, "tzinfo", None) is not None:
        return dt.replace(tzinfo=None)
    return dt


def _parse_relative_phrase(phrase: str, base: Optional[datetime]) -> Optional[datetime]:
    """Amazon's delivery-date phrase is one of: 'today', 'tomorrow', 'yesterday',
    a bare weekday name ('Thursday'), or an explicit day+month ('7 September') --
    each optionally followed by a time range ('tomorrow 8 am - 12 pm') that we
    ignore, keeping just the date."""
    if not phrase:
        return None
    base = _naive(base) or datetime.utcnow()
    day0 = base.replace(hour=0, minute=0, second=0, microsecond=0)

    first_word = phrase.strip().split()[0].lower().rstrip(",") if phrase.strip() else ""
    if first_word == "today":
        return day0
    if first_word == "tomorrow":
        return day0 + timedelta(days=1)
    if first_word == "yesterday":
        return day0 - timedelta(days=1)
    if first_word in _WEEKDAYS:
        target = _WEEKDAYS.index(first_word)
        days_ahead = (target - day0.weekday()) % 7
        days_ahead = days_ahead or 7
        return day0 + timedelta(days=days_ahead)

    try:
        return date_parser.parse(phrase, default=day0, fuzzy=True)
    except (ValueError, OverflowError):
        return None


def _amazon_status_from_subject(subject: str) -> Optional[str]:
    # Usually "Shipped: “item...”" but also seen as e.g. "Delivered in 8
    # hrs 10 mins" (no colon) -- match on the leading status word alone rather
    # than requiring ": " after it.
    s = (subject or "").strip().lower()
    if s.startswith("out for delivery"):
        return "out_for_delivery"
    if s.startswith("ordered"):
        return "ordered"
    if s.startswith("shipped"):
        return "shipped"
    if s.startswith("delivered"):
        return "delivered"
    return None


def _amazon(sender, subject, body, received_date=None) -> List[Dict]:
    status = _amazon_status_from_subject(subject)
    if status is None:
        return []

    order_matches = list(re.finditer(r"Order #\s*([\d-]+)", body))
    if not order_matches:
        return []

    results = []
    for i, om in enumerate(order_matches):
        order_id = om.group(1)
        pre_start = order_matches[i - 1].end() if i > 0 else 0
        pre_segment = body[pre_start:om.start()]
        post_end = order_matches[i + 1].start() if i + 1 < len(order_matches) else len(body)
        post_segment = body[om.end():post_end]

        item_m = re.search(r"\*\s*(.+?)\n\s*Quantity", post_segment, re.DOTALL)
        item_description = re.sub(r"\s+", " ", item_m.group(1)).strip() if item_m else None

        url_m = re.search(
            r"(https?://(?:www\.)?amazon\.in/(?:progress-tracker/package|your-orders/order-details)\?\S+)",
            post_segment,
        )
        tracking_url = url_m.group(1) if url_m else None

        expected_delivery_date = None
        actual_delivery_date = None
        if status == "delivered":
            delivered_m = re.search(r"Delivered\s+([^\n]+)", pre_segment, re.IGNORECASE)
            if delivered_m:
                actual_delivery_date = _parse_relative_phrase(delivered_m.group(1), received_date)
        else:
            arriving_m = re.search(r"Arriving\s+([^\n]+)", pre_segment, re.IGNORECASE)
            if arriving_m:
                expected_delivery_date = _parse_relative_phrase(arriving_m.group(1), received_date)

        results.append({
            "carrier": "amazon", "merchant": "Amazon.in", "order_id": order_id,
            "tracking_number": None, "item_description": item_description,
            "status": status, "expected_delivery_date": expected_delivery_date,
            "actual_delivery_date": actual_delivery_date, "tracking_url": tracking_url,
        })
    return results


def _flipkart(sender, subject, body, received_date=None) -> List[Dict]:
    text = f"{subject}\n{body}"

    order_m = re.search(r"Order\s*ID[:\s]+(OD\w+)", text, re.IGNORECASE)
    order_id = order_m.group(1) if order_m else None

    tracking_m = re.search(r"(?:Tracking ID|AWB|Waybill)[:\s#]+([A-Za-z0-9]{6,})", text, re.IGNORECASE)
    tracking_number = tracking_m.group(1) if tracking_m else None

    url_m = re.search(r"(https?://(?:www\.)?flipkart\.com/[^\s\"'<>]*track[^\s\"'<>]*)", text, re.IGNORECASE)
    tracking_url = url_m.group(1) if url_m else None

    item_m = re.search(r"(?:your|the)\s+([A-Za-z0-9 ,.\-]{5,80}?)\s+(?:has been|is out|will be)", text, re.IGNORECASE)
    item_description = item_m.group(1).strip() if item_m else None

    low = text.lower()
    if "delivered" in low and "out for delivery" not in low:
        status = "delivered"
    elif "out for delivery" in low:
        status = "out_for_delivery"
    elif "shipped" in low or "on its way" in low or "dispatched" in low:
        status = "shipped"
    elif "order confirmed" in low or "order placed" in low:
        status = "ordered"
    else:
        return []

    if status == "delivered":
        return [{
            "carrier": "flipkart", "merchant": "Flipkart", "order_id": order_id,
            "tracking_number": tracking_number, "item_description": item_description,
            "status": "delivered", "expected_delivery_date": None,
            "actual_delivery_date": received_date, "tracking_url": tracking_url,
        }]

    date_m = re.search(
        r"(?:expected by|will arrive by|arriving|delivery by)[:\s]+([A-Za-z]+,?\s*\d{1,2}\s+[A-Za-z]+,?\s*\d{0,4})",
        text, re.IGNORECASE,
    )
    expected_delivery_date = _parse_relative_phrase(date_m.group(1), received_date) if date_m else None

    return [{
        "carrier": "flipkart", "merchant": "Flipkart", "order_id": order_id,
        "tracking_number": tracking_number, "item_description": item_description,
        "status": status, "expected_delivery_date": expected_delivery_date,
        "actual_delivery_date": None, "tracking_url": tracking_url,
    }]


def _generic_courier(carrier: str, tracking_url_fmt: Optional[str] = None):
    """Most courier SMS-gateway-style emails ('Your shipment AWB123 is out for
    delivery') share this same loose shape regardless of carrier -- one factory
    instead of eight near-identical functions."""

    def _parse(sender, subject, body, received_date=None) -> List[Dict]:
        text = f"{subject}\n{body}"
        tracking_m = re.search(r"(?:AWB|Tracking (?:ID|Number|number)|Consignment)[:\s#]*([A-Za-z0-9]{6,})", text, re.IGNORECASE)
        tracking_number = tracking_m.group(1) if tracking_m else None

        low = text.lower()
        if "delivered" in low:
            status = "delivered"
        elif "out for delivery" in low:
            status = "out_for_delivery"
        elif "shipped" in low or "dispatched" in low or "picked up" in low or "in transit" in low:
            status = "shipped"
        else:
            return []

        date_m = re.search(
            r"(?:expected|delivery by|arriving)[:\s]+([A-Za-z]+,?\s*\d{1,2}\s+[A-Za-z]+,?\s*\d{0,4})",
            text, re.IGNORECASE,
        )
        expected_delivery_date = _parse_relative_phrase(date_m.group(1), received_date) if date_m else None

        return [{
            "carrier": carrier, "merchant": None, "order_id": None,
            "tracking_number": tracking_number, "item_description": None,
            "status": status,
            "expected_delivery_date": expected_delivery_date if status != "delivered" else None,
            "actual_delivery_date": received_date if status == "delivered" else None,
            "tracking_url": tracking_url_fmt.format(tracking_number) if (tracking_url_fmt and tracking_number) else None,
        }]

    return _parse


_track_delhivery = _generic_courier("delhivery", "https://www.delhivery.com/track/package/{}")
_track_bluedart = _generic_courier("bluedart", "https://www.bluedart.com/tracking?awb={}")
_track_dtdc = _generic_courier("dtdc", "https://www.dtdc.in/tracking?strTrackingNo={}")
_track_ekart = _generic_courier("ekart", None)
_track_india_post = _generic_courier("india_post", "https://www.indiapost.gov.in/_layouts/15/dop.portal.tracking/trackconsignment.aspx?consignmentno={}")
_track_xpressbees = _generic_courier("xpressbees", "https://www.xpressbees.com/track?awbNo={}")
_track_ecom_express = _generic_courier("ecom_express", "https://ecomexpress.in/tracking/?awb_field={}")
_track_shadowfax = _generic_courier("shadowfax", None)


# (sender substring match, parser function) — checked in order, first match wins.
# The three Amazon senders below were confirmed against real inbox mail; the
# rest are unverified best-effort (see module docstring).
SHIPMENT_PARSERS = [
    ("shipment-tracking@amazon.in", _amazon),
    ("auto-confirm@amazon.in", _amazon),
    ("order-update@amazon.in", _amazon),
    ("flipkart.com", _flipkart),
    ("delhivery.com", _track_delhivery),
    ("bluedart.com", _track_bluedart),
    ("dtdc.com", _track_dtdc),
    ("ekartlogistics.com", _track_ekart),
    ("indiapost.gov.in", _track_india_post),
    ("xpressbees.com", _track_xpressbees),
    ("ecomexpress.in", _track_ecom_express),
    ("shadowfax.in", _track_shadowfax),
]


def parse_shipment_email(sender: str, subject: str, body: str, received_date=None) -> List[Dict]:
    """Return a list of {carrier, merchant, order_id, tracking_number,
    item_description, status, expected_delivery_date, actual_delivery_date,
    tracking_url} dicts -- usually 0 or 1, but an Amazon digest email can cover
    multiple distinct orders in one message. Never raises (a template change
    degrades to "no packages found", not a broken sync)."""
    sender_lower = (sender or "").lower()
    for sender_match, parser in SHIPMENT_PARSERS:
        if sender_match in sender_lower:
            try:
                return parser(sender, subject, body, received_date=received_date) or []
            except Exception:
                logger.warning("Shipment parser for %s raised on a message", sender_match, exc_info=True)
                return []
    return []
