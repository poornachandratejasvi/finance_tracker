"""Merged upcoming-items feed for the Calendar page -- packages + subscriptions,
server-sorted, so the frontend never merges multiple API calls client-side.
See calendar_service.get_upcoming_items (also used by the daily reminder task)."""
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.api_auth import get_current_user_flexible
from app.models.models import User
from app.services.calendar_service import get_upcoming_items

router = APIRouter()


@router.get("/")
def get_calendar(
    days_ahead: int = Query(60, ge=1, le=365),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_flexible),
):
    items = get_upcoming_items(db, current_user.id, days_ahead)
    return [
        {**item, "date": item["date"].isoformat() if item["date"] else None}
        for item in items
    ]
