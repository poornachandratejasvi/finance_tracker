"""General (non-vehicle) insurance policy CRUD + Paperless document archive --
health/life/home/other. Unlike VehicleInsurancePolicy (one derived "current"
policy per vehicle), a person can hold several simultaneous policies of the
same type (e.g. two health policies), so this is a flat, independently-managed
list rather than a history-with-a-derived-current shape.
"""
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Query, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.time_utils import utcnow
from app.api.endpoints.auth import get_current_active_user, require_write_access
from app.models.models import User, InsurancePolicy, InsuranceDocument

router = APIRouter()

_POLICY_TYPES = {"health", "life", "home", "other"}
_PREMIUM_FREQUENCIES = {"monthly", "quarterly", "yearly"}
_DOCUMENT_TYPES = {"policy_doc", "proposal", "claim", "other"}
_DOCUMENT_CONTENT_TYPES = {"image/jpeg", "image/jpg", "image/png", "application/pdf"}


def _parse_date(s: Optional[str]) -> Optional[datetime]:
    if not s:
        return None
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00")).replace(tzinfo=None)
    except (ValueError, TypeError):
        return None


class PolicyCreate(BaseModel):
    policy_type: Optional[str] = "other"
    provider: Optional[str] = None
    policy_number: Optional[str] = None
    insured_name: Optional[str] = None
    premium_amount: Optional[float] = None
    premium_frequency: Optional[str] = "yearly"
    coverage_amount: Optional[float] = None
    issued_date: Optional[str] = None
    expiry_date: Optional[str] = None
    notes: Optional[str] = None


class PolicyUpdate(PolicyCreate):
    is_active: Optional[bool] = None


def _policy_dict(p: InsurancePolicy) -> dict:
    days_until_expiry = (p.expiry_date - utcnow()).days if p.expiry_date else None
    return {
        "id": p.id,
        "policy_type": p.policy_type,
        "provider": p.provider,
        "policy_number": p.policy_number,
        "insured_name": p.insured_name,
        "premium_amount": p.premium_amount,
        "premium_frequency": p.premium_frequency,
        "coverage_amount": p.coverage_amount,
        "issued_date": p.issued_date.strftime("%Y-%m-%d") if p.issued_date else None,
        "expiry_date": p.expiry_date.strftime("%Y-%m-%d") if p.expiry_date else None,
        "days_until_expiry": days_until_expiry,
        "is_active": p.is_active,
        "notes": p.notes,
        "document_count": len(p.documents),
    }


def _document_dict(db: Session, d: InsuranceDocument) -> dict:
    from app.services import paperless_service

    return {
        "id": d.id,
        "policy_id": d.policy_id,
        "document_type": d.document_type,
        "title": d.title,
        "paperless_document_id": d.paperless_document_id,
        "url": paperless_service.document_url(db, d.paperless_document_id),
        "processing": d.paperless_document_id is None,
        "created_at": d.created_at.isoformat() if d.created_at else None,
    }


def _get_policy(db: Session, policy_id: int, user_id: int) -> InsurancePolicy:
    p = db.query(InsurancePolicy).filter(InsurancePolicy.id == policy_id, InsurancePolicy.user_id == user_id).first()
    if not p:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Insurance policy not found")
    return p


