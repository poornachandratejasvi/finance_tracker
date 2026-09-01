"""One function per carrier, each hitting that carrier's public tracking
surface to fill in status updates between shipment emails (e.g. in-transit scan
events that never generate an email). These use the SAME lightweight,
captcha-free approach real unofficial trackers (rajatdhoot123/indian-courier-api,
cyberboysumanjay/CourierAPI, captn3m0/indiapost-tracker) use: no browser
automation, no captcha solving -- just the carrier's own public tracking
endpoint, parsed defensively.

Every function degrades to None on ANY failure (network error, non-2xx,
unexpected response shape) -- one carrier's endpoint changing shape must never
crash the refresh task for every other package. If a carrier is ever found to
require a real captcha, raise CaptchaRequiredError from that carrier's function
only (not done anywhere today) so the refresh task can distinguish "needs a
captcha fallback we haven't built" from an ordinary transient failure.
"""
import logging
from typing import Optional, Dict

import requests
from dateutil import parser as date_parser

logger = logging.getLogger(__name__)


def _parse_dt(value):
    """Carrier APIs return dates as strings in assorted formats -- normalize to
    a datetime object (or None) so callers never write a raw string into a
    DateTime column."""
    if not value:
        return None
    try:
        return date_parser.parse(str(value))
    except (ValueError, TypeError):
        return None

_TIMEOUT = 10
_HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; finance-tracker-package-tracker/1.0)"}


class CaptchaRequiredError(Exception):
    """Reserved extension seam -- not raised by any tracker in v1."""


def _normalize_status(raw_status: str) -> str:
    s = (raw_status or "").lower()
    if "deliver" in s and "out for" not in s and "undeliver" not in s:
        return "delivered"
    if "out for delivery" in s:
        return "out_for_delivery"
    if any(k in s for k in ("transit", "shipped", "dispatch", "picked", "booked")):
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


def _unsupported(carrier: str):
    def _track(tracking_number: str) -> Optional[Dict]:
        logger.info("No live tracker implemented yet for carrier %s (tracking_number=%s) -- email-only for now", carrier, tracking_number)
        return None
    return _track


_track_bluedart = _unsupported("bluedart")
_track_dtdc = _unsupported("dtdc")
_track_ekart = _unsupported("ekart")
_track_xpressbees = _unsupported("xpressbees")
_track_ecom_express = _unsupported("ecom_express")
_track_shadowfax = _unsupported("shadowfax")

CARRIER_TRACKERS = {
    "delhivery": _track_delhivery,
    "india_post": _track_india_post,
    "bluedart": _track_bluedart,
    "dtdc": _track_dtdc,
    "ekart": _track_ekart,
    "xpressbees": _track_xpressbees,
    "ecom_express": _track_ecom_express,
    "shadowfax": _track_shadowfax,
}


def track_package(carrier: str, tracking_number: str) -> Optional[Dict]:
    """Dispatch to the right carrier function. Returns None for 'amazon'/
    'flipkart'/'other' (no live tracker -- those stay email-only) or any
    carrier whose tracker function itself failed/isn't implemented yet. Never
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
