from pydantic import BaseModel, EmailStr, model_validator
from typing import Optional
from datetime import datetime


class GmailAccountBase(BaseModel):
    email: EmailStr


class GmailAccountCreate(GmailAccountBase):
    credentials: str  # OAuth credentials JSON


class GmailAccountResponse(GmailAccountBase):
    id: int
    user_id: int
    is_active: bool
    last_synced: Optional[datetime] = None
    created_at: datetime
    last_checked_at: Optional[datetime] = None
    last_error: Optional[str] = None

    class Config:
        from_attributes = True


class BankBase(BaseModel):
    name: str
    code: Optional[str] = None
    logo_url: Optional[str] = None
    sender_email: Optional[str] = None
    sender_emails: Optional[str] = None
    sms_sender_pattern: Optional[str] = None
    account_number: Optional[str] = None
    account_password: Optional[str] = None
    bank_type: Optional[str] = None
    csv_email: Optional[str] = None
    current_balance: Optional[float] = None
    balance_updated_at: Optional[datetime] = None
    balance_source: Optional[str] = None
    currency_code: Optional[str] = None
    color: Optional[str] = None
    exclude_from_stats: Optional[bool] = None
    is_archived: Optional[bool] = None
    pdf_filename_prefix: Optional[str] = None


class BankCreate(BankBase):
    pass


class BankUpdate(BaseModel):
    name: Optional[str] = None
    code: Optional[str] = None
    logo_url: Optional[str] = None
    sender_email: Optional[str] = None
    sender_emails: Optional[str] = None
    sms_sender_pattern: Optional[str] = None
    account_number: Optional[str] = None
    account_password: Optional[str] = None
    bank_type: Optional[str] = None
    csv_email: Optional[str] = None
    current_balance: Optional[float] = None
    balance_updated_at: Optional[datetime] = None
    balance_source: Optional[str] = None
    currency_code: Optional[str] = None
    color: Optional[str] = None
    exclude_from_stats: Optional[bool] = None
    is_archived: Optional[bool] = None
    pdf_filename_prefix: Optional[str] = None
    is_active: Optional[bool] = None


class BankResponse(BankBase):
    id: int
    is_active: bool
    created_at: datetime
    has_password: bool = False
    last_synced_at: Optional[datetime] = None  # most recent statement pulled for this bank
    last_transaction_at: Optional[datetime] = None  # most recent transaction date
    computed_balance: Optional[float] = None  # owed (credit) / net (other) derived from transactions

    @model_validator(mode='after')
    def _set_has_password(self):
        self.has_password = bool(self.account_password)
        # Do not expose the plaintext password in list responses
        self.account_password = None
        return self

    class Config:
        from_attributes = True


class BankConfigBase(BaseModel):
    email_pattern: str
    subject_pattern: Optional[str] = None
    pdf_field_mapping: Optional[str] = None
    password_hints: Optional[str] = None


class BankConfigCreate(BankConfigBase):
    bank_id: int


class BankConfigUpdate(BaseModel):
    email_pattern: Optional[str] = None
    subject_pattern: Optional[str] = None
    pdf_field_mapping: Optional[str] = None
    password_hints: Optional[str] = None


class BankConfigResponse(BankConfigBase):
    id: int
    bank_id: int
    created_at: datetime
    updated_at: datetime
    
    class Config:
        from_attributes = True


class PDFStatementBase(BaseModel):
    file_name: str
    is_password_protected: bool = False


class PDFStatementCreate(PDFStatementBase):
    bank_email_id: int
    file_path: str
    password: Optional[str] = None


class PDFStatementResponse(PDFStatementBase):
    id: int
    bank_email_id: int
    is_processed: bool
    statement_period_start: Optional[datetime] = None
    statement_period_end: Optional[datetime] = None
    created_at: datetime
    
    class Config:
        from_attributes = True


class SyncRequest(BaseModel):
    gmail_account_id: Optional[int] = None
    bank_id: Optional[int] = None  # when set, only sync this one bank
    sync_type: str = "incremental"  # 'full' or 'incremental'
    start_date: Optional[datetime] = None
    end_date: Optional[datetime] = None


class SyncResponse(BaseModel):
    sync_log_id: int
    status: str
    emails_processed: int
    transactions_added: int
    duplicates_found: int
    started_at: datetime
    completed_at: Optional[datetime] = None
    error_message: Optional[str] = None
    
    class Config:
        from_attributes = True
