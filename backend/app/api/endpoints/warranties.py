"""Appliance/electronics warranty + AMC (annual maintenance contract) CRUD +
Paperless document archive. Same expiry-tracking shape as insurance.py, but
tracks two independent expiry dates per item (warranty_expiry, amc_expiry).
"""
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Query, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.time_utils import utcnow
from app.api.endpoints.auth import get_current_active_user, require_write_access
from app.models.models import User, Warranty, WarrantyDocument

router = APIRouter()

_CATEGORIES = {"electronics", "appliance", "furniture", "other"}
_DOCUMENT_TYPES = {"invoice", "warranty_card", "amc_contract", "other"}
_DOCUMENT_CONTENT_TYPES = {"image/jpeg", "image/jpg", "image/png", "application/pdf"}


def _parse_date(s: Optional[str]) -> Optional[datetime]:
    if not s:
        return None
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00")).replace(tzinfo=None)
    except (ValueError, TypeError):
        return None


class WarrantyCreate(BaseModel):
    item_name: str
    category: Optional[str] = "other"
    vendor: Optional[str] = None
    purchase_date: Optional[str] = None
    purchase_amount: Optional[float] = None
    warranty_expiry: Optional[str] = None
    amc_expiry: Optional[str] = None
    amc_provider: Optional[str] = None
    notes: Optional[str] = None


class WarrantyUpdate(WarrantyCreate):
    item_name: Optional[str] = None


def _warranty_dict(w: Warranty) -> dict:
    now = utcnow()
    return {
        "id": w.id,
        "item_name": w.item_name,
        "category": w.category,
        "vendor": w.vendor,
        "purchase_date": w.purchase_date.strftime("%Y-%m-%d") if w.purchase_date else None,
        "purchase_amount": w.purchase_amount,
        "warranty_expiry": w.warranty_expiry.strftime("%Y-%m-%d") if w.warranty_expiry else None,
        "warranty_days_until_expiry": (w.warranty_expiry - now).days if w.warranty_expiry else None,
        "amc_expiry": w.amc_expiry.strftime("%Y-%m-%d") if w.amc_expiry else None,
        "amc_days_until_expiry": (w.amc_expiry - now).days if w.amc_expiry else None,
        "amc_provider": w.amc_provider,
        "notes": w.notes,
        "document_count": len(w.documents),
    }


def _document_dict(db: Session, d: WarrantyDocument) -> dict:
    from app.services import paperless_service

    return {
        "id": d.id,
        "warranty_id": d.warranty_id,
        "document_type": d.document_type,
        "title": d.title,
        "paperless_document_id": d.paperless_document_id,
        "url": paperless_service.document_url(db, d.paperless_document_id),
        "processing": d.paperless_document_id is None,
        "created_at": d.created_at.isoformat() if d.created_at else None,
    }


def _get_warranty(db: Session, warranty_id: int, user_id: int) -> Warranty:
    w = db.query(Warranty).filter(Warranty.id == warranty_id, Warranty.user_id == user_id).first()
    if not w:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Warranty not found")
    return w


