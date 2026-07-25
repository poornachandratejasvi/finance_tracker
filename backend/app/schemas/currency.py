from pydantic import BaseModel
from typing import Optional
from datetime import datetime


class CurrencyBase(BaseModel):
    code: str            # ISO 4217, e.g. INR, USD
    symbol: Optional[str] = ""
    name: Optional[str] = None
    rate_to_base: Optional[float] = 1.0
    is_base: Optional[bool] = False


class CurrencyCreate(CurrencyBase):
    pass


class CurrencyUpdate(BaseModel):
    code: Optional[str] = None
    symbol: Optional[str] = None
    name: Optional[str] = None
    rate_to_base: Optional[float] = None
    is_base: Optional[bool] = None


class CurrencyResponse(CurrencyBase):
    id: int
    user_id: int
    created_at: datetime

    class Config:
        from_attributes = True
