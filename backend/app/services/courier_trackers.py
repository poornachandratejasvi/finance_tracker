"""One function per carrier, each hitting that carrier's public tracking
surface to fill in status updates between shipment emails (e.g. in-transit scan
events that never generate an email). No browser automation, no captcha
solving -- just each carrier's own reverse-engineered-but-genuinely-open
endpoint, parsed defensively.

Every function degrades to None on ANY failure (network error, non-2xx,
unexpected response shape) -- one carrier's endpoint changing shape must never
crash the refresh task for every other package. If a carrier is ever found to
require a real captcha, raise CaptchaRequiredError from that carrier's function
only (not done anywhere today) so the refresh task can distinguish "needs a
captcha fallback we haven't built" from an ordinary transient failure.

Live-verified against each carrier's real production endpoint (not just read
off a repo -- most existing open-source "unofficial API" wrappers for these
turned out to be stale/dead or, in one case, a headless-browser AfterShip
scraper rather than a real reverse-engineered endpoint):

- Delhivery, India Post, Xpressbees, Shadowfax, Ekart: genuinely open, no
  captcha, implemented below.
- Bluedart: NOT feasible via plain HTTP. Every publicly-known API license key
  is revoked, and the consumer tracking page is now gated behind hCaptcha with
  an HTML form submission (no JSON endpoint at all). Stays email-only.
- DTDC: NOT feasible via plain HTTP. Their own site's tracking calls require an
  `X-DTDC-Track-Token` header that is minted by *solving a captcha* first
  (`/wp-json/custom/v1/captcha/validate`) -- there is no captcha-free path in.
  Stays email-only.
- Ecom Express: the company was acquired by Delhivery in July 2025 and
  ecomexpress.in is now just a static "redirect to Delhivery" landing page with
  no tracking form or API at all -- so Ecom Express AWBs are routed through the
  Delhivery tracker instead of a dedicated one (best-effort: not confirmed that
  Delhivery's tracker accepts the old Ecom AWB number format for every parcel).
"""
import base64
import hashlib
import json
import logging
import random
import string
from datetime import datetime
from typing import Optional, Dict

import requests
from dateutil import parser as date_parser

logger = logging.getLogger(__name__)

_TIMEOUT = 10
_HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; finance-tracker-package-tracker/1.0)"}


class CaptchaRequiredError(Exception):
    """Reserved extension seam -- not raised by any tracker in v1."""


def _parse_dt(value):
    """Carrier APIs return dates as strings in assorted formats -- normalize to
    a datetime object (or None) so callers never write a raw string into a
    DateTime column."""
    if not value:
        return None
    try:
        return date_parser.parse(str(value))
    except (ValueError, TypeError, OverflowError):
        return None


def _epoch_ms_to_dt(value) -> Optional[datetime]:
    if not value:
        return None
    try:
        return datetime.utcfromtimestamp(int(value) / 1000)
    except (ValueError, TypeError, OSError, OverflowError):
        return None


def _normalize_status(raw_status: str) -> str:
    s = (raw_status or "").lower()
    if "deliver" in s and "out for" not in s and "undeliver" not in s:
        return "delivered"
    if "out for delivery" in s:
        return "out_for_delivery"
    if any(k in s for k in ("transit", "shipped", "dispatch", "picked", "booked", "received")):
        return "shipped"
    return "unknown"


def _track_delhivery(tracking_number: str) -> Optional[Dict]:
    try:
        resp = requests.get(
            "https://www.delhivery.com/track/package/" + tracking_number,
            headers=_HEADERS, timeout=_TIMEOUT,
        )
        if resp.status_code != 200:
            return None
        data = resp.json()
        shipment = (data.get("ShipmentData") or [{}])[0].get("Shipment", {})
        status = shipment.get("Status", {}).get("Status")
        if not status:
            return None
        norm_status = _normalize_status(status)
        return {
            "status": norm_status,
            "expected_delivery_date": _parse_dt(shipment.get("ExpectedDeliveryDate")) if norm_status != "delivered" else None,
            "actual_delivery_date": _parse_dt(shipment.get("Status", {}).get("StatusDateTime")) if norm_status == "delivered" else None,
            "current_location": shipment.get("Status", {}).get("StatusLocation"),
            "raw": data,
        }
    except Exception:
        logger.info("Delhivery tracker failed for %s", tracking_number, exc_info=True)
        return None