@router.get("/")
def list_warranties(
    category: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    query = db.query(Warranty).filter(Warranty.user_id == current_user.id)
    if category:
        query = query.filter(Warranty.category == category)
    rows = query.order_by(Warranty.created_at.desc()).all()
    return [_warranty_dict(w) for w in rows]


@router.post("/", status_code=status.HTTP_201_CREATED)
def create_warranty(payload: WarrantyCreate, db: Session = Depends(get_db), current_user: User = Depends(require_write_access)):
    w = Warranty(
        user_id=current_user.id,
        item_name=payload.item_name.strip(),
        category=payload.category if payload.category in _CATEGORIES else "other",
        vendor=payload.vendor,
        purchase_date=_parse_date(payload.purchase_date),
        purchase_amount=payload.purchase_amount,
        warranty_expiry=_parse_date(payload.warranty_expiry),
        amc_expiry=_parse_date(payload.amc_expiry),
        amc_provider=payload.amc_provider,
        notes=payload.notes,
    )
    db.add(w)
    db.commit()
    db.refresh(w)
    return _warranty_dict(w)


@router.put("/{warranty_id}")
def update_warranty(warranty_id: int, payload: WarrantyUpdate, db: Session = Depends(get_db), current_user: User = Depends(require_write_access)):
    w = _get_warranty(db, warranty_id, current_user.id)
    data = payload.dict(exclude_unset=True)
    for field in ("item_name", "vendor", "purchase_amount", "amc_provider", "notes"):
        if field in data:
            setattr(w, field, data[field])
    if "category" in data and data["category"] in _CATEGORIES:
        w.category = data["category"]
    if "purchase_date" in data:
        w.purchase_date = _parse_date(data["purchase_date"])
    if "warranty_expiry" in data:
        w.warranty_expiry = _parse_date(data["warranty_expiry"])
    if "amc_expiry" in data:
        w.amc_expiry = _parse_date(data["amc_expiry"])
    w.updated_at = utcnow()
    db.commit()
    db.refresh(w)
    return _warranty_dict(w)


@router.delete("/{warranty_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_warranty(warranty_id: int, db: Session = Depends(get_db), current_user: User = Depends(require_write_access)):
    w = _get_warranty(db, warranty_id, current_user.id)
    db.delete(w)
    db.commit()


@router.get("/expiring")
def expiring_warranties(
    within_days: int = Query(45, ge=1, le=365),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Warranty AND AMC expiries, combined, each tagged with expiry_kind so the
    UI/calendar can label which one is expiring."""
    now = utcnow()
    rows = db.query(Warranty).filter(Warranty.user_id == current_user.id).all()
    results = []
    for w in rows:
        base = _warranty_dict(w)
        if w.warranty_expiry and (w.warranty_expiry - now).days <= within_days:
            results.append({**base, "expiry_kind": "warranty", "days_until_expiry": base["warranty_days_until_expiry"]})
        if w.amc_expiry and (w.amc_expiry - now).days <= within_days:
            results.append({**base, "expiry_kind": "amc", "days_until_expiry": base["amc_days_until_expiry"]})
    results.sort(key=lambda r: r["days_until_expiry"])
    return results


@router.get("/{warranty_id}/documents")
def list_warranty_documents(warranty_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_active_user)):
    _get_warranty(db, warranty_id, current_user.id)
    rows = (
        db.query(WarrantyDocument)
        .filter(WarrantyDocument.warranty_id == warranty_id, WarrantyDocument.user_id == current_user.id)
        .order_by(WarrantyDocument.created_at.desc())
        .all()
    )
    return [_document_dict(db, d) for d in rows]


@router.post("/{warranty_id}/documents", status_code=status.HTTP_201_CREATED)
async def upload_warranty_document(
    warranty_id: int,
    document_type: str = Query("other", pattern="^(" + "|".join(_DOCUMENT_TYPES) + ")$"),
    title: Optional[str] = Query(None),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_write_access),
):
    """Archive a warranty-related document (invoice, warranty card, AMC
    contract, ...) to Paperless-ngx -- same mechanism as vehicle document
    archiving, just linked to a Warranty."""
    warranty = _get_warranty(db, warranty_id, current_user.id)
    if file.content_type not in _DOCUMENT_CONTENT_TYPES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Upload a JPEG/PNG photo or a PDF.")

    doc = WarrantyDocument(
        warranty_id=warranty_id, user_id=current_user.id,
        document_type=document_type, title=title or file.filename,
    )
    db.add(doc)
    db.commit()
    db.refresh(doc)

    from app.services import paperless_service
    if paperless_service.is_configured(db):
        file_bytes = await file.read()
        task_id = paperless_service.upload_document(
            db, file_bytes, file.filename, title=f"{warranty.item_name} - {title or document_type}"
        )
        if task_id:
            from app.tasks.warranty_document_tasks import resolve_warranty_document
            resolve_warranty_document.delay(doc.id, task_id)

    return _document_dict(db, doc)


@router.delete("/{warranty_id}/documents/{document_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_warranty_document(warranty_id: int, document_id: int, db: Session = Depends(get_db), current_user: User = Depends(require_write_access)):
    doc = db.query(WarrantyDocument).filter(
        WarrantyDocument.id == document_id, WarrantyDocument.warranty_id == warranty_id, WarrantyDocument.user_id == current_user.id
    ).first()
    if not doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")
    db.delete(doc)
    db.commit()
