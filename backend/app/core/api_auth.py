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


def get_current_user_flexible(
    api_key: Optional[str] = Security(api_key_header),
    bearer: Optional[HTTPAuthorizationCredentials] = Security(bearer_scheme),
    db: Session = Depends(get_db),
) -> User:
    """Accept EITHER a long-lived API token (``X-API-Key`` / ``Bearer ft_...``,
    see get_user_from_api_key) OR a normal browser-session JWT access token
    (``Bearer eyJ...``, see auth.get_current_user) on the same endpoint.

    Use this on endpoints an external/unattended integration (a webhook, an
    automation tool, a second app) needs to call directly with its own minted
    API token from Settings -> API Access, while the in-app frontend keeps
    working unchanged with its normal login session -- no separate endpoint
    or client-side branching needed for the two credential types.
    """
    presented = api_key or (bearer.credentials if bearer else None)
    if presented:
        user = _resolve_token(db, presented)
        if user:
            return user

    if bearer and bearer.credentials:
        from app.core.security import verify_token

        try:
            payload = verify_token(bearer.credentials, expected_type="access")
        except HTTPException:
            payload = None
        if payload:
            user = db.query(User).filter(User.id == int(payload.get("sub", 0))).first()
            if user and user.is_active:
                return user

    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid or missing credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )


def require_write_access_flexible(current_user: User = Depends(get_current_user_flexible)) -> User:
    """Same VIEWER-blocking rule as auth.require_write_access, for endpoints
    that accept either an API token or a session JWT (see get_current_user_flexible)."""
    from app.models.models import UserRole

    if current_user.role == UserRole.VIEWER:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Your account has read-only access",
        )
    return current_user