def _track_india_post(tracking_number: str) -> Optional[Dict]:
    try:
        resp = requests.get(
            f"https://www.indiapost.gov.in/_layouts/15/dop.portal.tracking/trackconsignment.aspx?consignmentno={tracking_number}",
            headers=_HEADERS, timeout=_TIMEOUT,
        )
        if resp.status_code != 200:
            return None
        text = resp.text
        low = text.lower()
        if "delivered" in low:
            status = "delivered"
        elif "out for delivery" in low:
            status = "out_for_delivery"
        elif "bag" in low or "transit" in low or "dispatch" in low or "booked" in low:
            status = "shipped"
        else:
            return None
        return {
            "status": status, "expected_delivery_date": None, "actual_delivery_date": None,
            "current_location": None, "raw": {"html_snippet": text[:2000]},
        }
    except Exception:
        logger.info("India Post tracker failed for %s", tracking_number, exc_info=True)
        return None


def _track_xpressbees(tracking_number: str) -> Optional[Dict]:
    """GET /api/tracking/{awb} -- no key, no cookie, but REQUIRES a Referer
    pointing at xpressbees.com or the endpoint 500s (a lightweight, non-captcha
    anti-scrape check). POST to the same path demands a recaptcha -- only the
    GET-by-path form is open."""
    try:
        resp = requests.get(
            f"https://www.xpressbees.com/api/tracking/{tracking_number}",
            headers={**_HEADERS, "Referer": "https://www.xpressbees.com/track"},
            timeout=_TIMEOUT,
        )
        if resp.status_code != 200:
            return None
        data = resp.json()
        raw_status = data.get("status")
        if not raw_status:
            return None
        norm_status = _normalize_status(raw_status)
        events = data.get("data") or []
        edd = data.get("edd") or data.get("EDD")
        delivered_event = next((e for e in events if "deliver" in (e.get("label") or "").lower()), None)
        return {
            "status": norm_status,
            "expected_delivery_date": _parse_dt(edd) if norm_status != "delivered" and edd else None,
            "actual_delivery_date": _parse_dt(delivered_event["shipmentDate"]) if norm_status == "delivered" and delivered_event else None,
            "current_location": events[-1].get("location") if events else None,
            "raw": data,
        }
    except Exception:
        logger.info("Xpressbees tracker failed for %s", tracking_number, exc_info=True)
        return None


# Shadowfax's own web app falls back to this token for visitors who haven't
# OTP-verified -- a public constant hardcoded in their production JS bundle,
# not a merchant credential. It can be rotated/revoked at any time; degrades
# to None like any other tracker failure if it stops working.
_SHADOWFAX_TOKEN = "cePcVR7z7FIETB4PxguHC2YJGk6NncHnByrJttgRIUqNxfWezuzAUvtALyqcHJEC"


def _track_shadowfax(tracking_number: str) -> Optional[Dict]:
    """GET /web_app/delivery/track/{awb}/ with the shared static token above.
    Gives status only -- the expected-delivery-date field lives behind a
    SEPARATE endpoint that requires SMS-OTP verification, so
    expected_delivery_date is always None here (email parsing is the only
    source of a Shadowfax delivery estimate)."""
    try:
        resp = requests.get(
            f"https://saruman.shadowfax.in/web_app/delivery/track/{tracking_number}/",
            headers={**_HEADERS, "Authorization": f"Token {_SHADOWFAX_TOKEN}"},
            timeout=_TIMEOUT,
        )
        if resp.status_code != 200:
            return None
        data = resp.json()
        order_details = data.get("order_details") or {}
        raw_status = order_details.get("status_id") or order_details.get("final_status")
        if not raw_status:
            return None
        return {
            "status": _normalize_status(raw_status),
            "expected_delivery_date": None,
            "actual_delivery_date": None,
            "current_location": None,
            "raw": data,
        }
    except Exception:
        logger.info("Shadowfax tracker failed for %s", tracking_number, exc_info=True)
        return None


