"""Package/shipment tracking CRUD -- manual entries plus rows auto-created by
shipment_sync_service.py from parsed shipping emails. See courier_trackers.py
for the live-tracking-refresh side (Phase B)."""
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.time_utils import utcnow
from app.core.api_auth import get_current_user_flexible, require_write_access_flexible
from app.models.models import User, Package

router = APIRouter()

_CARRIER_LABELS = {
    "amazon": "Amazon.in",
    "flipkart": "Flipkart",
    "delhivery": "Delhivery",
    "india_post": "India Post",
    "bluedart": "Bluedart",
    "dtdc": "DTDC",
    "ekart": "Ekart",
    "xpressbees": "Xpressbees",
    "ecom_express": "Ecom Express",
    "shadowfax": "Shadowfax",
    "other": "Other",
}


def _carriers() -> list:
    # has_live_tracking / has_external_lookup are derived from
    # courier_trackers.py's two carrier sets (not hand-duplicated here) so this
    # list can never drift out of sync with which carriers actually work.
    from app.services.courier_trackers import LIVE_TRACKING_CARRIERS, BROWSER_AUTOMATION_CARRIERS

    return [
        {
            "key": key, "label": label,
            "has_live_tracking": key in LIVE_TRACKING_CARRIERS,
            "has_external_lookup": key in BROWSER_AUTOMATION_CARRIERS,
        }
        for key, label in _CARRIER_LABELS.items()
    ]


def _parse_date(s: Optional[str]) -> Optional[datetime]:
    if not s:
        return None
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00")).replace(tzinfo=None)
    except (ValueError, TypeError):
        return None


class PackageCreate(BaseModel):
    carrier: str
    tracking_number: Optional[str] = None
    merchant: Optional[str] = None
    order_id: Optional[str] = None
    item_description: Optional[str] = None
    status: Optional[str] = "ordered"
    expected_delivery_date: Optional[str] = None
    tracking_url: Optional[str] = None
    notes: Optional[str] = None


class PackageUpdate(BaseModel):
    carrier: Optional[str] = None
    tracking_number: Optional[str] = None
    merchant: Optional[str] = None
    order_id: Optional[str] = None
    item_description: Optional[str] = None
    status: Optional[str] = None
    expected_delivery_date: Optional[str] = None
    actual_delivery_date: Optional[str] = None
    tracking_url: Optional[str] = None
    notes: Optional[str] = None


def _package_dict(p: Package) -> dict:
    return {
        "id": p.id,
        "source": p.source,
        "carrier": p.carrier,
        "merchant": p.merchant,
        "tracking_number": p.tracking_number,
        "order_id": p.order_id,
        "item_description": p.item_description,
        "status": p.status,
        "expected_delivery_date": p.expected_delivery_date.isoformat() if p.expected_delivery_date else None,
        "actual_delivery_date": p.actual_delivery_date.isoformat() if p.actual_delivery_date else None,
        "tracking_url": p.tracking_url,
        "last_checked_at": p.last_checked_at.isoformat() if p.last_checked_at else None,
        "last_tracker_error": p.last_tracker_error,
        "notes": p.notes,
        "created_at": p.created_at.isoformat() if p.created_at else None,
    }


def _get_package(db: Session, package_id: int, user_id: int) -> Package:
    p = db.query(Package).filter(Package.id == package_id, Package.user_id == user_id).first()
    if not p:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Package not found")
    return p


@router.get("/carriers")
def list_carriers():
    return _carriers()


@router.get("/")
def list_packages(db: Session = Depends(get_db), current_user: User = Depends(get_current_user_flexible)):
    rows = (
        db.query(Package)
        .filter(Package.user_id == current_user.id)
        .order_by(Package.expected_delivery_date.is_(None), Package.expected_delivery_date.asc(), Package.created_at.desc())
        .all()
    )
    return [_package_dict(p) for p in rows]


@router.post("/", status_code=status.HTTP_201_CREATED)
def create_package(payload: PackageCreate, db: Session = Depends(get_db), current_user: User = Depends(require_write_access_flexible)):
    p = Package(
        user_id=current_user.id,
        source="manual",
        carrier=payload.carrier,
        tracking_number=payload.tracking_number,
        merchant=payload.merchant,
        order_id=payload.order_id,
        item_description=payload.item_description,
        status=payload.status or "ordered",
        expected_delivery_date=_parse_date(payload.expected_delivery_date),
        tracking_url=payload.tracking_url,
        notes=payload.notes,
    )
    db.add(p)
    db.commit()
    db.refresh(p)
    return _package_dict(p)


@router.put("/{package_id}")
def update_package(package_id: int, payload: PackageUpdate, db: Session = Depends(get_db), current_user: User = Depends(require_write_access_flexible)):
    p = _get_package(db, package_id, current_user.id)
    data = payload.dict(exclude_unset=True)
    for field in ("carrier", "tracking_number", "merchant", "order_id", "item_description", "status", "tracking_url", "notes"):
        if field in data:
            setattr(p, field, data[field])
    if "expected_delivery_date" in data:
        p.expected_delivery_date = _parse_date(data["expected_delivery_date"])
    if "actual_delivery_date" in data:
        p.actual_delivery_date = _parse_date(data["actual_delivery_date"])
    p.updated_at = utcnow()
    db.commit()
    db.refresh(p)
    return _package_dict(p)


@router.delete("/{package_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_package(package_id: int, db: Session = Depends(get_db), current_user: User = Depends(require_write_access_flexible)):
    p = _get_package(db, package_id, current_user.id)
    db.delete(p)
    db.commit()


@router.post("/{package_id}/refresh-now")
def refresh_package_now(package_id: int, db: Session = Depends(get_db), current_user: User = Depends(require_write_access_flexible)):
    from app.services.courier_trackers import track_package, LIVE_TRACKING_CARRIERS, BROWSER_AUTOMATION_CARRIERS

    p = _get_package(db, package_id, current_user.id)
    if not p.tracking_number or (p.carrier not in LIVE_TRACKING_CARRIERS and p.carrier not in BROWSER_AUTOMATION_CARRIERS):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="This carrier doesn't support live tracking, or no tracking number is set.")

    if p.carrier in BROWSER_AUTOMATION_CARRIERS:
        from app.services.external_lookup_service import enqueue_courier_tracking

        enqueue_courier_tracking(db, current_user.id, p.carrier, p.tracking_number)
        p.last_tracker_error = "Queued for external lookup (no direct API for this carrier) -- check back shortly."
        db.commit()
        db.refresh(p)
        return _package_dict(p)

    result = track_package(p.carrier, p.tracking_number)
    p.last_checked_at = utcnow()
    if result:
        if result.get("status") and result["status"] != "unknown":
            p.status = result["status"]
        if result.get("expected_delivery_date"):
            p.expected_delivery_date = result["expected_delivery_date"]
        if result.get("actual_delivery_date"):
            p.actual_delivery_date = result["actual_delivery_date"]
        p.last_tracker_error = None
    else:
        p.last_tracker_error = "Tracker returned no data on last check"
    db.commit()
    db.refresh(p)
    return _package_dict(p)
