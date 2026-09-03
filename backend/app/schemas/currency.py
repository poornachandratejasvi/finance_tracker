from pydantic import BaseModel
from typing import Optional
from datetime import datetime


class CurrencyBase(BaseModel):
    code: str            # ISO 4217, e.g. INR, USD
    symbol: Optional[str] = ""
    name: Optional[str] = None
    rate_to_base: Optional[float] = 1.0
    is_base: Optional[bool] = False
    # 'manual' -- rate_to_base only ever changes when the user edits it;
    # 'auto' -- the daily FX refresh task may overwrite it. New non-base
    # currencies default to 'auto' in the endpoint since that's usually wanted.
    rate_source: Optional[str] = "manual"


class CurrencyCreate(CurrencyBase):
    pass


class CurrencyUpdate(BaseModel):
    code: Optional[str] = None
    symbol: Optional[str] = None
    name: Optional[str] = None
    rate_to_base: Optional[float] = None
    is_base: Optional[bool] = None
    rate_source: Optional[str] = None


class CurrencyResponse(CurrencyBase):
    id: int
    user_id: int
    created_at: datetime
    rate_updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True