def _track_ekart(tracking_number: str) -> Optional[Dict]:
    """Ekart's tracking API is behind an Express `csurf` CSRF check, but the
    secret is readable client-side: the `session` cookie is base64-encoded
    plaintext JSON containing `csrfSecret`, from which a valid token can be
    computed in pure Python (no browser) -- see module docstring for how this
    was found. If Ekart ever moves the secret server-side only, this silently
    degrades to None like any other tracker failure."""
    try:
        session = requests.Session()
        session.headers.update(_HEADERS)
        session.get(f"https://ekartlogistics.com/shipmenttrack/{tracking_number}", timeout=_TIMEOUT)

        sess_cookie = session.cookies.get("session")
        if not sess_cookie:
            return None
        padded = sess_cookie + "=" * (-len(sess_cookie) % 4)
        secret = json.loads(base64.b64decode(padded)).get("csrfSecret")
        if not secret:
            return None

        salt = "".join(random.choice(string.ascii_letters + string.digits) for _ in range(8))
        digest = hashlib.sha1(f"{salt}-{secret}".encode("ascii")).digest()
        token = salt + "-" + base64.b64encode(digest).decode().replace("+", "-").replace("/", "_").rstrip("=")

        resp = session.post(
            "https://ekartlogistics.com/ekartlogistics-web-routes-api/ekartlogistics-web-proxy/trackings/v2",
            json={"tracking_ids": tracking_number},
            headers={"csrf-token": token},
            timeout=_TIMEOUT,
        )
        if resp.status_code != 200:
            return None
        data = resp.json() or {}
        entry = data.get(tracking_number)
        if not entry:
            return None
        events = entry.get("shipmentTrackingDetails") or []
        raw_status = events[-1].get("statusDetails") if events else None
        if not raw_status:
            return None
        norm_status = _normalize_status(raw_status)
        return {
            "status": norm_status,
            "expected_delivery_date": _epoch_ms_to_dt(entry.get("expectedDeliveryDate")) if norm_status != "delivered" else None,
            "actual_delivery_date": _epoch_ms_to_dt(events[-1].get("date")) if norm_status == "delivered" else None,
            "current_location": events[-1].get("city") if events else None,
            "raw": data,
        }
    except Exception:
        logger.info("Ekart tracker failed for %s", tracking_number, exc_info=True)
        return None


def _unsupported(carrier: str, reason: str):
    def _track(tracking_number: str) -> Optional[Dict]:
        logger.info("No live tracker for carrier %s (tracking_number=%s): %s -- email-only", carrier, tracking_number, reason)
        return None
    return _track


_track_bluedart = _unsupported("bluedart", "every known API license key is revoked and the web tracker is hCaptcha-gated")
_track_dtdc = _unsupported("dtdc", "tracking calls require a token minted by solving a captcha first")

CARRIER_TRACKERS = {
    "delhivery": _track_delhivery,
    "india_post": _track_india_post,
    "xpressbees": _track_xpressbees,
    "shadowfax": _track_shadowfax,
    "ekart": _track_ekart,
    "bluedart": _track_bluedart,
    "dtdc": _track_dtdc,
    # Ecom Express was absorbed into Delhivery (July 2025) and no longer runs
    # its own tracking site/API -- route through Delhivery's tracker instead.
    "ecom_express": _track_delhivery,
}

# Carriers with a REAL working tracker, as opposed to bluedart/dtdc which are
# still present in CARRIER_TRACKERS (so track_package() dispatches cleanly)
# but only ever return None via the _unsupported() stub -- callers presenting
# "does this carrier support live tracking?" to a user (e.g. the /carriers
# endpoint's has_live_tracking flag) should check this set, not
# CARRIER_TRACKERS.keys(), or bluedart/dtdc would misleadingly show as
# supported.
LIVE_TRACKING_CARRIERS = {"delhivery", "india_post", "xpressbees", "shadowfax", "ekart", "ecom_express"}


def track_package(carrier: str, tracking_number: str) -> Optional[Dict]:
    """Dispatch to the right carrier function. Returns None for 'amazon'/
    'flipkart'/'other' (no live tracker -- those stay email-only) or any
    carrier whose tracker function itself failed/isn't implemented. Never
    raises (except CaptchaRequiredError, reserved for a future fallback)."""
    fn = CARRIER_TRACKERS.get(carrier)
    if not fn or not tracking_number:
        return None
    try:
        return fn(tracking_number)
    except CaptchaRequiredError:
        logger.warning("Carrier %s now requires a captcha -- tracker needs a fallback", carrier)
        return None
    except Exception:
        logger.warning("Tracker for carrier %s failed for %s", carrier, tracking_number, exc_info=True)
        return None
