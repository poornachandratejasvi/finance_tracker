from pydantic import BaseModel, Field, field_validator
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
    vehicle_id: Optional[int] = None
    # Client-generated UUID from the mobile app's offline write queue -- lets a
    # retried submission (e.g. the network dropped after the server committed
    # but before the response arrived) return the existing row instead of
    # creating a duplicate. Never set by any other client (web, ingest paths).
    client_uuid: Optional[str] = None

    # Sign is carried by transaction_type, never by amount itself (every other
    # ingestion path -- ingest.py's _coerce_amount, PDF parsing -- already
    # enforces this). A client can still hand back a signed value (e.g. the
    # iOS "Add Transaction" Shortcut's offline-queue fallback forwarding
    # Shortcuts' own signed "Amount" variable as-is), which would otherwise
    # store a negative amount that breaks every downstream sum and the
    # cross-source duplicate matcher's amount comparison.
    @field_validator("amount")
    @classmethod
    def _normalize_amount_sign(cls, v):
        return abs(v)


class TransactionUpdate(BaseModel):
    description: Optional[str] = None
    amount: Optional[float] = None
    transaction_type: Optional[TransactionType] = None
    category: Optional[str] = None
    from_account: Optional[str] = None
    to_account: Optional[str] = None
    notes: Optional[str] = None
    transaction_date: Optional[datetime] = None
    # No reliable signal in bank data indicates which vehicle a fuel/service/
    # toll charge belongs to -- user-assigned. Send `null` explicitly to
    # clear an existing assignment (the endpoint uses exclude_unset=True, so
    # omitting the field entirely leaves it untouched, but an explicit null
    # is still applied).
    vehicle_id: Optional[int] = None

    @field_validator("amount")
    @classmethod
    def _normalize_amount_sign(cls, v):
        return abs(v) if v is not None else v


class TransactionResponse(TransactionBase):
    id: int
    user_id: int
    bank_id: int
    bank_name: Optional[str] = None
    bank_type: Optional[str] = None
    bank_color: Optional[str] = None
    currency_code: Optional[str] = None
    pdf_statement_id: Optional[int] = None
    is_duplicate: bool
    duplicate_group_id: Optional[str] = None
    is_manual: bool = False
    is_confirmed: bool = True
    source: Optional[str] = None
    client_uuid: Optional[str] = None
    paperless_document_id: Optional[int] = None
    receipt_url: Optional[str] = None  # computed: Paperless-ngx document link, if archived there
    vehicle_id: Optional[int] = None
    vehicle_label: Optional[str] = None  # computed: nickname or registration number, for display
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
    vehicle_id: Optional[int] = None


class DuplicateGroup(BaseModel):
    duplicate_group_id: str
    transactions: List[TransactionResponse]
    total_amount: float
    count: int
