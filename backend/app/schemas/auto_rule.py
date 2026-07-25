from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime


class AutoRuleBase(BaseModel):
    name: str
    keywords: List[str] = []
    record_type: Optional[str] = "any"   # any | debit | credit | transfer
    category: Optional[str] = None
    label_ids: List[int] = []
    priority: Optional[int] = 0
    is_active: Optional[bool] = True
    notify_discord: Optional[bool] = False


class AutoRuleCreate(AutoRuleBase):
    pass


class AutoRuleUpdate(BaseModel):
    name: Optional[str] = None
    keywords: Optional[List[str]] = None
    record_type: Optional[str] = None
    category: Optional[str] = None
    label_ids: Optional[List[int]] = None
    priority: Optional[int] = None
    is_active: Optional[bool] = None
    notify_discord: Optional[bool] = None


class AutoRuleResponse(AutoRuleBase):
    id: int
    user_id: int
    created_at: datetime

    class Config:
        from_attributes = True
