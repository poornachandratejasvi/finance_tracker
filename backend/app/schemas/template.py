from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime


class TemplateBase(BaseModel):
    name: str
    bank_id: Optional[int] = None
    category: Optional[str] = None
    amount: Optional[float] = None
    transaction_type: Optional[str] = "debit"
    description: Optional[str] = None
    notes: Optional[str] = None
    currency_code: Optional[str] = None
    label_ids: List[int] = []


class TemplateCreate(TemplateBase):
    pass


class TemplateUpdate(BaseModel):
    name: Optional[str] = None
    bank_id: Optional[int] = None
    category: Optional[str] = None
    amount: Optional[float] = None
    transaction_type: Optional[str] = None
    description: Optional[str] = None
    notes: Optional[str] = None
    currency_code: Optional[str] = None
    label_ids: Optional[List[int]] = None


class TemplateResponse(TemplateBase):
    id: int
    user_id: int
    created_at: datetime

    class Config:
        from_attributes = True
