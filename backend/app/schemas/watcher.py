from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime


class WatcherBase(BaseModel):
    name: str
    match_keywords: List[str]
    match_amount: Optional[float] = None  # null = keyword alone is enough
    frequency: Optional[str] = "monthly"  # daily | weekly | monthly | yearly
    is_active: Optional[bool] = True


class WatcherCreate(WatcherBase):
    pass


class WatcherUpdate(BaseModel):
    name: Optional[str] = None
    match_keywords: Optional[List[str]] = None
    match_amount: Optional[float] = None
    frequency: Optional[str] = None
    is_active: Optional[bool] = None


class WatcherResponse(WatcherBase):
    id: int
    user_id: int
    current_period: Optional[str] = None
    current_task_id: Optional[str] = None
    cleared_at: Optional[datetime] = None
    created_at: datetime
