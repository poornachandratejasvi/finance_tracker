"""Discord webhook configuration for Automatic Rules notifications."""
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session
from typing import Optional

from app.core.database import get_db
from app.api.endpoints.auth import get_current_active_user
from app.models.models import User
from app.services import discord_service

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
