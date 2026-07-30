from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime


class NotificationRuleBase(BaseModel):
    name: str
    trigger_type: str = "match"          # 'match' | 'absence'
    keywords: List[str] = []
    keyword_negate: Optional[bool] = False
    record_type: Optional[str] = "any"   # any | debit | credit | transfer
    bank_id: Optional[int] = None
    amount_operator: Optional[str] = "none"  # none | eq | gte | lte | between
    amount_value: Optional[float] = None
    amount_value_max: Optional[float] = None
    amount_negate: Optional[bool] = False
    condition_logic: Optional[str] = "and"   # 'and' | 'or' — used only when both conditions are set
    check_day_of_month: Optional[int] = 28
    notify_discord: Optional[bool] = False
    notify_email: Optional[bool] = False
    email_to: Optional[str] = None
    notify_task: Optional[bool] = False
    is_active: Optional[bool] = True


class NotificationRuleCreate(NotificationRuleBase):
    pass


class NotificationRuleUpdate(BaseModel):
    name: Optional[str] = None
    trigger_type: Optional[str] = None
    keywords: Optional[List[str]] = None
    keyword_negate: Optional[bool] = None
    record_type: Optional[str] = None
    bank_id: Optional[int] = None
    amount_operator: Optional[str] = None
    amount_value: Optional[float] = None
    amount_value_max: Optional[float] = None
    amount_negate: Optional[bool] = None
    condition_logic: Optional[str] = None
    check_day_of_month: Optional[int] = None
    notify_discord: Optional[bool] = None
    notify_email: Optional[bool] = None
    email_to: Optional[str] = None
    notify_task: Optional[bool] = None
    is_active: Optional[bool] = None


class NotificationRuleResponse(NotificationRuleBase):
    id: int
    user_id: int
    bank_name: Optional[str] = None
    last_triggered_at: Optional[datetime] = None
    last_triggered_month: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True
