"""Discord webhook + ntfy configuration for Automatic Rules notifications."""
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session
from typing import Optional

from app.core.database import get_db
from app.api.endpoints.auth import get_current_active_user
from app.models.models import User
from app.services import discord_service, ntfy_service

router = APIRouter()


@router.get("/discord")
def get_discord_config(db: Session = Depends(get_db), current_user: User = Depends(get_current_active_user)):
    return {"webhook_set": discord_service.has_webhook(db, current_user.id)}


class DiscordWebhookUpdate(BaseModel):
    webhook_url: Optional[str] = None  # empty/omitted clears it


@router.put("/discord")
def update_discord_config(data: DiscordWebhookUpdate, db: Session = Depends(get_db), current_user: User = Depends(get_current_active_user)):
    discord_service.set_webhook(db, current_user.id, data.webhook_url)
    return {"webhook_set": discord_service.has_webhook(db, current_user.id)}


@router.post("/discord/test")
def test_discord_webhook(db: Session = Depends(get_db), current_user: User = Depends(get_current_active_user)):
    ok, message = discord_service.send_test_message(db, current_user.id)
    return {"ok": ok, "message": message}


@router.get("/ntfy")
def get_ntfy_config(db: Session = Depends(get_db), current_user: User = Depends(get_current_active_user)):
    return ntfy_service.get_config(db, current_user.id) or {"server_url": "", "topic": "", "token": "", "username": "", "has_password": False}


class NtfyConfigUpdate(BaseModel):
    server_url: Optional[str] = None
    topic: Optional[str] = None  # empty/omitted clears the whole config
    token: Optional[str] = None  # omit to leave an already-saved token untouched
    username: Optional[str] = None
    password: Optional[str] = None


@router.put("/ntfy")
def update_ntfy_config(data: NtfyConfigUpdate, db: Session = Depends(get_db), current_user: User = Depends(get_current_active_user)):
    ntfy_service.set_config(
        db, current_user.id,
        server_url=data.server_url, topic=data.topic,
        token=data.token, username=data.username, password=data.password,
    )
    return ntfy_service.get_config(db, current_user.id) or {"server_url": "", "topic": "", "token": "", "username": "", "has_password": False}


@router.post("/ntfy/test")
def test_ntfy_config(db: Session = Depends(get_db), current_user: User = Depends(get_current_active_user)):
    ok, message = ntfy_service.send_test(db, current_user.id)
    return {"ok": ok, "message": message}
