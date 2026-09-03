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
from app.models.models import User, Vehicle, VehicleInsurancePolicy, VehiclePucCertificate, VehicleDocument, Transaction
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


class PucCreate(BaseModel):
    certificate_number: Optional[str] = None
    issued_date: Optional[str] = None
    expiry_date: Optional[str] = None
    notes: Optional[str] = None


class PucUpdate(PucCreate):
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


def _puc_dict(p: VehiclePucCertificate) -> dict:
    expiry = p.expiry_date
    days_until_expiry = (expiry - utcnow()).days if expiry else None
    return {
        "id": p.id,
        "vehicle_id": p.vehicle_id,
        "certificate_number": p.certificate_number,
        "issued_date": p.issued_date.strftime("%Y-%m-%d") if p.issued_date else None,
        "expiry_date": p.expiry_date.strftime("%Y-%m-%d") if p.expiry_date else None,
        "days_until_expiry": days_until_expiry,
        "notes": p.notes,
    }


def _document_dict(db: Session, d: VehicleDocument) -> dict:
    from app.services import paperless_service

    return {
        "id": d.id,
        "vehicle_id": d.vehicle_id,
        "document_type": d.document_type,
        "title": d.title,
        "paperless_document_id": d.paperless_document_id,
        "url": paperless_service.document_url(db, d.paperless_document_id),
        "processing": d.paperless_document_id is None,
        "created_at": d.created_at.isoformat() if d.created_at else None,
    }


def _vehicle_dict(v: Vehicle) -> dict:
    policies = sorted(v.policies, key=lambda p: p.expiry_date or datetime.min, reverse=True)
    current_policy = policies[0] if policies else None
    pucs = sorted(v.puc_certificates, key=lambda p: p.expiry_date or datetime.min, reverse=True)
    current_puc = pucs[0] if pucs else None
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
        "current_puc": _puc_dict(current_puc) if current_puc else None,
        "puc_count": len(pucs),
        "document_count": len(v.documents),
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


@router.get("/{vehicle_id}/puc")
def list_puc_certificates(vehicle_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_active_user)):
    _get_vehicle(db, vehicle_id, current_user.id)
    rows = (
        db.query(VehiclePucCertificate)
        .filter(VehiclePucCertificate.vehicle_id == vehicle_id, VehiclePucCertificate.user_id == current_user.id)
        .order_by(VehiclePucCertificate.expiry_date.desc())
        .all()
    )
    return [_puc_dict(p) for p in rows]


@router.post("/{vehicle_id}/puc", status_code=status.HTTP_201_CREATED)
def create_puc_certificate(vehicle_id: int, payload: PucCreate, db: Session = Depends(get_db), current_user: User = Depends(require_write_access)):
    _get_vehicle(db, vehicle_id, current_user.id)
    p = VehiclePucCertificate(
        vehicle_id=vehicle_id,
        user_id=current_user.id,
        certificate_number=payload.certificate_number,
        issued_date=_parse_date(payload.issued_date),
        expiry_date=_parse_date(payload.expiry_date),
        notes=payload.notes,
    )
    db.add(p)
    db.commit()
    db.refresh(p)
    return _puc_dict(p)


@router.put("/puc/{puc_id}")
def update_puc_certificate(puc_id: int, payload: PucUpdate, db: Session = Depends(get_db), current_user: User = Depends(require_write_access)):
    p = db.query(VehiclePucCertificate).filter(
        VehiclePucCertificate.id == puc_id, VehiclePucCertificate.user_id == current_user.id
    ).first()
    if not p:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="PUC certificate not found")
    data = payload.dict(exclude_unset=True)
    for field in ("certificate_number", "notes"):
        if field in data:
            setattr(p, field, data[field])
    if "issued_date" in data:
        p.issued_date = _parse_date(data["issued_date"])
    if "expiry_date" in data:
        p.expiry_date = _parse_date(data["expiry_date"])
    p.updated_at = utcnow()
    db.commit()
    db.refresh(p)
    return _puc_dict(p)


@router.delete("/puc/{puc_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_puc_certificate(puc_id: int, db: Session = Depends(get_db), current_user: User = Depends(require_write_access)):
    p = db.query(VehiclePucCertificate).filter(
        VehiclePucCertificate.id == puc_id, VehiclePucCertificate.user_id == current_user.id
    ).first()
    if not p:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="PUC certificate not found")
    db.delete(p)
    db.commit()


