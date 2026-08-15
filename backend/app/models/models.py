from sqlalchemy import Column, Integer, String, DateTime, Boolean, ForeignKey, Text, Float, Index, Enum as SQLEnum
from sqlalchemy.orm import relationship
import enum
from app.core.database import Base
from app.core.crypto import EncryptedText
from app.core.time_utils import utcnow


class UserRole(str, enum.Enum):
    ADMIN = "ADMIN"
    USER = "USER"
    VIEWER = "VIEWER"


class TransactionType(str, enum.Enum):
    DEBIT = "debit"
    CREDIT = "credit"


class Household(Base):
    """A shared visibility group — members see each other's banks/transactions
    (a family/couple's shared wallet), while everything personal to an individual
    (Gmail/Drive OAuth, AI provider keys, Discord webhook, API tokens) stays
    per-user regardless of household membership. Every user belongs to exactly
    one household; a brand-new user gets a private one-person household of their
    own until an admin groups them with someone else."""
    __tablename__ = "households"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(150), nullable=False)
    created_at = Column(DateTime, default=utcnow)

    members = relationship("User", back_populates="household")


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(50), unique=True, index=True, nullable=False)
    email = Column(String(100), unique=True, index=True, nullable=False)
    hashed_password = Column(String(255), nullable=False)
    full_name = Column(String(100))
    avatar_url = Column(Text)  # profile photo (data URL or path)
    role = Column(SQLEnum(UserRole), default=UserRole.USER, nullable=False)
    is_active = Column(Boolean, default=True)
    household_id = Column(Integer, ForeignKey("households.id", ondelete="SET NULL"), index=True)
    created_at = Column(DateTime, default=utcnow)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)

    # Relationships
    gmail_accounts = relationship("GmailAccount", back_populates="user", cascade="all, delete-orphan")
    transactions = relationship("Transaction", back_populates="user")
    labels = relationship("Label", back_populates="user", cascade="all, delete-orphan")
    banks = relationship("Bank", back_populates="user", cascade="all, delete-orphan")
    household = relationship("Household", back_populates="members")


class GmailAccount(Base):
    __tablename__ = "gmail_accounts"
    
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    email = Column(String(100), nullable=False)
    credentials = Column(EncryptedText)  # OAuth credentials, encrypted at rest
    is_active = Column(Boolean, default=True)
    last_synced = Column(DateTime)
    created_at = Column(DateTime, default=utcnow)

    # Health monitoring (periodic Celery beat check, see gmail_health_tasks.py).
    last_checked_at = Column(DateTime)
    last_error = Column(Text)
    # Idempotency guard: only fire the reauth-needed notification once per outage,
    # not on every health-check tick until the account is reconnected (which clears
    # this back to None).
    reauth_notified_at = Column(DateTime)

    # Relationships
    user = relationship("User", back_populates="gmail_accounts")
    bank_emails = relationship("BankEmail", back_populates="gmail_account")


class Bank(Base):
    __tablename__ = "banks"
    
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    name = Column(String(100), nullable=False)
    code = Column(String(20), nullable=True)
    logo_url = Column(String(255))
    sender_email = Column(String(255))  # Primary email (kept for backwards compatibility)
    sender_emails = Column(Text)  # JSON array of multiple emails
    account_number = Column(String(100))
    account_password = Column(EncryptedText)  # Bank/PDF password, encrypted at rest
    bank_type = Column(String(50), default='savings')  # savings, credit, other
    csv_email = Column(String(255))
    current_balance = Column(Float)
    balance_updated_at = Column(DateTime)
    # 'auto' (from statement redetection) | 'manual' (user set it via Edit Bank) —
    # the automatic periodic redetection (credit_balance_tasks.py) skips 'manual'
    # cards so it never silently overwrites a value the user just set; the
    # explicit "Redetect Credit Balances" button still overrides it on request.
    balance_source = Column(String(10), default="auto")
    # Statement date whose reward-points figure last reconciled the RewardPointEntry
    # ledger (see reward_points_service.py) -- same out-of-order-statement guard as
    # balance_updated_at, kept as its own column since the two can legitimately
    # diverge (a statement might have one field but not the other).
    reward_points_updated_at = Column(DateTime)
    currency_code = Column(String(3), default='INR')  # ISO 4217 currency of this account
    color = Column(String(7))  # hex tile/dot color; NULL -> derived from bank_type
    exclude_from_stats = Column(Boolean, default=False)  # hide from dashboard/analytics totals
    is_archived = Column(Boolean, default=False)  # hidden unless "Show Archived"
    field_mapping = Column(Text)  # JSON mapping of PDF fields to app fields
    pdf_filename_prefix = Column(String(100))  # Filter: only process PDFs whose filename starts with this prefix
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=utcnow)
    
    # Relationships
    user = relationship("User", back_populates="banks")
    bank_configs = relationship("BankConfig", back_populates="bank", cascade="all, delete-orphan")
    transactions = relationship("Transaction", back_populates="bank")
    bank_emails = relationship("BankEmail", back_populates="bank")


