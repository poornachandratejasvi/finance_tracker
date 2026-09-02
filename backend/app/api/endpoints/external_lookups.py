"""API surface for an external browser-automation agent (e.g. OpenClaw): list
pending work, submit a result. See external_lookup_service.py for the queue
itself and docs/external-integrations.md for the integration guide.

Authenticated the same flexible way as packages/subscriptions/calendar (API
token OR session) -- see app.core.api_auth.get_current_user_flexible. All
queries are scoped to the token's owning user, same as everywhere else."""
import json
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.time_utils import utcnow
from app.core.api_auth import get_current_user_flexible
from app.models.models import User, ExternalLookupRequest

router = APIRouter()


class LookupComplete(BaseModel):
    result: Optional[dict] = None
    error: Optional[str] = None


def _request_dict(r: ExternalLookupRequest) -> dict:
    try:
        input_payload = json.loads(r.input_payload)
    except (ValueError, TypeError):
        input_payload = None
    try:
        result_payload = json.loads(r.result_payload) if r.result_payload else None
    except (ValueError, TypeError):
        result_payload = None
    return {
        "id": r.id,
        "request_type": r.request_type,
        "status": r.status,
        "input": input_payload,
        "result": result_payload,
        "error_message": r.error_message,
        "created_at": r.created_at.isoformat() if r.created_at else None,
        "completed_at": r.completed_at.isoformat() if r.completed_at else None,
    }


@router.get("/pending", response_model=None)
def list_pending_lookups(
    request_type: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_flexible),
) -> List[dict]:
    """What an external agent should poll -- everything this user has queued
    that nothing has fulfilled yet."""
    q = db.query(ExternalLookupRequest).filter(
        ExternalLookupRequest.user_id == current_user.id,
        ExternalLookupRequest.status == "pending",
    )
    if request_type:
        q = q.filter(ExternalLookupRequest.request_type == request_type)
    rows = q.order_by(ExternalLookupRequest.created_at.asc()).all()
    return [_request_dict(r) for r in rows]


@router.get("/{request_id}")
def get_lookup(request_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user_flexible)):
    r = db.query(ExternalLookupRequest).filter(
        ExternalLookupRequest.id == request_id, ExternalLookupRequest.user_id == current_user.id
    ).first()
    if not r:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Lookup request not found")
    return _request_dict(r)


@router.post("/{request_id}/complete")
def complete_lookup(
    request_id: int,
    payload: LookupComplete,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_flexible),
):
    """Submit the outcome of a lookup -- either `result` (shape depends on
    request_type; for 'courier_tracking' see courier_trackers.track_package's
    return value: status/expected_delivery_date/actual_delivery_date) or
    `error` (a human-readable reason it couldn't be fulfilled). Applying the
    result to whatever it's about (e.g. updating a Package) happens here, not
    left to the caller."""
    r = db.query(ExternalLookupRequest).filter(
        ExternalLookupRequest.id == request_id, ExternalLookupRequest.user_id == current_user.id
    ).first()
    if not r:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Lookup request not found")
    if r.status != "pending":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Request already {r.status}")

    if payload.error and not payload.result:
        r.status = "failed"
        r.error_message = payload.error
        r.completed_at = utcnow()
        db.commit()
        return _request_dict(r)

    if not payload.result:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Provide either `result` or `error`.")

    if r.request_type == "courier_tracking":
        from app.services.external_lookup_service import apply_courier_tracking_result
        apply_courier_tracking_result(db, r, payload.result)

    r.status = "completed"
    r.result_payload = json.dumps(payload.result)
    r.completed_at = utcnow()
    db.commit()
    db.refresh(r)
    return _request_dict(r)
