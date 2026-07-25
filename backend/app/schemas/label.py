from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime


class LabelBase(BaseModel):
    name: str
    color: str = "#3498db"
    auto_keywords: Optional[List[str]] = None


class LabelCreate(LabelBase):
    pass


class LabelUpdate(BaseModel):
    name: Optional[str] = None
    color: Optional[str] = None
    auto_keywords: Optional[List[str]] = None


class LabelResponse(LabelBase):
    id: int
    user_id: int
    created_at: datetime
    
    class Config:
        from_attributes = True


class AutoLabelRuleBase(BaseModel):
    keyword: str
    is_active: bool = True


class AutoLabelRuleCreate(AutoLabelRuleBase):
    label_id: int


class AutoLabelRuleUpdate(BaseModel):
    keyword: Optional[str] = None
    is_active: Optional[bool] = None


class AutoLabelRuleResponse(AutoLabelRuleBase):
    id: int
    label_id: int
    created_at: datetime
    
    class Config:
        from_attributes = True


class TransactionLabelCreate(BaseModel):
    transaction_id: int
    label_id: int


class BulkLabelRequest(BaseModel):
    transaction_ids: List[int]
    label_id: int