@router.get("/expiring")
def expiring_policies(
    within_days: int = Query(45, ge=1, le=365),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Insurance policies AND PUC certificates expiring soon (or already
    expired), for a dashboard widget / reminder banner -- no separate
    scheduled-notification pipeline yet, this is read-on-demand."""
    now = utcnow()
    results = []

    policy_rows = (
        db.query(VehicleInsurancePolicy, Vehicle)
        .join(Vehicle, VehicleInsurancePolicy.vehicle_id == Vehicle.id)
        .filter(VehicleInsurancePolicy.user_id == current_user.id, VehicleInsurancePolicy.expiry_date.isnot(None))
        .all()
    )
    for p, v in policy_rows:
        days = (p.expiry_date - now).days
        if days <= within_days:
            results.append({**_policy_dict(p), "document_kind": "insurance", "vehicle_registration_number": v.registration_number, "vehicle_nickname": v.nickname})

    puc_rows = (
        db.query(VehiclePucCertificate, Vehicle)
        .join(Vehicle, VehiclePucCertificate.vehicle_id == Vehicle.id)
        .filter(VehiclePucCertificate.user_id == current_user.id, VehiclePucCertificate.expiry_date.isnot(None))
        .all()
    )
    for p, v in puc_rows:
        days = (p.expiry_date - now).days
        if days <= within_days:
            results.append({**_puc_dict(p), "document_kind": "puc", "vehicle_registration_number": v.registration_number, "vehicle_nickname": v.nickname})

    results.sort(key=lambda r: r["days_until_expiry"])
    return results


@router.get("/{vehicle_id}/spend-summary")
def vehicle_spend_summary(
    vehicle_id: int,
    months: int = Query(12, ge=1, le=60),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Total cost of ownership so far: everything tagged to this vehicle
    (fuel/service/tolls/etc, via Transaction.vehicle_id) plus its insurance
    premium history, broken down by category and by month."""
    from datetime import timedelta
    from collections import defaultdict

    vehicle = _get_vehicle(db, vehicle_id, current_user.id)
    cutoff = utcnow() - timedelta(days=30 * months)

    txns = (
        db.query(Transaction)
        .filter(Transaction.vehicle_id == vehicle_id, Transaction.user_id == current_user.id, Transaction.transaction_date >= cutoff)
        .all()
    )
    by_category = defaultdict(float)
    by_month = defaultdict(float)
    total_spent = 0.0
    for t in txns:
        amt = t.amount or 0.0
        total_spent += amt
        by_category[t.category or "Uncategorized"] += amt
        by_month[t.transaction_date.strftime("%Y-%m")] += amt

    insurance_total = sum(p.premium_amount or 0 for p in vehicle.policies)

    return {
        "vehicle_id": vehicle_id,
        "transaction_count": len(txns),
        "total_spent": round(total_spent, 2),
        "insurance_lifetime_total": round(insurance_total, 2),
        "by_category": sorted(
            [{"category": c, "amount": round(a, 2)} for c, a in by_category.items()],
            key=lambda r: -r["amount"],
        ),
        "by_month": sorted(
            [{"month": m, "amount": round(a, 2)} for m, a in by_month.items()],
            key=lambda r: r["month"],
        ),
    }


_DOCUMENT_TYPES = {"rc", "insurance", "puc", "service_record", "other"}
_DOCUMENT_CONTENT_TYPES = {"image/jpeg", "image/jpg", "image/png", "application/pdf"}


@router.get("/{vehicle_id}/documents")
def list_vehicle_documents(vehicle_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_active_user)):
    _get_vehicle(db, vehicle_id, current_user.id)
    rows = (
        db.query(VehicleDocument)
        .filter(VehicleDocument.vehicle_id == vehicle_id, VehicleDocument.user_id == current_user.id)
        .order_by(VehicleDocument.created_at.desc())
        .all()
    )
    return [_document_dict(db, d) for d in rows]


@router.post("/{vehicle_id}/documents", status_code=status.HTTP_201_CREATED)
async def upload_vehicle_document(
    vehicle_id: int,
    document_type: str = Query("other", pattern="^(" + "|".join(_DOCUMENT_TYPES) + ")$"),
    title: Optional[str] = Query(None),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_write_access),
):
    """Archive any vehicle-related document (RC copy, service invoice, loan
    paperwork, ...) to Paperless-ngx -- same mechanism as receipt archiving,
    just linked to a Vehicle. If Paperless isn't configured, the row is still
    created (for its title/type) but stays unlinked (paperless_document_id
    stays NULL, processing=true forever) -- not treated as an error, since
    the document itself was never lost, only its archive copy."""
    vehicle = _get_vehicle(db, vehicle_id, current_user.id)
    if file.content_type not in _DOCUMENT_CONTENT_TYPES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Upload a JPEG/PNG photo or a PDF.")

    doc = VehicleDocument(
        vehicle_id=vehicle_id, user_id=current_user.id,
        document_type=document_type, title=title or file.filename,
    )
    db.add(doc)
    db.commit()
    db.refresh(doc)

    from app.services import paperless_service
    if paperless_service.is_configured(db):
        file_bytes = await file.read()
        task_id = paperless_service.upload_document(
            db, file_bytes, file.filename, title=f"{vehicle.registration_number} - {title or document_type}"
        )
        if task_id:
            from app.tasks.vehicle_document_tasks import resolve_vehicle_document
            resolve_vehicle_document.delay(doc.id, task_id)

    return _document_dict(db, doc)


@router.delete("/{vehicle_id}/documents/{document_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_vehicle_document(vehicle_id: int, document_id: int, db: Session = Depends(get_db), current_user: User = Depends(require_write_access)):
    """Removes this app's reference only -- does not delete the archived copy
    from Paperless-ngx (same as unlinking a receipt), so it's never lost even
    if unlinked here by mistake."""
    doc = db.query(VehicleDocument).filter(
        VehicleDocument.id == document_id, VehicleDocument.vehicle_id == vehicle_id, VehicleDocument.user_id == current_user.id
    ).first()
    if not doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")
    db.delete(doc)
    db.commit()


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