class BankConfig(Base):
    __tablename__ = "bank_configs"
    
    id = Column(Integer, primary_key=True, index=True)
    bank_id = Column(Integer, ForeignKey("banks.id", ondelete="CASCADE"), nullable=False, index=True)
    email_pattern = Column(String(255), nullable=False)  # Regex pattern for bank emails
    subject_pattern = Column(String(255))  # Pattern to match in subject
    pdf_field_mapping = Column(Text)  # JSON mapping of PDF fields
    password_hints = Column(EncryptedText)  # JSON password candidates, encrypted at rest
    created_at = Column(DateTime, default=utcnow)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)
    
    # Relationships
    bank = relationship("Bank", back_populates="bank_configs")


class BankEmail(Base):
    __tablename__ = "bank_emails"
    
    id = Column(Integer, primary_key=True, index=True)
    gmail_account_id = Column(Integer, ForeignKey("gmail_accounts.id", ondelete="CASCADE"), nullable=False, index=True)
    bank_id = Column(Integer, ForeignKey("banks.id", ondelete="CASCADE"), nullable=False, index=True)
    email_id = Column(String(255), unique=True, nullable=False)
    subject = Column(String(500))
    from_email = Column(String(255))  # Actual sender address from the email headers
    received_date = Column(DateTime)
    has_attachment = Column(Boolean, default=False)
    is_processed = Column(Boolean, default=False)
    # 'statement' (has a PDF, the original/default meaning) | 'alert' (a real-time
    # spend/credit notification email, no PDF — see alert_email_service.py).
    email_type = Column(String(20), default="statement")
    created_at = Column(DateTime, default=utcnow)

    # Relationships
    gmail_account = relationship("GmailAccount", back_populates="bank_emails")
    bank = relationship("Bank", back_populates="bank_emails")
    pdf_statements = relationship("PDFStatement", back_populates="bank_email", cascade="all, delete-orphan")


class PDFStatement(Base):
    __tablename__ = "pdf_statements"
    
    id = Column(Integer, primary_key=True, index=True)
    bank_email_id = Column(Integer, ForeignKey("bank_emails.id", ondelete="CASCADE"), nullable=False, index=True)
    file_path = Column(String(500), nullable=False)
    file_name = Column(String(255), nullable=False)
    decrypted_path = Column(String(500))
    decrypted_at = Column(DateTime)
    is_password_protected = Column(Boolean, default=False)
    password_hash = Column(EncryptedText)  # PDF password, encrypted at rest
    is_processed = Column(Boolean, default=False)
    error_message = Column(Text)  # populated when parsing fails; cleared on success
    statement_period_start = Column(DateTime)
    statement_period_end = Column(DateTime)
    created_at = Column(DateTime, default=utcnow)

    # Relationships
    bank_email = relationship("BankEmail", back_populates="pdf_statements")
    transactions = relationship("Transaction", back_populates="pdf_statement", cascade="all, delete-orphan")


