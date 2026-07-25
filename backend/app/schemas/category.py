from pydantic import BaseModel
from typing import Optional
from datetime import datetime


class CategoryBase(BaseModel):
    name: str
    icon: Optional[str] = "Category"
    color: Optional[str] = "#4e79a7"
    kind: Optional[str] = "expense"  # expense, income, transfer
    parent_id: Optional[int] = None
    sort_order: Optional[int] = 0


class CategoryCreate(CategoryBase):
    pass


class CategoryUpdate(BaseModel):
    name: Optional[str] = None
    icon: Optional[str] = None
    color: Optional[str] = None
    kind: Optional[str] = None
    parent_id: Optional[int] = None
    sort_order: Optional[int] = None


class CategoryResponse(CategoryBase):
    id: int
    user_id: int
    is_system: bool = False
    created_at: datetime

    class Config:
        from_attributes = True


class CategoryRuleBase(BaseModel):
    keyword: str
    category: str
    priority: Optional[int] = 0
    is_active: Optional[bool] = True


class CategoryRuleCreate(CategoryRuleBase):
    pass


class CategoryRuleUpdate(BaseModel):
    keyword: Optional[str] = None
    category: Optional[str] = None
    priority: Optional[int] = None
    is_active: Optional[bool] = None


class CategoryRuleResponse(CategoryRuleBase):
    id: int
    user_id: int
    created_at: datetime

    class Config:
        from_attributes = True
