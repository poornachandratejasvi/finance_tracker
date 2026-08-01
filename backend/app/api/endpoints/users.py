import json
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from pydantic import BaseModel, EmailStr
from typing import Optional, List

from app.core.database import get_db
from app.core.security import verify_password, get_password_hash
from app.api.endpoints.auth import get_current_active_user
from app.models.models import User, UserRole, AppSetting

router = APIRouter()

# Sensible defaults for the Settings > General panel.
DEFAULT_PREFS = {
    "language": "en",
    "default_interval": "this_month",
    "hide_decimals": False,
    "auto_logout": False,
}


def _user_dict(u: User) -> dict:
    return {
        "id": u.id, "username": u.username, "email": u.email,
        "full_name": u.full_name, "avatar_url": u.avatar_url,
        "role": u.role, "is_active": u.is_active, "created_at": u.created_at,
        "household_id": u.household_id,
    }


def _require_admin(current_user: User):
    if current_user.role != UserRole.ADMIN:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Administrator access required")


# ----- current user -----
@router.get("/me")
def get_current_user_info(current_user: User = Depends(get_current_active_user)):
    return _user_dict(current_user)


class ProfileUpdate(BaseModel):
    full_name: Optional[str] = None
    email: Optional[EmailStr] = None
    avatar_url: Optional[str] = None


@router.put("/me")
def update_me(
    data: ProfileUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    update = data.dict(exclude_unset=True)
    if "email" in update and update["email"] and update["email"] != current_user.email:
        clash = db.query(User).filter(User.email == update["email"], User.id != current_user.id).first()
        if clash:
            raise HTTPException(status_code=400, detail="Email already in use")
        current_user.email = update["email"]
    if "full_name" in update:
        current_user.full_name = update["full_name"]
    if "avatar_url" in update:
        current_user.avatar_url = update["avatar_url"]
    db.commit()
    db.refresh(current_user)
    return _user_dict(current_user)


class PasswordChange(BaseModel):
    current_password: str
    new_password: str


@router.post("/me/change-password")
def change_password(
    data: PasswordChange,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    if not verify_password(data.current_password, current_user.hashed_password):
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    if len(data.new_password or "") < 8:
        raise HTTPException(status_code=400, detail="New password must be at least 8 characters")
    current_user.hashed_password = get_password_hash(data.new_password)
    db.commit()
    return {"status": "ok"}


# ----- preferences (Settings > General) -----
def _prefs_key(user_id: int) -> str:
    return f"prefs:{user_id}"


@router.get("/me/preferences")
def get_preferences(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    row = db.query(AppSetting).filter(AppSetting.key == _prefs_key(current_user.id)).first()
    prefs = dict(DEFAULT_PREFS)
    if row and row.value:
        try:
            prefs.update(json.loads(row.value))
        except (ValueError, TypeError):
            pass
    return prefs


@router.put("/me/preferences")
def update_preferences(
    data: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    key = _prefs_key(current_user.id)
    row = db.query(AppSetting).filter(AppSetting.key == key).first()
    prefs = dict(DEFAULT_PREFS)
    if row and row.value:
        try:
            prefs.update(json.loads(row.value))
        except (ValueError, TypeError):
            pass
    prefs.update({k: v for k, v in (data or {}).items() if k in DEFAULT_PREFS})
    if row:
        row.value = json.dumps(prefs)
    else:
        db.add(AppSetting(key=key, value=json.dumps(prefs)))
    db.commit()
    return prefs


# ----- admin user management -----
class AdminUserCreate(BaseModel):
    username: str
    email: EmailStr
    password: str
    full_name: Optional[str] = None
    role: Optional[str] = "USER"


class AdminUserUpdate(BaseModel):
    email: Optional[EmailStr] = None
    full_name: Optional[str] = None
    role: Optional[str] = None
    is_active: Optional[bool] = None
    password: Optional[str] = None
    avatar_url: Optional[str] = None


@router.get("/")
def list_users(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    _require_admin(current_user)
    return [_user_dict(u) for u in db.query(User).order_by(User.id).all()]


@router.post("/{user_id}/share-household-with/{other_user_id}")
def share_household(
    user_id: int,
    other_user_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Group `user_id` into `other_user_id`'s household — from then on they see
    each other's banks/transactions (a shared family/couple wallet). Personal
    settings (Gmail/Drive OAuth, AI keys, Discord webhook, API tokens) stay
    per-user regardless. The household `user_id` was in before is left as-is —
    if it's now empty, it's just an unused row, harmless."""
    _require_admin(current_user)
    u = db.query(User).filter(User.id == user_id).first()
    other = db.query(User).filter(User.id == other_user_id).first()
    if not u or not other:
        raise HTTPException(status_code=404, detail="User not found")
    if not other.household_id:
        raise HTTPException(status_code=400, detail=f"{other.username} has no household to join")
    u.household_id = other.household_id
    db.commit()
    return {"success": True, "household_id": u.household_id}


@router.post("/{user_id}/leave-household")
def leave_household(
    user_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Give `user_id` a fresh private household of their own, detaching them from
    whoever they were sharing with."""
    from app.models.models import Household
    _require_admin(current_user)
    u = db.query(User).filter(User.id == user_id).first()
    if not u:
        raise HTTPException(status_code=404, detail="User not found")
    household = Household(name=f"{u.username}'s Household")
    db.add(household)
    db.commit()
    db.refresh(household)
    u.household_id = household.id
    db.commit()
    return {"success": True, "household_id": u.household_id}


@router.post("/", status_code=status.HTTP_201_CREATED)
def create_user(
    data: AdminUserCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    _require_admin(current_user)
    if db.query(User).filter((User.username == data.username) | (User.email == data.email)).first():
        raise HTTPException(status_code=400, detail="Username or email already exists")
    try:
        role = UserRole[data.role] if data.role else UserRole.USER
    except KeyError:
        role = UserRole.USER
    u = User(
        username=data.username, email=data.email, full_name=data.full_name,
        hashed_password=get_password_hash(data.password), role=role, is_active=True,
    )
    db.add(u)
    db.commit()
    db.refresh(u)
    try:
        from app.services.seed_service import seed_user_defaults
        seed_user_defaults(db, u.id)
    except Exception:
        db.rollback()
    from app.core.household import ensure_household
    ensure_household(db, u)
    return _user_dict(u)


@router.put("/{user_id}")
def admin_update_user(
    user_id: int,
    data: AdminUserUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    _require_admin(current_user)
    u = db.query(User).filter(User.id == user_id).first()
    if not u:
        raise HTTPException(status_code=404, detail="User not found")
    update = data.dict(exclude_unset=True)
    if "email" in update and update["email"]:
        u.email = update["email"]
    if "full_name" in update:
        u.full_name = update["full_name"]
    if "avatar_url" in update:
        u.avatar_url = update["avatar_url"]
    if "is_active" in update and update["is_active"] is not None:
        u.is_active = update["is_active"]
    if "role" in update and update["role"]:
        try:
            u.role = UserRole[update["role"]]
        except KeyError:
            raise HTTPException(status_code=400, detail="Invalid role")
    if update.get("password"):
        u.hashed_password = get_password_hash(update["password"])
    db.commit()
    db.refresh(u)
    return _user_dict(u)


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def admin_delete_user(
    user_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    _require_admin(current_user)
    if user_id == current_user.id:
        raise HTTPException(status_code=400, detail="You cannot delete your own account")
    u = db.query(User).filter(User.id == user_id).first()
    if not u:
        raise HTTPException(status_code=404, detail="User not found")
    db.delete(u)
    db.commit()
    return None