class Transaction(Base):
    __tablename__ = "transactions"
    
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    bank_id = Column(Integer, ForeignKey("banks.id", ondelete="CASCADE"), nullable=False, index=True)
    pdf_statement_id = Column(Integer, ForeignKey("pdf_statements.id", ondelete="CASCADE"), index=True)

    transaction_date = Column(DateTime, nullable=False, index=True)
    description = Column(Text, nullable=False)
    amount = Column(Float, nullable=False)
    transaction_type = Column(SQLEnum(TransactionType), nullable=False)
    balance = Column(Float)
    reference_number = Column(String(100))
    category = Column(String(50))
    currency_code = Column(String(3))  # ISO 4217; NULL -> inherits the owning account's currency
    
    # Sender/Receiver information
    from_account = Column(String(100))
    to_account = Column(String(100))
    
    # Additional metadata
    original_description = Column(Text)  # Original from PDF
    notes = Column(Text)  # User comments/notes
    is_duplicate = Column(Boolean, default=False)
    duplicate_group_id = Column(String(50))
    is_manual = Column(Boolean, default=False)  # Manually entered transaction
    custom_fields = Column(Text)  # JSON string for custom fields
    source = Column(String(50))  # Origin of the row: 'pdf', 'manual', 'ingest', 'alert', etc.

    # 'alert' rows (parsed from a real-time bank SMS/email alert, before the official
    # statement arrives) start life unconfirmed; everything else defaults confirmed.
    # Still included in every total/analysis — this only drives the "Pending" UI badge
    # and the statement-arrival reconciliation match (see transaction_hooks.py).
    is_confirmed = Column(Boolean, default=True)
    confirmed_at = Column(DateTime)

    created_at = Column(DateTime, default=utcnow)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)

    # Relationships
    user = relationship("User", back_populates="transactions")
    bank = relationship("Bank", back_populates="transactions")
    pdf_statement = relationship("PDFStatement", back_populates="transactions")
    transaction_labels = relationship("TransactionLabel", back_populates="transaction", cascade="all, delete-orphan")

    # Composite index for the hot list/dashboard query (per-user, newest first).
    __table_args__ = (
        Index("ix_transactions_user_date", "user_id", "transaction_date"),
        Index("ix_transactions_user_bank", "user_id", "bank_id"),
    )


class Label(Base):
    __tablename__ = "labels"
    
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    name = Column(String(50), nullable=False)
    color = Column(String(7), default="#3498db")  # Hex color code
    created_at = Column(DateTime, default=utcnow)
    
    # Relationships
    user = relationship("User", back_populates="labels")
    transaction_labels = relationship("TransactionLabel", back_populates="label", cascade="all, delete-orphan")
    auto_label_rules = relationship("AutoLabelRule", back_populates="label", cascade="all, delete-orphan")


class TransactionLabel(Base):
    __tablename__ = "transaction_labels"
    
    id = Column(Integer, primary_key=True, index=True)
    transaction_id = Column(Integer, ForeignKey("transactions.id", ondelete="CASCADE"), nullable=False, index=True)
    label_id = Column(Integer, ForeignKey("labels.id", ondelete="CASCADE"), nullable=False, index=True)
    created_at = Column(DateTime, default=utcnow)
    
    # Relationships
    transaction = relationship("Transaction", back_populates="transaction_labels")
    label = relationship("Label", back_populates="transaction_labels")


class AutoLabelRule(Base):
    __tablename__ = "auto_label_rules"
    
    id = Column(Integer, primary_key=True, index=True)
    label_id = Column(Integer, ForeignKey("labels.id", ondelete="CASCADE"), nullable=False, index=True)
    keyword = Column(String(100), nullable=False)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=utcnow)
    
    # Relationships
    label = relationship("Label", back_populates="auto_label_rules")


class SyncLog(Base):
    __tablename__ = "sync_logs"
    
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), index=True)
    gmail_account_id = Column(Integer, ForeignKey("gmail_accounts.id", ondelete="SET NULL"))
    sync_type = Column(String(50))  # 'full', 'incremental'
    emails_processed = Column(Integer, default=0)
    transactions_added = Column(Integer, default=0)
    duplicates_found = Column(Integer, default=0)
    status = Column(String(20))  # 'queued', 'processing', 'success', 'failed', 'partial'
    error_message = Column(Text)
    # Live-progress fields, updated incrementally while a sync runs so the UI can show
    # an "x of N" bar and the current step instead of a binary processing/done state.
    total_emails = Column(Integer, default=0)
    processed_emails = Column(Integer, default=0)
    current_step = Column(String(150))
    current_bank = Column(String(150))
    started_at = Column(DateTime, default=utcnow)
    completed_at = Column(DateTime)

    gmail_account = relationship("GmailAccount")


class ApiToken(Base):
    """Long-lived, hashed API token for unattended clients (e.g. iOS Shortcuts).

    Only the SHA-256 hash of the token is stored; the plaintext is shown to the user
    exactly once at creation time.
    """
    __tablename__ = "api_tokens"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    name = Column(String(100))  # e.g. "iOS Shortcut"
    token_prefix = Column(String(16), index=True)  # first chars for lookup/display
    token_hash = Column(String(128), nullable=False)  # sha256 hex of the full token
    is_active = Column(Boolean, default=True)
    last_used_at = Column(DateTime)
    created_at = Column(DateTime, default=utcnow)

    user = relationship("User")


