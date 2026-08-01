from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import datetime
from app.models.models import TransactionType


class TransactionBase(BaseModel):
    transaction_date: datetime
    description: str
    amount: float
    transaction_type: TransactionType
    balance: Optional[float] = None
    reference_number: Optional[str] = None
    category: Optional[str] = None
    from_account: Optional[str] = None
    to_account: Optional[str] = None
    notes: Optional[str] = None


class TransactionCreate(TransactionBase):
    bank_id: int
    pdf_statement_id: Optional[int] = None


class TransactionUpdate(BaseModel):
    description: Optional[str] = None
    amount: Optional[float] = None
    transaction_type: Optional[TransactionType] = None
    category: Optional[str] = None
    from_account: Optional[str] = None
    to_account: Optional[str] = None
    notes: Optional[str] = None
    transaction_date: Optional[datetime] = None


class TransactionResponse(TransactionBase):
    id: int
    user_id: int
    bank_id: int
    bank_name: Optional[str] = None
    bank_type: Optional[str] = None
    currency_code: Optional[str] = None
    pdf_statement_id: Optional[int] = None
    is_duplicate: bool
    duplicate_group_id: Optional[str] = None
    is_manual: bool = False
    is_confirmed: bool = True
    source: Optional[str] = None
    labels: List[str] = []
    label_details: List[dict] = []  # [{id,name,color}] for colored chips
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class BulkDeleteRequest(BaseModel):
    transaction_ids: List[int]


class TransactionFilter(BaseModel):
    bank_id: Optional[int] = None
    start_date: Optional[datetime] = None
    end_date: Optional[datetime] = None
    transaction_type: Optional[TransactionType] = None
    category: Optional[str] = None
    min_amount: Optional[float] = None
    max_amount: Optional[float] = None
    search_query: Optional[str] = None
    label_ids: Optional[List[int]] = []
    show_duplicates: Optional[bool] = None


class DuplicateGroup(BaseModel):
    duplicate_group_id: str
    transactions: List[TransactionResponse]
    total_amount: float
    count: int
