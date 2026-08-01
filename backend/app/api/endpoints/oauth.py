from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session
from google_auth_oauthlib.flow import Flow
from google.oauth2.credentials import Credentials
from jose import jwt, JWTError
from datetime import timedelta
import logging
import json
import os

from app.core.time_utils import utcnow
from app.core.database import get_db
from app.core.config import settings
from app.core.crypto import encrypt_value
from app.api.endpoints.auth import get_current_active_user
from app.models.models import User, GmailAccount

router = APIRouter()
logger = logging.getLogger(__name__)

# Gmail, Drive and Tasks all share the same credentials.json client. Once a Google
# account has granted a broader scope set (e.g. drive.file+tasks for the Drive
# connection), Google returns that FULL union of previously-granted scopes on any
# later consent for the same client+account — even one that only requested
# gmail.readonly. oauthlib's default strict scope check then raises "Scope has
# changed" and google-auth-oauthlib turns that into a hard failure. This is a
# well-known behavior with a documented escape hatch, not an app bug.
os.environ.setdefault("OAUTHLIB_RELAX_TOKEN_SCOPE", "1")

# Gmail OAuth scopes
SCOPES = ['https://www.googleapis.com/auth/gmail.readonly']

_OAUTH_STATE_TYPE = "oauth_state"
_OAUTH_STATE_TTL_MINUTES = 15


def _make_oauth_state(user_id: int) -> str:
    """Create a signed, short-lived OAuth state that binds the flow to a specific user.

    Signing with SECRET_KEY makes the state unforgeable, which both provides CSRF
    protection and lets the callback trust the embedded user_id instead of parsing it
    from an attacker-controllable query string.
    """
    payload = {
        "sub": str(user_id),
        "type": _OAUTH_STATE_TYPE,
        "exp": utcnow() + timedelta(minutes=_OAUTH_STATE_TTL_MINUTES),
    }
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


