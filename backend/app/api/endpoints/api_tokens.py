"""Management of long-lived API tokens for unattended clients (iOS Shortcuts, webhooks).

Tokens are created/listed/revoked here using the normal JWT session. The plaintext token
value is returned exactly once, at creation; afterwards only its prefix is shown.
"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import List, Optional

from app.core.database import get_db
from app.core.api_auth import generate_api_token
from app.api.endpoints.auth import get_current_active_user
from app.models.models import User, ApiToken

router = APIRouter()


class ApiTokenCreate(BaseModel):
    name: Optional[str] = "API Token"


class ApiTokenInfo(BaseModel):
    id: int
    name: Optional[str]
    token_prefix: Optional[str]
    is_active: bool
    last_used_at: Optional[str] = None
    created_at: Optional[str] = None


def _to_info(t: ApiToken) -> dict:
    return {
        "id": t.id,
        "name": t.name,
        "token_prefix": t.token_prefix,
        "is_active": t.is_active,
        "last_used_at": t.last_used_at.isoformat() + "Z" if t.last_used_at else None,
        "created_at": t.created_at.isoformat() + "Z" if t.created_at else None,
    }


@router.post("/", status_code=status.HTTP_201_CREATED)
def create_api_token(
    payload: ApiTokenCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Create a new API token. The full token is returned ONCE — store it now."""
    full_token, prefix, token_hash = generate_api_token()
    token = ApiToken(
        user_id=current_user.id,
        name=(payload.name or "API Token")[:100],
        token_prefix=prefix,
        token_hash=token_hash,
        is_active=True,
    )
    db.add(token)
    db.commit()
    db.refresh(token)
    result = _to_info(token)
    # The plaintext token is included only in this creation response.
    result["token"] = full_token
    return result


@router.get("/", response_model=List[ApiTokenInfo])
def list_api_tokens(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """List the current user's API tokens (prefix + metadata only; never the secret)."""
    tokens = (
        db.query(ApiToken)
        .filter(ApiToken.user_id == current_user.id)
        .order_by(ApiToken.created_at.desc())
        .all()
    )
    return [_to_info(t) for t in tokens]


@router.delete("/{token_id}", status_code=status.HTTP_204_NO_CONTENT)
def revoke_api_token(
    token_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Revoke (delete) one of the current user's API tokens."""
    token = db.query(ApiToken).filter(
        ApiToken.id == token_id,
        ApiToken.user_id == current_user.id,
    ).first()
    if not token:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Token not found")
    db.delete(token)
    db.commit()
