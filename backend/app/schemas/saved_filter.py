from pydantic import BaseModel
from typing import Optional, Any
from datetime import datetime


class SavedFilterBase(BaseModel):
    name: str
    scope: Optional[str] = "records"  # records | analytics
    payload: Optional[Any] = None      # arbitrary filter object


class SavedFilterCreate(SavedFilterBase):
    pass


class SavedFilterUpdate(BaseModel):
    name: Optional[str] = None
    scope: Optional[str] = None
    payload: Optional[Any] = None


class SavedFilterResponse(SavedFilterBase):
    id: int
    user_id: int
    created_at: datetime

    class Config:
        from_attributes = True