class IngestMapping(Base):
    """Per-user mapping of an inbound JSON payload's keys to Transaction fields,
    used by the ingestion API so external sources (iOS Shortcut, webhooks) can post
    arbitrary JSON that is normalised into transactions.
    """
    __tablename__ = "ingest_mappings"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    name = Column(String(100), default="default")  # source label, e.g. "ios-shortcut"
    field_map = Column(Text)  # JSON: {"<incoming_key>": "<target_transaction_field>", ...}
    default_bank_id = Column(Integer, ForeignKey("banks.id", ondelete="SET NULL"))  # attribution target
    date_format = Column(String(50))  # optional strptime format for the incoming date
    default_type = Column(String(10), default="debit")  # fallback transaction_type
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=utcnow)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)

    user = relationship("User")


class AppSetting(Base):
    """Global key-value app settings shared across the web, worker and beat processes
    (e.g. the Discord webhook URL) so they survive restarts and are visible everywhere."""
    __tablename__ = "app_settings"

    key = Column(String(100), primary_key=True)
    value = Column(Text)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)


class SyncSchedule(Base):
    """Per-user automatic-sync schedule, read by the Celery beat dispatcher."""
    __tablename__ = "sync_schedules"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, unique=True, index=True)
    enabled = Column(Boolean, default=False)
    frequency = Column(String(20), default="daily")  # hourly, every4h, daily, weekly
    hour = Column(Integer, default=9)                # 0-23, for daily/weekly (UTC)
    day_of_week = Column(Integer, default=1)         # 1=Mon … 7=Sun, for weekly
    notify_on_completion = Column(Boolean, default=True)
    auto_generate_csv = Column(Boolean, default=False)
    csv_email_on_sync = Column(Boolean, default=False)
    last_run_at = Column(DateTime)                   # idempotency guard for the dispatcher
    created_at = Column(DateTime, default=utcnow)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)

    user = relationship("User")


class Budget(Base):
    """Per-user, per-category monthly spending budget."""
    __tablename__ = "budgets"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    category = Column(String(50), nullable=False)
    monthly_limit = Column(Float, nullable=False, default=0.0)
    alert_at_pct = Column(Integer, default=80)      # notify when this % of the limit is spent
    last_alerted_period = Column(String(7))         # 'YYYY-MM' already-alerted guard
    created_at = Column(DateTime, default=utcnow)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)

    user = relationship("User")
    __table_args__ = (Index("ix_budgets_user_category", "user_id", "category", unique=True),)


class SavingsGoal(Base):
    """Per-user savings goal with manual progress tracking."""
    __tablename__ = "savings_goals"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    name = Column(String(100), nullable=False)
    target_amount = Column(Float, nullable=False, default=0.0)
    current_amount = Column(Float, default=0.0)
    target_date = Column(DateTime)
    color = Column(String(7), default="#4e79a7")
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=utcnow)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)

    user = relationship("User")


class BalanceSnapshot(Base):
    """Daily snapshot of a user's aggregate balances, for net-worth-over-time charts."""
    __tablename__ = "balance_snapshots"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    snapshot_date = Column(String(10), nullable=False)  # 'YYYY-MM-DD'
    savings_total = Column(Float, default=0.0)
    credit_total = Column(Float, default=0.0)
    net_worth = Column(Float, default=0.0)
    created_at = Column(DateTime, default=utcnow)

    user = relationship("User")
    __table_args__ = (Index("ix_balance_snap_user_date", "user_id", "snapshot_date", unique=True),)


class Category(Base):
    """Per-user spending/income category with display metadata.

    Transaction.category remains a free-text string (the category *name*) for
    back-compat; this table supplies the icon/color/kind looked up by name so the
    UI can render Wallet-style category rows without a data migration.
    """
    __tablename__ = "categories"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    name = Column(String(50), nullable=False)
    icon = Column(String(50), default="Category")   # icon KEY resolved to a component on the frontend
    color = Column(String(7), default="#4e79a7")    # hex
    kind = Column(String(10), default="expense")    # expense, income, transfer
    parent_id = Column(Integer, ForeignKey("categories.id", ondelete="SET NULL"), nullable=True)
    is_system = Column(Boolean, default=False)      # seeded default (cannot be deleted, only edited)
    sort_order = Column(Integer, default=0)
    created_at = Column(DateTime, default=utcnow)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)

    user = relationship("User")
    __table_args__ = (Index("ix_categories_user_name", "user_id", "name", unique=True),)