@router.get("/")
def list_policies(
    policy_type: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    query = db.query(InsurancePolicy).filter(InsurancePolicy.user_id == current_user.id)
    if policy_type:
        query = query.filter(InsurancePolicy.policy_type == policy_type)
    rows = query.order_by(InsurancePolicy.is_active.desc(), InsurancePolicy.expiry_date.desc()).all()
    return [_policy_dict(p) for p in rows]


@router.post("/", status_code=status.HTTP_201_CREATED)
def create_policy(payload: PolicyCreate, db: Session = Depends(get_db), current_user: User = Depends(require_write_access)):
    p = InsurancePolicy(
        user_id=current_user.id,
        policy_type=payload.policy_type if payload.policy_type in _POLICY_TYPES else "other",
        provider=payload.provider,
        policy_number=payload.policy_number,
        insured_name=payload.insured_name,
        premium_amount=payload.premium_amount,
        premium_frequency=payload.premium_frequency if payload.premium_frequency in _PREMIUM_FREQUENCIES else "yearly",
        coverage_amount=payload.coverage_amount,
        issued_date=_parse_date(payload.issued_date),
        expiry_date=_parse_date(payload.expiry_date),
        notes=payload.notes,
    )
    db.add(p)
    db.commit()
    db.refresh(p)
    return _policy_dict(p)


@router.put("/{policy_id}")
def update_policy(policy_id: int, payload: PolicyUpdate, db: Session = Depends(get_db), current_user: User = Depends(require_write_access)):
    p = _get_policy(db, policy_id, current_user.id)
    data = payload.dict(exclude_unset=True)
    for field in ("provider", "policy_number", "insured_name", "premium_amount", "coverage_amount", "notes", "is_active"):
        if field in data:
            setattr(p, field, data[field])
    if "policy_type" in data and data["policy_type"] in _POLICY_TYPES:
        p.policy_type = data["policy_type"]
    if "premium_frequency" in data and data["premium_frequency"] in _PREMIUM_FREQUENCIES:
        p.premium_frequency = data["premium_frequency"]
    if "issued_date" in data:
        p.issued_date = _parse_date(data["issued_date"])
    if "expiry_date" in data:
        p.expiry_date = _parse_date(data["expiry_date"])
    p.updated_at = utcnow()
    db.commit()
    db.refresh(p)
    return _policy_dict(p)


@router.delete("/{policy_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_policy(policy_id: int, db: Session = Depends(get_db), current_user: User = Depends(require_write_access)):
    p = _get_policy(db, policy_id, current_user.id)
    db.delete(p)
    db.commit()


@router.get("/expiring")
def expiring_policies(
    within_days: int = Query(45, ge=1, le=365),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    now = utcnow()
    rows = (
        db.query(InsurancePolicy)
        .filter(InsurancePolicy.user_id == current_user.id, InsurancePolicy.is_active.is_(True), InsurancePolicy.expiry_date.isnot(None))
        .all()
    )
    results = [_policy_dict(p) for p in rows if (p.expiry_date - now).days <= within_days]
    results.sort(key=lambda r: r["days_until_expiry"])
    return results


@router.get("/{policy_id}/documents")
def list_policy_documents(policy_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_active_user)):
    _get_policy(db, policy_id, current_user.id)
    rows = (
        db.query(InsuranceDocument)
        .filter(InsuranceDocument.policy_id == policy_id, InsuranceDocument.user_id == current_user.id)
        .order_by(InsuranceDocument.created_at.desc())
        .all()
    )
    return [_document_dict(db, d) for d in rows]


@router.post("/{policy_id}/documents", status_code=status.HTTP_201_CREATED)
async def upload_policy_document(
    policy_id: int,
    document_type: str = Query("other", pattern="^(" + "|".join(_DOCUMENT_TYPES) + ")$"),
    title: Optional[str] = Query(None),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_write_access),
):
    """Archive a policy document (policy PDF, claim form, proposal, ...) to
    Paperless-ngx -- same mechanism as vehicle document archiving, just linked
    to an InsurancePolicy. If Paperless isn't configured, the row is still
    created but stays unlinked (processing=true forever), not an error."""
    policy = _get_policy(db, policy_id, current_user.id)
    if file.content_type not in _DOCUMENT_CONTENT_TYPES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Upload a JPEG/PNG photo or a PDF.")

    doc = InsuranceDocument(
        policy_id=policy_id, user_id=current_user.id,
        document_type=document_type, title=title or file.filename,
    )
    db.add(doc)
    db.commit()
    db.refresh(doc)

    from app.services import paperless_service
    if paperless_service.is_configured(db):
        file_bytes = await file.read()
        label = policy.provider or policy.policy_type
        task_id = paperless_service.upload_document(
            db, file_bytes, file.filename, title=f"{label} - {title or document_type}"
        )
        if task_id:
            from app.tasks.insurance_document_tasks import resolve_insurance_document
            resolve_insurance_document.delay(doc.id, task_id)

    return _document_dict(db, doc)


@router.delete("/{policy_id}/documents/{document_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_policy_document(policy_id: int, document_id: int, db: Session = Depends(get_db), current_user: User = Depends(require_write_access)):
    doc = db.query(InsuranceDocument).filter(
        InsuranceDocument.id == document_id, InsuranceDocument.policy_id == policy_id, InsuranceDocument.user_id == current_user.id
    ).first()
    if not doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")
    db.delete(doc)
    db.commit()
