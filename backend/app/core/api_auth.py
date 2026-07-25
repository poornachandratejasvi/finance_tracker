"""API-key authentication for unattended clients (iOS Shortcuts, webhooks).

A client presents a long-lived token in the ``X-API-Key`` header (or as
``Authorization: Bearer <token>``). Only the SHA-256 hash of each token is stored in
the database; the plaintext is shown to the user exactly once, at creation time.
"""
import hashlib
import secrets
from typing import Optional, Tuple

from fastapi import Depends, HTTPException, Security, status
from fastapi.security import APIKeyHeader
from fastapi.security.http import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.time_utils import utcnow
from app.models.models import ApiToken, User

TOKEN_PREFIX = "ft_"
_PREFIX_LEN = 12  # chars of the full token stored/looked-up as a fast, indexed prefix

api_key_header = APIKeyHeader(name="X-API-Key", auto_error=False)
bearer_scheme = HTTPBearer(auto_error=False)


def generate_api_token() -> Tuple[str, str, str]:
    """Create a new token. Returns (full_token, prefix, sha256_hex_hash).

    The full token is returned to the caller once and never stored; only its prefix and
    hash are persisted.
    """
    secret = secrets.token_urlsafe(32)
    full_token = f"{TOKEN_PREFIX}{secret}"
    prefix = full_token[:_PREFIX_LEN]
    token_hash = hash_token(full_token)
    return full_token, prefix, token_hash


def hash_token(full_token: str) -> str:
    return hashlib.sha256(full_token.encode("utf-8")).hexdigest()


def _resolve_token(db: Session, presented: str) -> Optional[User]:
    presented = (presented or "").strip()
    if not presented:
        return None
    prefix = presented[:_PREFIX_LEN]
    presented_hash = hash_token(presented)
    candidates = (
        db.query(ApiToken)
        .filter(ApiToken.token_prefix == prefix, ApiToken.is_active == True)  # noqa: E712
        .all()
    )
    for tok in candidates:
        # Constant-time comparison to avoid leaking hash bytes via timing.
        if secrets.compare_digest(tok.token_hash, presented_hash):
            user = db.query(User).filter(User.id == tok.user_id).first()
            if user is None or not user.is_active:
                return None
            tok.last_used_at = utcnow()
            db.commit()
            return user
    return None


def get_user_from_api_key(
    api_key: Optional[str] = Security(api_key_header),
    bearer: Optional[HTTPAuthorizationCredentials] = Security(bearer_scheme),
    db: Session = Depends(get_db),
) -> User:
    """FastAPI dependency: resolve the owning active :class:`User` from an API token.

    Accepts the token in ``X-API-Key`` or as a ``Bearer`` credential so iOS Shortcuts
    (which send whichever header is easiest) work either way. Raises 401 on any miss.
    """
    presented = api_key or (bearer.credentials if bearer else None)
    user = _resolve_token(db, presented) if presented else None
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or missing API key",
            headers={"WWW-Authenticate": "X-API-Key"},
        )
    return user
