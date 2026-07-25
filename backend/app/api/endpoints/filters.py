import json
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List

from app.core.database import get_db
from app.api.endpoints.auth import get_current_active_user
from app.models.models import User, SavedFilter
from app.schemas.saved_filter import SavedFilterCreate, SavedFilterUpdate, SavedFilterResponse

router = APIRouter()


def _to_response(sf: SavedFilter) -> dict:
    payload = None
    if sf.payload:
        try:
            payload = json.loads(sf.payload)
        except (ValueError, TypeError):
            payload = None
    return {
        "id": sf.id, "user_id": sf.user_id, "name": sf.name,
        "scope": sf.scope, "payload": payload, "created_at": sf.created_at,
    }


@router.get("/", response_model=List[SavedFilterResponse])
def list_filters(
    scope: str = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    q = db.query(SavedFilter).filter(SavedFilter.user_id == current_user.id)
    if scope:
        q = q.filter(SavedFilter.scope == scope)
    return [_to_response(sf) for sf in q.order_by(SavedFilter.name).all()]


@router.post("/", response_model=SavedFilterResponse, status_code=status.HTTP_201_CREATED)
def create_filter(
    data: SavedFilterCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    name = (data.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Filter name is required")
    sf = SavedFilter(
        user_id=current_user.id, name=name, scope=data.scope or "records",
        payload=json.dumps(data.payload) if data.payload is not None else None,
    )
    db.add(sf)
    db.commit()
    db.refresh(sf)
    return _to_response(sf)


@router.put("/{filter_id}", response_model=SavedFilterResponse)
def update_filter(
    filter_id: int,
    data: SavedFilterUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    sf = db.query(SavedFilter).filter(
        SavedFilter.id == filter_id, SavedFilter.user_id == current_user.id
    ).first()
    if not sf:
        raise HTTPException(status_code=404, detail="Filter not found")
    update = data.dict(exclude_unset=True)
    if "name" in update and update["name"]:
        sf.name = update["name"].strip()
    if "scope" in update and update["scope"]:
        sf.scope = update["scope"]
    if "payload" in update:
        sf.payload = json.dumps(update["payload"]) if update["payload"] is not None else None
    db.commit()
    db.refresh(sf)
    return _to_response(sf)


@router.delete("/{filter_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_filter(
    filter_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    sf = db.query(SavedFilter).filter(
        SavedFilter.id == filter_id, SavedFilter.user_id == current_user.id
    ).first()
    if not sf:
        raise HTTPException(status_code=404, detail="Filter not found")
    db.delete(sf)
    db.commit()
    return None