class CategoryRule(Base):
    """Keyword -> category auto-categorization rule. When a transaction's
    description contains `keyword` (case-insensitive), it gets `category`.
    Higher priority wins; longer keywords are more specific."""
    __tablename__ = "category_rules"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    keyword = Column(String(100), nullable=False)
    category = Column(String(50), nullable=False)
    priority = Column(Integer, default=0)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=utcnow)

    user = relationship("User")


class NotificationRule(Base):
    """Richer alerting than AutoRule's simple Discord-on-match toggle: supports two
    trigger types (a NEW transaction matching keywords, OR a keyword's expected
    transaction being ABSENT this month) fanned out to any combination of Discord,
    email, and a Google Task."""
    __tablename__ = "notification_rules"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    name = Column(String(150), nullable=False)
    trigger_type = Column(String(20), default="match")  # 'match' | 'absence'
    keywords = Column(Text)          # JSON array of strings
    keyword_negate = Column(Boolean, default=False)  # True: fires when keywords DON'T match
    record_type = Column(String(10), default="any")  # any | debit | credit | transfer
    bank_id = Column(Integer, ForeignKey("banks.id", ondelete="SET NULL"), nullable=True)

    # Optional amount condition, combined with the keyword condition via condition_logic.
    # operator: none | eq | gte | lte | between
    amount_operator = Column(String(10), default="none")
    amount_value = Column(Float)
    amount_value_max = Column(Float)  # only used when amount_operator == 'between'
    amount_negate = Column(Boolean, default=False)  # True: fires when the amount condition DOESN'T match

    # How the keyword condition and amount condition combine when BOTH are configured.
    # 'and' — both must match; 'or' — either matching is enough. Irrelevant (ignored)
    # when only one of the two conditions is configured.
    condition_logic = Column(String(3), default="and")  # 'and' | 'or'

    # 'absence' trigger only: if no matching transaction has appeared THIS calendar
    # month by this day, fire once (idempotency via last_triggered_month below).
    check_day_of_month = Column(Integer, default=28)

    notify_discord = Column(Boolean, default=False)
    notify_email = Column(Boolean, default=False)
    email_to = Column(String(255))
    notify_task = Column(Boolean, default=False)  # create a Google Task

    is_active = Column(Boolean, default=True)
    last_triggered_at = Column(DateTime)
    last_triggered_month = Column(String(7))  # "YYYY-MM" — absence-trigger idempotency guard
    created_at = Column(DateTime, default=utcnow)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)

    user = relationship("User")
    bank = relationship("Bank")


class AutoRule(Base):
    """Wallet-style automatic rule: when a transaction's description contains any of
    the keywords (optionally filtered by record type), assign a category and labels."""
    __tablename__ = "auto_rules"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    name = Column(String(100), nullable=False)
    keywords = Column(Text)          # JSON array of strings
    record_type = Column(String(10), default="any")  # any | debit | credit | transfer
    category = Column(String(50))
    label_ids = Column(Text)         # JSON array of label ids
    priority = Column(Integer, default=0)
    is_active = Column(Boolean, default=True)
    notify_discord = Column(Boolean, default=False)  # send a Discord webhook message on match
    created_at = Column(DateTime, default=utcnow)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)

    user = relationship("User")


class Currency(Base):
    """Per-user currency with a conversion rate to the user's base currency.

    rate_to_base = how many units of the BASE currency equal 1 unit of this
    currency (e.g. base INR, USD.rate_to_base = 83 means 1 USD = 83 INR). The
    base currency has is_base=True and rate_to_base=1.0.
    """
    __tablename__ = "currencies"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    code = Column(String(3), nullable=False)        # ISO 4217, e.g. INR, USD
    symbol = Column(String(8), default="")          # ₹, $, €
    name = Column(String(50))                        # "Indian Rupee"
    rate_to_base = Column(Float, default=1.0)
    is_base = Column(Boolean, default=False)
    created_at = Column(DateTime, default=utcnow)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)

    user = relationship("User")
    __table_args__ = (Index("ix_currencies_user_code", "user_id", "code", unique=True),)


