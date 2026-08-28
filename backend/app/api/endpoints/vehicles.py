"""Vehicles + insurance policy CRUD, plus an OCR-assisted document scan.

No live VAHAN/RTO or IIB integration -- researched and confirmed neither has a
genuinely open API for a personal app (VAHAN requires NIC/government
empanelment; commercial RC-verification vendors are paid B2B KYC services,
disproportionate here). Instead: manual entry, optionally speeded up by
photographing the RC or insurance document and letting OCR + AI pre-fill the
form (same receipt-scan pipeline, reused rather than duplicated).
"""
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Query, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.time_utils import utcnow
from app.api.endpoints.auth import get_current_active_user, require_write_access
from app.models.models import User, Vehicle, VehicleInsurancePolicy
from app.services.receipt_ocr import extract_receipt_text, OCR_AVAILABLE
from app.services.ai_vehicle_extraction import extract_vehicle_document

router = APIRouter()


def _parse_date(s: Optional[str]) -> Optional[datetime]:
    if not s:
        return None
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00")).replace(tzinfo=None)
    except (ValueError, TypeError):
        return None


class VehicleCreate(BaseModel):
    registration_number: str
    nickname: Optional[str] = None
    vehicle_type: Optional[str] = "car"
    make: Optional[str] = None
    model: Optional[str] = None
    fuel_type: Optional[str] = None
    purchase_date: Optional[str] = None
    notes: Optional[str] = None


class VehicleUpdate(BaseModel):
    registration_number: Optional[str] = None
    nickname: Optional[str] = None
    vehicle_type: Optional[str] = None
    make: Optional[str] = None
    model: Optional[str] = None
    fuel_type: Optional[str] = None
    purchase_date: Optional[str] = None
    notes: Optional[str] = None


class PolicyCreate(BaseModel):
    provider: Optional[str] = None
    policy_number: Optional[str] = None
    policy_type: Optional[str] = "comprehensive"
    premium_amount: Optional[float] = None
    start_date: Optional[str] = None
    expiry_date: Optional[str] = None
    notes: Optional[str] = None


class PolicyUpdate(PolicyCreate):
    pass


def _policy_dict(p: VehicleInsurancePolicy) -> dict:
    expiry = p.expiry_date
    days_until_expiry = (expiry - utcnow()).days if expiry else None
    return {
        "id": p.id,
        "vehicle_id": p.vehicle_id,
        "provider": p.provider,
        "policy_number": p.policy_number,
        "policy_type": p.policy_type,
        "premium_amount": p.premium_amount,
        "start_date": p.start_date.strftime("%Y-%m-%d") if p.start_date else None,
        "expiry_date": p.expiry_date.strftime("%Y-%m-%d") if p.expiry_date else None,
        "days_until_expiry": days_until_expiry,
        "notes": p.notes,
    }


def _vehicle_dict(v: Vehicle) -> dict:
    policies = sorted(v.policies, key=lambda p: p.expiry_date or datetime.min, reverse=True)
    current_policy = policies[0] if policies else None
    return {
        "id": v.id,
        "registration_number": v.registration_number,
        "nickname": v.nickname,
        "vehicle_type": v.vehicle_type,
        "make": v.make,
        "model": v.model,
        "fuel_type": v.fuel_type,
        "purchase_date": v.purchase_date.strftime("%Y-%m-%d") if v.purchase_date else None,
        "notes": v.notes,
        "current_policy": _policy_dict(current_policy) if current_policy else None,
        "policy_count": len(policies),
    }


def _get_vehicle(db: Session, vehicle_id: int, user_id: int) -> Vehicle:
    v = db.query(Vehicle).filter(Vehicle.id == vehicle_id, Vehicle.user_id == user_id).first()
    if not v:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Vehicle not found")
    return v


@router.get("/")
def list_vehicles(db: Session = Depends(get_db), current_user: User = Depends(get_current_active_user)):
    rows = db.query(Vehicle).filter(Vehicle.user_id == current_user.id).order_by(Vehicle.created_at.desc()).all()
    return [_vehicle_dict(v) for v in rows]


@router.post("/", status_code=status.HTTP_201_CREATED)
def create_vehicle(payload: VehicleCreate, db: Session = Depends(get_db), current_user: User = Depends(require_write_access)):
    v = Vehicle(
        user_id=current_user.id,
        registration_number=payload.registration_number.strip().upper(),
        nickname=payload.nickname,
        vehicle_type=payload.vehicle_type or "car",
        make=payload.make,
        model=payload.model,
        fuel_type=payload.fuel_type,
        purchase_date=_parse_date(payload.purchase_date),
        notes=payload.notes,
    )
    db.add(v)
    db.commit()
    db.refresh(v)
    return _vehicle_dict(v)


@router.put("/{vehicle_id}")
def update_vehicle(vehicle_id: int, payload: VehicleUpdate, db: Session = Depends(get_db), current_user: User = Depends(require_write_access)):
    v = _get_vehicle(db, vehicle_id, current_user.id)
    data = payload.dict(exclude_unset=True)
    for field in ("nickname", "vehicle_type", "make", "model", "fuel_type", "notes"):
        if field in data:
            setattr(v, field, data[field])
    if "registration_number" in data and data["registration_number"]:
        v.registration_number = data["registration_number"].strip().upper()
    if "purchase_date" in data:
        v.purchase_date = _parse_date(data["purchase_date"])
    v.updated_at = utcnow()
    db.commit()
    db.refresh(v)
    return _vehicle_dict(v)


