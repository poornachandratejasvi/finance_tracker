"""Device push-token registration for the mobile app -- see
expo_push_service.py for how these get used (delivering an OS-level
notification, e.g. a credit-card-bill reminder, even when the app is closed)."""
from typing import Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.time_utils import utcnow
from app.core.api_auth import get_current_user_flexible
from app.models.models import User, PushToken

router = APIRouter()


class PushTokenRegister(BaseModel):
    token: str
    platform: Optional[str] = None  # 'ios' | 'android'


@router.post("/")
def register_push_token(payload: PushTokenRegister, db: Session = Depends(get_db), current_user: User = Depends(get_current_user_flexible)):
    """Idempotent: re-registering the same token (app reinstall, token refresh
    with the same value) updates the owner/last_used_at instead of duplicating --
    a token is unique per device regardless of which account is logged in."""
    existing = db.query(PushToken).filter(PushToken.token == payload.token).first()
    if existing:
        existing.user_id = current_user.id
        existing.platform = payload.platform or existing.platform
        existing.last_used_at = utcnow()
    else:
        db.add(PushToken(user_id=current_user.id, token=payload.token, platform=payload.platform, last_used_at=utcnow()))
    db.commit()
    return {"success": True}


@router.delete("/{token}", status_code=204)
def unregister_push_token(token: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user_flexible)):
    """Called on logout so a shared/reinstalled device stops getting this
    account's reminders."""
    db.query(PushToken).filter(PushToken.token == token, PushToken.user_id == current_user.id).delete()
    db.commit()
