"""Generic queue for handing work Finance Tracker can't do itself (no
captcha-free API exists) to an external browser-automation agent (e.g.
OpenClaw) -- see ExternalLookupRequest's docstring for the design rationale.

Today's only request_type is 'courier_tracking' (Bluedart/DTDC, both confirmed
captcha-gated -- see courier_trackers.py's module docstring). Adding a second
request_type later means: a new enqueue_* function here, a new branch in
apply_result, and whatever calls enqueue_* -- the queue/API surface itself
doesn't change.
"""
import json
import logging
from typing import Optional

from app.models.models import ExternalLookupRequest, Package

logger = logging.getLogger(__name__)


def enqueue_courier_tracking(db, user_id: int, carrier: str, tracking_number: str) -> ExternalLookupRequest:
    """Create a pending lookup request, or return the existing one if this
    exact (user, carrier, tracking_number) already has one pending -- avoids
    queuing a fresh request every 6-hour refresh cycle for a package OpenClaw
    hasn't gotten to yet."""
    existing = (
        db.query(ExternalLookupRequest)
        .filter(
            ExternalLookupRequest.user_id == user_id,
            ExternalLookupRequest.request_type == "courier_tracking",
            ExternalLookupRequest.status == "pending",
        )
        .all()
    )
    for req in existing:
        try:
            payload = json.loads(req.input_payload)
        except (ValueError, TypeError):
            continue
        if payload.get("carrier") == carrier and payload.get("tracking_number") == tracking_number:
            return req

    req = ExternalLookupRequest(
        user_id=user_id,
        request_type="courier_tracking",
        status="pending",
        input_payload=json.dumps({"carrier": carrier, "tracking_number": tracking_number}),
    )
    db.add(req)
    db.commit()
    db.refresh(req)
    return req


def apply_courier_tracking_result(db, request: ExternalLookupRequest, result: dict) -> Optional[Package]:
    """Apply a completed courier_tracking result to the matching Package --
    same fields/shape as courier_trackers.track_package's return value
    (status, expected_delivery_date, actual_delivery_date), so this slots into
    the exact same update logic as packages.refresh_package_now."""
    from app.api.endpoints.packages import _parse_date
    from app.core.time_utils import utcnow

    payload = json.loads(request.input_payload)
    pkg = (
        db.query(Package)
        .filter(
            Package.user_id == request.user_id,
            Package.carrier == payload["carrier"],
            Package.tracking_number == payload["tracking_number"],
        )
        .first()
    )
    if not pkg:
        return None

    if result.get("status") and result["status"] != "unknown":
        pkg.status = result["status"]
    if result.get("expected_delivery_date"):
        pkg.expected_delivery_date = _parse_date(result["expected_delivery_date"])
    if result.get("actual_delivery_date"):
        pkg.actual_delivery_date = _parse_date(result["actual_delivery_date"])
    pkg.last_checked_at = utcnow()
    pkg.last_tracker_error = None
    db.commit()
    db.refresh(pkg)
    return pkg