def _read_oauth_state(state: str) -> int:
    """Verify the signed state and return the user_id. Raises ValueError if invalid."""
    try:
        payload = jwt.decode(state, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
    except JWTError as exc:
        raise ValueError("invalid oauth state") from exc
    if payload.get("type") != _OAUTH_STATE_TYPE or payload.get("sub") is None:
        raise ValueError("invalid oauth state")
    return int(payload["sub"])


def _persist_token_file(credentials_dict: dict) -> None:
    """Persist the credentials to disk ENCRYPTED (never plaintext).

    The DB copy (EncryptedText) is authoritative; this file is a defensive fallback and
    must not leak the long-lived refresh_token / client_secret in cleartext.
    """
    token_path = settings.GMAIL_TOKEN_PATH
    if not token_path:
        return
    try:
        os.makedirs(os.path.dirname(token_path), exist_ok=True)
        with open(token_path, 'w', encoding='utf-8') as token_file:
            token_file.write(encrypt_value(json.dumps(credentials_dict)))
    except Exception:
        logger.warning("Failed to persist encrypted token file", exc_info=True)


@router.get("/gmail/auth-url")
def get_gmail_auth_url(
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db)
):
    """Get Gmail OAuth authorization URL"""
    try:
        credentials_path = os.path.join(settings.BASE_DIR, 'credentials', 'credentials.json')
        
        if not os.path.exists(credentials_path):
            raise HTTPException(
                status_code=500,
                detail="Gmail credentials.json not found. Please configure OAuth credentials."
            )
        
        flow = Flow.from_client_secrets_file(
            credentials_path,
            scopes=SCOPES,
            redirect_uri=f"{settings.BACKEND_URL}/api/oauth/gmail/callback"
        )
        
        # Signed state binds this flow to the current user (CSRF protection).
        state = _make_oauth_state(current_user.id)
        authorization_url, state = flow.authorization_url(
            access_type='offline',
            include_granted_scopes='true',
            prompt='consent',
            state=state
        )

        return {
            "auth_url": authorization_url,
            "state": state
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Failed to generate OAuth URL: %s", e, exc_info=True)
        raise HTTPException(
            status_code=500,
            detail="Failed to generate OAuth URL"
        )


@router.get("/gmail/callback")
async def gmail_oauth_callback(
    code: str,
    state: str,
    request: Request = None,
    db: Session = Depends(get_db)
):
    """Handle Gmail OAuth callback"""
    # Verify the signed state BEFORE doing anything else. A missing/forged/expired state
    # is rejected outright — there is no insecure user_id default to fall back to.
    try:
        user_id = _read_oauth_state(state)
    except ValueError:
        logger.warning("Rejected Gmail OAuth callback with invalid/expired state")
        return RedirectResponse(
            url=f"{settings.FRONTEND_URL}/banks?error=invalid_state",
            status_code=302
        )

    try:
        credentials_path = os.path.join(settings.BASE_DIR, 'credentials', 'credentials.json')

        flow = Flow.from_client_secrets_file(
            credentials_path,
            scopes=SCOPES,
            redirect_uri=f"{settings.BACKEND_URL}/api/oauth/gmail/callback",
            state=state
        )
        
        flow.fetch_token(code=code)
        
        credentials = flow.credentials
        
        # Get user email from Gmail API
        from googleapiclient.discovery import build
        import warnings
        warnings.filterwarnings('ignore', message='file_cache is only supported')
        
        service = build('gmail', 'v1', credentials=credentials, cache_discovery=False)
        profile = service.users().getProfile(userId='me').execute()
        email_address = profile['emailAddress']
        
        # Save credentials to database. Persist `expiry` so the app can proactively
        # refresh (and re-persist) the access token instead of forcing periodic re-auth.
        credentials_dict = {
            'token': credentials.token,
            'refresh_token': credentials.refresh_token,
            'token_uri': credentials.token_uri,
            'client_id': credentials.client_id,
            'client_secret': credentials.client_secret,
            'scopes': credentials.scopes,
            'expiry': credentials.expiry.isoformat() if credentials.expiry else None,
        }

        _persist_token_file(credentials_dict)
        
        existing = db.query(GmailAccount).filter(
            GmailAccount.user_id == user_id,
            GmailAccount.email == email_address
        ).first()
        
        if existing:
            existing.credentials = json.dumps(credentials_dict)
            existing.is_active = True
            existing.created_at = utcnow()
            existing.last_synced = utcnow()
        else:
            account = GmailAccount(
                user_id=user_id,
                email=email_address,
                credentials=json.dumps(credentials_dict),
                is_active=True,
                last_synced=utcnow()
            )
            db.add(account)
        
        db.commit()
        
        return RedirectResponse(
            url=f"{settings.FRONTEND_URL}/banks?gmail_connected={email_address}",
            status_code=302
        )
    except Exception as e:
        # Log full detail server-side; never leak exception text into the redirect URL.
        logger.error("Gmail OAuth callback failed: %s", e, exc_info=True)
        return RedirectResponse(
            url=f"{settings.FRONTEND_URL}/banks?error=oauth_failed",
            status_code=302
        )


# --------------------------------------------------------------------------
# Google Sign-In (login with Google). Reuses the same credentials.json client
# with openid/email/profile scopes; requires the redirect URI
#   {BACKEND_URL}/api/oauth/google/callback
# to be registered in the Google Cloud console.
# --------------------------------------------------------------------------
GOOGLE_LOGIN_SCOPES = ['openid', 'https://www.googleapis.com/auth/userinfo.email',
                       'https://www.googleapis.com/auth/userinfo.profile']
_LOGIN_STATE_TYPE = "google_login"


def _make_login_state() -> str:
    payload = {"type": _LOGIN_STATE_TYPE, "exp": utcnow() + timedelta(minutes=_OAUTH_STATE_TTL_MINUTES)}
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


def _valid_login_state(state: str) -> bool:
    try:
        payload = jwt.decode(state, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
    except JWTError:
        return False
    return payload.get("type") == _LOGIN_STATE_TYPE


def _google_credentials_path() -> str:
    return os.path.join(settings.BASE_DIR, 'credentials', 'credentials.json')


@router.get("/google/login-url")
def google_login_url():
    """Return the Google Sign-In authorization URL (unauthenticated)."""
    path = _google_credentials_path()
    if not os.path.exists(path):
        raise HTTPException(status_code=503, detail="Google login is not configured (credentials.json missing).")
    try:
        flow = Flow.from_client_secrets_file(
            path, scopes=GOOGLE_LOGIN_SCOPES,
            redirect_uri=f"{settings.BACKEND_URL}/api/oauth/google/callback",
        )
        auth_url, _ = flow.authorization_url(
            access_type='offline', include_granted_scopes='true',
            prompt='select_account', state=_make_login_state(),
        )
        return {"auth_url": auth_url, "configured": True}
    except Exception as e:
        logger.error("Failed to build Google login URL: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to build Google login URL")


@router.get("/google/callback")
def google_login_callback(code: str, state: str, db: Session = Depends(get_db)):
    """Exchange the code, find-or-create the user, and redirect to the frontend with tokens."""
    from app.core.security import create_access_token, create_refresh_token, get_password_hash
    import secrets as _secrets

    if not _valid_login_state(state):
        return RedirectResponse(url=f"{settings.FRONTEND_URL}/login?error=invalid_state", status_code=302)
    try:
        flow = Flow.from_client_secrets_file(
            _google_credentials_path(), scopes=GOOGLE_LOGIN_SCOPES,
            redirect_uri=f"{settings.BACKEND_URL}/api/oauth/google/callback", state=state,
        )
        flow.fetch_token(code=code)
        from googleapiclient.discovery import build
        import warnings
        warnings.filterwarnings('ignore', message='file_cache is only supported')
        info = build('oauth2', 'v2', credentials=flow.credentials, cache_discovery=False).userinfo().get().execute()
        email = (info.get('email') or '').lower()
        if not email:
            raise ValueError("Google returned no email")

        user = db.query(User).filter(User.email == email).first()
        if not user:
            base = email.split('@')[0][:40] or 'user'
            username = base
            i = 1
            while db.query(User).filter(User.username == username).first():
                username = f"{base}{i}"; i += 1
            from app.models.models import UserRole
            user = User(
                username=username, email=email, full_name=info.get('name'),
                avatar_url=info.get('picture'),
                hashed_password=get_password_hash(_secrets.token_urlsafe(24)),
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
        elif not user.avatar_url and info.get('picture'):
            user.avatar_url = info.get('picture'); db.commit()

        if not user.is_active:
            return RedirectResponse(url=f"{settings.FRONTEND_URL}/login?error=account_disabled", status_code=302)

        access = create_access_token(data={"sub": str(user.id)})
        refresh = create_refresh_token(data={"sub": str(user.id)})
        # Tokens in the URL fragment (not sent to servers / kept out of access logs).
        return RedirectResponse(
            url=f"{settings.FRONTEND_URL}/login#access_token={access}&refresh_token={refresh}",
            status_code=302,
        )
    except Exception as e:
        logger.error("Google login callback failed: %s", e, exc_info=True)
        return RedirectResponse(url=f"{settings.FRONTEND_URL}/login?error=google_login_failed", status_code=302)


@router.post("/gmail/save-credentials")
def save_gmail_credentials(
    email: str,
    credentials_json: str,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db)
):
    """Save Gmail OAuth credentials after successful authentication"""
    try:
        # Check if account already exists
        existing = db.query(GmailAccount).filter(
            GmailAccount.user_id == current_user.id,
            GmailAccount.email == email
        ).first()
        
        if existing:
            existing.credentials = credentials_json
            existing.is_active = True
            existing.created_at = utcnow()
            existing.last_synced = utcnow()
        else:
            account = GmailAccount(
                user_id=current_user.id,
                email=email,
                credentials=credentials_json,
                is_active=True,
                last_synced=utcnow()
            )
            db.add(account)

        try:
            _persist_token_file(json.loads(credentials_json))
        except Exception:
            pass
        
        db.commit()
        
        return {"message": "Gmail account connected successfully", "email": email}
    except Exception as e:
        db.rollback()
        raise HTTPException(
            status_code=500,
            detail=f"Failed to save credentials: {str(e)}"
        )