class Template(Base):
    """Reusable transaction template for quick manual entry."""
    __tablename__ = "templates"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    name = Column(String(100), nullable=False)
    bank_id = Column(Integer, ForeignKey("banks.id", ondelete="SET NULL"), nullable=True)
    category = Column(String(50))
    amount = Column(Float)
    transaction_type = Column(String(10), default="debit")  # debit/credit
    description = Column(Text)
    notes = Column(Text)
    currency_code = Column(String(3))
    label_ids = Column(Text)  # JSON array of label ids
    created_at = Column(DateTime, default=utcnow)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)

    user = relationship("User")


class SavedFilter(Base):
    """A named, reusable filter set for the Records/Analytics 'My filter' picker."""
    __tablename__ = "saved_filters"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    name = Column(String(100), nullable=False)
    scope = Column(String(20), default="records")  # records | analytics
    payload = Column(Text)  # JSON of the filter value
    created_at = Column(DateTime, default=utcnow)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)

    user = relationship("User")


class TransactionWatcher(Base):
    """A named recurring-transaction expectation (e.g. "Sreenivasa Gowda rent") that
    gets a fresh Google Task each month and auto-completes it the moment a
    transaction whose description matches shows up — pending or confirmed alike,
    since this is a lightweight bookkeeping reminder, not a budget/notification
    rule. See google_tasks_service.py and transaction_hooks.check_transaction_watchers."""
    __tablename__ = "transaction_watchers"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    name = Column(String(200), nullable=False)
    # JSON array of strings, same storage convention as NotificationRule.keywords —
    # matches (case-insensitive substring vs Transaction.description) if ANY one hits,
    # since a real recurring transfer's description often varies slightly run to run
    # (reference numbers, minor wording changes) and one fixed phrase isn't enough.
    match_keywords = Column(Text, nullable=False)
    # Optional — many recurring transfers (e.g. a generic "MonthlyTrans CHARGES FOR"
    # IMPS description with no payee name at all) are only reliably identified by
    # keyword + amount together; null means keyword alone is enough.
    match_amount = Column(Float)
    # daily | weekly | monthly | yearly — controls both the Google Task cadence and
    # the current_period label format ('YYYY-MM-DD' / 'YYYY-Www' / 'YYYY-MM' / 'YYYY').
    frequency = Column(String(10), default="monthly")
    is_active = Column(Boolean, default=True)
    # The currently-open Google Task for this watcher, if any — period label format
    # depends on frequency (see watcher_tasks.period_label).
    current_period = Column(String(10))
    current_task_id = Column(String(100))
    cleared_at = Column(DateTime)
    created_at = Column(DateTime, default=utcnow)

    user = relationship("User")


class RewardPointEntry(Base):
    """A single credit-card reward/loyalty points ledger entry.

    ``points`` is always the signed delta this entry contributes to the running
    balance: positive for 'earned' and most 'adjustment' rows, negative for
    'redeemed'/'expired'. Summing every entry for a bank gives its current
    balance -- no separate balance column to keep in sync.

    'earned' entries carry the only meaningful ``expiry_date``: the batch of
    points they represent expires then (if the issuer has one at all). A
    statement-derived 'adjustment' entry (source='auto'/'ai') reconciles the
    running total to the issuer's own printed points balance as of that
    statement, the same way apply_statement_balance() reconciles a card's
    outstanding-due balance -- but since statements essentially never print a
    per-batch expiry date, it never carries one.
    """
    __tablename__ = "reward_point_entries"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    bank_id = Column(Integer, ForeignKey("banks.id", ondelete="CASCADE"), nullable=False, index=True)
    pdf_statement_id = Column(Integer, ForeignKey("pdf_statements.id", ondelete="CASCADE"), nullable=True)
    entry_type = Column(String(20), nullable=False)  # earned | redeemed | expired | adjustment
    points = Column(Float, nullable=False)
    expiry_date = Column(DateTime, nullable=True)
    description = Column(String(255), nullable=True)
    source = Column(String(10), default="manual")  # manual | auto | ai
    # Highest expiry-warning threshold (30/7/1 days) already notified for this
    # entry, so the daily check never re-sends the same warning tomorrow.
    notified_threshold = Column(Integer, nullable=True)
    created_at = Column(DateTime, default=utcnow)

    user = relationship("User")
    bank = relationship("Bank")

    __table_args__ = (Index("ix_reward_points_user_bank", "user_id", "bank_id"),)