@router.delete("/{vehicle_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_vehicle(vehicle_id: int, db: Session = Depends(get_db), current_user: User = Depends(require_write_access)):
    v = _get_vehicle(db, vehicle_id, current_user.id)
    db.delete(v)
    db.commit()


@router.get("/{vehicle_id}/policies")
def list_policies(vehicle_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_active_user)):
    _get_vehicle(db, vehicle_id, current_user.id)
    rows = (
        db.query(VehicleInsurancePolicy)
        .filter(VehicleInsurancePolicy.vehicle_id == vehicle_id, VehicleInsurancePolicy.user_id == current_user.id)
        .order_by(VehicleInsurancePolicy.expiry_date.desc())
        .all()
    )
    return [_policy_dict(p) for p in rows]


@router.post("/{vehicle_id}/policies", status_code=status.HTTP_201_CREATED)
def create_policy(vehicle_id: int, payload: PolicyCreate, db: Session = Depends(get_db), current_user: User = Depends(require_write_access)):
    _get_vehicle(db, vehicle_id, current_user.id)
    p = VehicleInsurancePolicy(
        vehicle_id=vehicle_id,
        user_id=current_user.id,
        provider=payload.provider,
        policy_number=payload.policy_number,
        policy_type=payload.policy_type or "comprehensive",
        premium_amount=payload.premium_amount,
        start_date=_parse_date(payload.start_date),
        expiry_date=_parse_date(payload.expiry_date),
        notes=payload.notes,
    )
    db.add(p)
    db.commit()
    db.refresh(p)
    return _policy_dict(p)


@router.put("/policies/{policy_id}")
def update_policy(policy_id: int, payload: PolicyUpdate, db: Session = Depends(get_db), current_user: User = Depends(require_write_access)):
    p = db.query(VehicleInsurancePolicy).filter(
        VehicleInsurancePolicy.id == policy_id, VehicleInsurancePolicy.user_id == current_user.id
    ).first()
    if not p:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Policy not found")
    data = payload.dict(exclude_unset=True)
    for field in ("provider", "policy_number", "policy_type", "premium_amount", "notes"):
        if field in data:
            setattr(p, field, data[field])
    if "start_date" in data:
        p.start_date = _parse_date(data["start_date"])
    if "expiry_date" in data:
        p.expiry_date = _parse_date(data["expiry_date"])
    p.updated_at = utcnow()
    db.commit()
    db.refresh(p)
    return _policy_dict(p)


@router.delete("/policies/{policy_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_policy(policy_id: int, db: Session = Depends(get_db), current_user: User = Depends(require_write_access)):
    p = db.query(VehicleInsurancePolicy).filter(
        VehicleInsurancePolicy.id == policy_id, VehicleInsurancePolicy.user_id == current_user.id
    ).first()
    if not p:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Policy not found")
    db.delete(p)
    db.commit()


@router.get("/expiring")
def expiring_policies(
    within_days: int = Query(45, ge=1, le=365),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Policies expiring soon (or already expired), for a dashboard widget /
    reminder banner -- no separate scheduled-notification pipeline yet, this is
    read-on-demand."""
    rows = (
        db.query(VehicleInsurancePolicy, Vehicle)
        .join(Vehicle, VehicleInsurancePolicy.vehicle_id == Vehicle.id)
        .filter(VehicleInsurancePolicy.user_id == current_user.id, VehicleInsurancePolicy.expiry_date.isnot(None))
        .all()
    )
    now = utcnow()
    results = []
    for p, v in rows:
        days = (p.expiry_date - now).days
        if days <= within_days:
            results.append({**_policy_dict(p), "vehicle_registration_number": v.registration_number, "vehicle_nickname": v.nickname})
    results.sort(key=lambda r: r["days_until_expiry"])
    return results


_ALLOWED_CONTENT_TYPES = {"image/jpeg", "image/jpg", "image/png"}


@router.post("/scan-document")
async def scan_vehicle_document(
    doc_type: str = Query(..., pattern="^(rc|insurance)$"),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """OCR + AI-extract a photo of an RC or insurance document into draft
    fields -- same preview-then-confirm shape as receipt scanning, never
    creates/updates anything directly."""
    if file.content_type not in _ALLOWED_CONTENT_TYPES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Upload a JPEG or PNG photo of the document.")
    if not OCR_AVAILABLE:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="OCR is not available on the server.")

    image_bytes = await file.read()
    ocr_text = extract_receipt_text(image_bytes)
    if not ocr_text.strip():
        return {"success": False, "message": "Couldn't read any text from that photo. Try a clearer, well-lit shot."}

    extracted = extract_vehicle_document(db, current_user.id, ocr_text, doc_type)
    if not extracted:
        return {"success": False, "message": "Couldn't identify document details. Enter them manually.", "raw_text": ocr_text.strip()[:500]}

    return {"success": True, **extracted}
