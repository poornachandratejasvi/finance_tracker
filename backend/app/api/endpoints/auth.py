import secrets
from fastapi import APIRouter, Depends, HTTPException, status, Request
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from sqlalchemy.orm import Session
from pydantic import BaseModel

from app.core.database import get_db
from app.core.security import (
    verify_password,
    create_access_token,
    create_refresh_token,
    get_password_hash,
    verify_token,
)
from app.core.config import settings
from app.core.rate_limit import is_rate_limited
from app.models.models import User, UserRole
from app.schemas.user import Token, AccessToken, RefreshRequest, LoginRequest, UserCreate, UserResponse

router = APIRouter()
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")


@router.post("/register", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
def register(user_data: UserCreate, db: Session = Depends(get_db)):
    """Register a new user"""
    # Check if username exists
    existing_user = db.query(User).filter(User.username == user_data.username).first()
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Username already registered"
        )
    
    # Check if email exists
    existing_email = db.query(User).filter(User.email == user_data.email).first()
    if existing_email:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email already registered"
        )
    
    # Create new user
    new_user = User(
        username=user_data.username,
        email=user_data.email,
        full_name=user_data.full_name,
        hashed_password=get_password_hash(user_data.password)
    )
    
    db.add(new_user)
    db.commit()
    db.refresh(new_user)

    # Seed default categories + currencies for the new user.
    try:
        from app.services.seed_service import seed_user_defaults
        seed_user_defaults(db, new_user.id)
    except Exception:
        db.rollback()

    from app.core.household import ensure_household
    ensure_household(db, new_user)

    return new_user


# ── Google Identity Services (GIS) "Sign in with Google" — Client-ID-only ──
@router.get("/google/client-id")
def google_client_id():
    """Public: the frontend fetches the Client ID to render the Google button.
    No secret is exposed — the Client ID is a public value."""
    cid = settings.GOOGLE_CLIENT_ID or ""
    return {"client_id": cid, "configured": bool(cid)}


class GoogleVerifyRequest(BaseModel):
    credential: str  # the Google ID token (JWT) returned to the browser by GIS


@router.post("/google/verify", response_model=Token)
def google_verify(data: GoogleVerifyRequest, db: Session = Depends(get_db)):
    """Verify a Google ID token against our Client ID, then find-or-create the
    user and issue app tokens. No client secret / credentials.json required."""
    if not settings.GOOGLE_CLIENT_ID:
        raise HTTPException(status_code=503, detail="Google login is not configured on the server.")
    try:
        from google.oauth2 import id_token as google_id_token
        from google.auth.transport import requests as google_requests
        info = google_id_token.verify_oauth2_token(
            data.credential, google_requests.Request(), settings.GOOGLE_CLIENT_ID
        )
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid or expired Google credential")

    email = (info.get("email") or "").lower()
    if not email or info.get("email_verified") is False:
        raise HTTPException(status_code=401, detail="Google account email unavailable or unverified")

    user = db.query(User).filter(User.email == email).first()
    if not user:
        base = (email.split("@")[0] or "user")[:40]
        username, i = base, 1
        while db.query(User).filter(User.username == username).first():
            username = f"{base}{i}"; i += 1
        user = User(
            username=username, email=email, full_name=info.get("name"),
            avatar_url=info.get("picture"),
            hashed_password=get_password_hash(secrets.token_urlsafe(24)),
            role=UserRole.USER, is_active=True,
        )
        db.add(user); db.commit(); db.refresh(user)
        try:
            from app.services.seed_service import seed_user_defaults
            seed_user_defaults(db, user.id)
        except Exception:
            db.rollback()
        from app.core.household import ensure_household
        ensure_household(db, user)
    elif not user.avatar_url and info.get("picture"):
        user.avatar_url = info.get("picture"); db.commit()

    if not user.is_active:
        raise HTTPException(status_code=403, detail="This account is disabled")

    return {
        "access_token": create_access_token(data={"sub": str(user.id)}),
        "refresh_token": create_refresh_token(data={"sub": str(user.id)}),
        "token_type": "bearer",
    }


@router.post("/login", response_model=Token)
def login(
    request: Request,
    form_data: OAuth2PasswordRequestForm = Depends(),
    db: Session = Depends(get_db)
):
    """Login user and return tokens"""
    # Brute-force protection: throttle by client IP + attempted username.
    client_ip = request.client.host if request.client else "unknown"
    rate_key = f"login:{client_ip}:{(form_data.username or '').lower()}"
    if is_rate_limited(rate_key, settings.LOGIN_RATE_LIMIT_MAX, settings.LOGIN_RATE_LIMIT_WINDOW_SECONDS):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many login attempts. Please try again later.",
        )

    # Find user
    user = db.query(User).filter(User.username == form_data.username).first()

    if not user or not verify_password(form_data.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Inactive user"
        )

    # Create tokens
    access_token = create_access_token(data={"sub": str(user.id)})
    refresh_token = create_refresh_token(data={"sub": str(user.id)})

    return {
        "access_token": access_token,
        "refresh_token": refresh_token,
        "token_type": "bearer"
    }


@router.post("/refresh", response_model=AccessToken)
def refresh_access_token(
    payload: RefreshRequest,
    db: Session = Depends(get_db)
):
    """Exchange a valid refresh token for a new access token."""
    token_data = verify_token(payload.refresh_token, expected_type="refresh")
    user_id = token_data.get("sub")
    if user_id is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid refresh token",
        )

    user = db.query(User).filter(User.id == int(user_id)).first()
    if user is None or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found or inactive",
        )

    access_token = create_access_token(data={"sub": str(user.id)})
    return {"access_token": access_token, "token_type": "bearer"}


def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db)
) -> User:
    """Get current authenticated user"""
    payload = verify_token(token, expected_type="access")
    user_id = payload.get("sub")
    
    if user_id is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not validate credentials"
        )
    
    user = db.query(User).filter(User.id == int(user_id)).first()
    
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )
    
    return user


def get_current_active_user(current_user: User = Depends(get_current_user)) -> User:
    """Get current active user"""
    if not current_user.is_active:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Inactive user"
        )
    return current_user


def get_current_admin_user(current_user: User = Depends(get_current_active_user)) -> User:
    """Require the current user to be an admin. Use to gate instance-wide operations
    (viewing server logs, global cleanup, cross-user actions)."""
    if current_user.role != UserRole.ADMIN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Administrator privileges required",
        )
    return current_user


def require_write_access(current_user: User = Depends(get_current_active_user)) -> User:
    """Block a VIEWER (read-only family/friend account) from creating, editing,
    or deleting financial records. Use in place of get_current_active_user on
    mutating routes (POST/PUT/DELETE) for transactions, banks, budgets, goals,
    templates, reward points, imports, and PDFs -- everywhere a VIEWER should be
    able to look but not touch."""
    if current_user.role == UserRole.VIEWER:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Your account has read-only access",
        )
    return current_user
