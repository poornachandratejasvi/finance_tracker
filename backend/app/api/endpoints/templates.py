import json
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List

from app.core.database import get_db
from app.api.endpoints.auth import get_current_active_user, require_write_access
from app.models.models import User, Template
from app.schemas.template import TemplateCreate, TemplateUpdate, TemplateResponse

router = APIRouter()


def _parse_label_ids(txt):
    if not txt:
        return []
    try:
        v = json.loads(txt)
        return [int(x) for x in v] if isinstance(v, list) else []
    except (ValueError, TypeError):
        return []


def _to_resp(t: Template) -> dict:
    return {
        "id": t.id, "user_id": t.user_id, "name": t.name, "bank_id": t.bank_id,
        "category": t.category, "amount": t.amount, "transaction_type": t.transaction_type,
        "description": t.description, "notes": t.notes, "currency_code": t.currency_code,
        "label_ids": _parse_label_ids(t.label_ids), "created_at": t.created_at,
    }


@router.get("/", response_model=List[TemplateResponse])
def list_templates(db: Session = Depends(get_db), current_user: User = Depends(get_current_active_user)):
    tpls = db.query(Template).filter(Template.user_id == current_user.id).order_by(Template.name).all()
    return [_to_resp(t) for t in tpls]


@router.post("/", response_model=TemplateResponse, status_code=status.HTTP_201_CREATED)
def create_template(data: TemplateCreate, db: Session = Depends(get_db), current_user: User = Depends(require_write_access)):
    name = (data.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Template name is required")
    payload = data.dict()
    label_ids = payload.pop("label_ids", []) or []
    payload["name"] = name
    tpl = Template(user_id=current_user.id, label_ids=json.dumps([int(x) for x in label_ids]), **payload)
    db.add(tpl); db.commit(); db.refresh(tpl)
    return _to_resp(tpl)


@router.put("/{template_id}", response_model=TemplateResponse)
def update_template(template_id: int, data: TemplateUpdate, db: Session = Depends(get_db), current_user: User = Depends(require_write_access)):
    tpl = db.query(Template).filter(Template.id == template_id, Template.user_id == current_user.id).first()
    if not tpl:
        raise HTTPException(status_code=404, detail="Template not found")
    update = data.dict(exclude_unset=True)
    if "label_ids" in update and update["label_ids"] is not None:
        tpl.label_ids = json.dumps([int(x) for x in update.pop("label_ids")])
    else:
        update.pop("label_ids", None)
    for k, val in update.items():
        setattr(tpl, k, val)
    db.commit(); db.refresh(tpl)
    return _to_resp(tpl)


@router.delete("/{template_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_template(template_id: int, db: Session = Depends(get_db), current_user: User = Depends(require_write_access)):
    tpl = db.query(Template).filter(Template.id == template_id, Template.user_id == current_user.id).first()
    if not tpl:
        raise HTTPException(status_code=404, detail="Template not found")
    db.delete(tpl); db.commit()
    return None
