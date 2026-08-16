from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
import logging
import os
import secrets
from logging.handlers import RotatingFileHandler

from app.core.config import settings
from app.core.database import engine, Base, SessionLocal
from app.core.security import get_password_hash
from app.models.models import User, UserRole
from sqlalchemy import inspect, text
from app.api import router

def configure_logging() -> logging.Logger:
    """Configure stdout + file + in-memory logging for UI log viewer."""
    log_dir = "/app/logs"
    os.makedirs(log_dir, exist_ok=True)
    log_path = os.path.join(log_dir, "app.log")

    root_logger = logging.getLogger()
    level_name = (settings.LOG_LEVEL or "INFO").upper()
    level = getattr(logging, level_name, logging.INFO)
    root_logger.setLevel(level)

    formatter = logging.Formatter(
        '%(asctime)s - %(name)s - %(levelname)s - %(message)s',
        datefmt='%Y-%m-%dT%H:%M:%S'
    )

    # Stdout handler – visible in `docker compose logs`
    if not any(isinstance(h, logging.StreamHandler) and h.stream.name == '<stdout>'
               for h in root_logger.handlers):
        stdout_handler = logging.StreamHandler()
        stdout_handler.setLevel(level)
        stdout_handler.setFormatter(formatter)
        root_logger.addHandler(stdout_handler)

    # Rotating file handler – for UI log viewer
    if not any(isinstance(h, RotatingFileHandler) for h in root_logger.handlers):
        file_handler = RotatingFileHandler(log_path, maxBytes=5 * 1024 * 1024, backupCount=3)
        file_handler.setLevel(level)
        file_handler.setFormatter(formatter)
        root_logger.addHandler(file_handler)

    # Silence overly noisy third-party loggers
    for noisy in ("urllib3", "httpx", "httpcore", "googleapiclient.discovery"):
        logging.getLogger(noisy).setLevel(logging.WARNING)

    return logging.getLogger(__name__)


logger = configure_logging()


def _validate_google_config() -> None:
    """Log, at startup, whether each Google integration is actually usable — so a
    missing/malformed credentials.json or GOOGLE_CLIENT_ID shows up immediately in
    the logs (Settings → Application Logs) instead of surfacing later as a
    confusing failure the first time someone tries to link Gmail or connect Drive."""
    import json as _json

    creds_path = os.path.join(settings.BASE_DIR, 'credentials', 'credentials.json')
    if not os.path.exists(creds_path):
        logger.warning(
            "Google OAuth: credentials.json not found at %s — Gmail linking and the "
            "offline Drive backup flow are unavailable until it's added.", creds_path
        )
    else:
        try:
            with open(creds_path, 'r', encoding='utf-8') as f:
                data = _json.load(f)
            kind = next(iter(data.keys()), None)  # 'installed' or 'web'
            block = data.get(kind, {}) if kind else {}
            client_id = block.get('client_id', '')
            redirect_uris = block.get('redirect_uris', [])
            logger.info(
                "Google OAuth: credentials.json OK (type=%s, client_id=%s…, "
                "redirect_uris=%s) — powers Gmail linking + the offline Drive backup flow.",
                kind, client_id[:20] if client_id else '?', redirect_uris,
            )
            if kind == 'installed':
                logger.info(
                    "Google OAuth: client type is 'installed' (Desktop) — Google only "
                    "accepts loopback (localhost/127.0.0.1) redirect URIs for this type, "
                    "regardless of path. Fine for BACKEND_URL=%s; if this is ever deployed "
                    "behind a real domain, a separate 'Web application' OAuth client will "
                    "be needed instead.", settings.BACKEND_URL,
                )
        except Exception as e:
            logger.error("Google OAuth: credentials.json exists but failed to parse: %s", e)

    if settings.GOOGLE_CLIENT_ID:
        logger.info("Google Sign-In (GIS): GOOGLE_CLIENT_ID is set — browser Google login and the Client-ID-only Drive token flow are available.")
    else:
        logger.warning(
            "Google Sign-In (GIS): GOOGLE_CLIENT_ID is not set — the 'Sign in with Google' "
            "button and manual (browser-token) Drive backup connect are disabled until it's "
            "configured (Settings → env). This requires a separate 'Web application' OAuth "
            "client with an Authorized JavaScript origin — a Desktop-type client (like the "
            "one used for Gmail) cannot be reused for this."
        )


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan events"""
    # Startup
    logger.info("Starting Finance Tracker Application")
    logger.info("Creating database tables...")
    _bootstrap_schema()
    _validate_google_config()
    logger.info("Application started successfully")

    yield

    # Shutdown
    logger.info("Shutting down Finance Tracker Application")


def _ensure_columns() -> None:
    """Add new columns on existing tables when missing."""
    inspector = inspect(engine)
    existing_tables = inspector.get_table_names()

    if "banks" in existing_tables:
        columns = {col["name"] for col in inspector.get_columns("banks")}
        _add_column_if_missing(columns, "csv_email", "ALTER TABLE banks ADD COLUMN csv_email VARCHAR(255)")
        _add_column_if_missing(columns, "current_balance", "ALTER TABLE banks ADD COLUMN current_balance FLOAT")
        _add_column_if_missing(columns, "balance_updated_at", "ALTER TABLE banks ADD COLUMN balance_updated_at TIMESTAMP")
        _add_column_if_missing(columns, "pdf_filename_prefix", "ALTER TABLE banks ADD COLUMN pdf_filename_prefix VARCHAR(100)")
        _add_column_if_missing(columns, "currency_code", "ALTER TABLE banks ADD COLUMN currency_code VARCHAR(3) DEFAULT 'INR'")
        _add_column_if_missing(columns, "color", "ALTER TABLE banks ADD COLUMN color VARCHAR(7)")
        _add_column_if_missing(columns, "exclude_from_stats", "ALTER TABLE banks ADD COLUMN exclude_from_stats BOOLEAN DEFAULT FALSE")
        _add_column_if_missing(columns, "is_archived", "ALTER TABLE banks ADD COLUMN is_archived BOOLEAN DEFAULT FALSE")
        _add_column_if_missing(columns, "balance_source", "ALTER TABLE banks ADD COLUMN balance_source VARCHAR(10) DEFAULT 'auto'")
        _add_column_if_missing(columns, "reward_points_updated_at", "ALTER TABLE banks ADD COLUMN reward_points_updated_at TIMESTAMP")

    if "pdf_statements" in existing_tables:
        columns = {col["name"] for col in inspector.get_columns("pdf_statements")}
        _add_column_if_missing(columns, "decrypted_path", "ALTER TABLE pdf_statements ADD COLUMN decrypted_path VARCHAR(500)")
        _add_column_if_missing(columns, "decrypted_at", "ALTER TABLE pdf_statements ADD COLUMN decrypted_at TIMESTAMP")
        _add_column_if_missing(columns, "error_message", "ALTER TABLE pdf_statements ADD COLUMN error_message TEXT")

    if "bank_emails" in existing_tables:
        columns = {col["name"] for col in inspector.get_columns("bank_emails")}
        _add_column_if_missing(columns, "from_email", "ALTER TABLE bank_emails ADD COLUMN from_email VARCHAR(255)")
        _add_column_if_missing(columns, "email_type", "ALTER TABLE bank_emails ADD COLUMN email_type VARCHAR(20) DEFAULT 'statement'")

    if "sync_logs" in existing_tables:
        columns = {col["name"] for col in inspector.get_columns("sync_logs")}
        _add_column_if_missing(columns, "user_id", "ALTER TABLE sync_logs ADD COLUMN user_id INTEGER")
        # Live-progress columns for the sync status bar.
        _add_column_if_missing(columns, "total_emails", "ALTER TABLE sync_logs ADD COLUMN total_emails INTEGER DEFAULT 0")
        _add_column_if_missing(columns, "processed_emails", "ALTER TABLE sync_logs ADD COLUMN processed_emails INTEGER DEFAULT 0")
        _add_column_if_missing(columns, "current_step", "ALTER TABLE sync_logs ADD COLUMN current_step VARCHAR(150)")
        _add_column_if_missing(columns, "current_bank", "ALTER TABLE sync_logs ADD COLUMN current_bank VARCHAR(150)")

    if "transactions" in existing_tables:
        columns = {col["name"] for col in inspector.get_columns("transactions")}
        _add_column_if_missing(columns, "source", "ALTER TABLE transactions ADD COLUMN source VARCHAR(50)")
        _add_column_if_missing(columns, "currency_code", "ALTER TABLE transactions ADD COLUMN currency_code VARCHAR(3)")
        # DEFAULT TRUE backfills every existing (statement-derived) row as already
        # confirmed — only newly-created 'alert' rows are inserted with False.
        _add_column_if_missing(columns, "is_confirmed", "ALTER TABLE transactions ADD COLUMN is_confirmed BOOLEAN DEFAULT TRUE")
        _add_column_if_missing(columns, "confirmed_at", "ALTER TABLE transactions ADD COLUMN confirmed_at TIMESTAMP")

    if "users" in existing_tables:
        columns = {col["name"] for col in inspector.get_columns("users")}
        _add_column_if_missing(columns, "avatar_url", "ALTER TABLE users ADD COLUMN avatar_url VARCHAR(500)")
        _add_column_if_missing(columns, "household_id", "ALTER TABLE users ADD COLUMN household_id INTEGER REFERENCES households(id) ON DELETE SET NULL")
        if "household_id" not in columns and "households" in existing_tables:
            # Every existing user gets their own private household so nothing
            # changes for them until an admin explicitly groups two users together.
            with engine.begin() as connection:
                userless = connection.execute(text(
                    "SELECT id, username FROM users WHERE household_id IS NULL"
                )).fetchall()
                for uid, uname in userless:
                    result = connection.execute(text(
                        "INSERT INTO households (name, created_at) VALUES (:name, now()) RETURNING id"
                    ), {"name": f"{uname}'s Household"})
                    hid = result.scalar()
                    connection.execute(text(
                        "UPDATE users SET household_id = :hid WHERE id = :uid"
                    ), {"hid": hid, "uid": uid})
            if userless:
                logger.info("Created a private household for %d existing user(s)", len(userless))

    if "reward_point_entries" in existing_tables:
        columns = {col["name"] for col in inspector.get_columns("reward_point_entries")}
        _add_column_if_missing(columns, "entry_date", "ALTER TABLE reward_point_entries ADD COLUMN entry_date TIMESTAMP")
        if "entry_date" not in columns:
            # Existing entries predate this column -- backfill from created_at so
            # they still show up in the right month rather than vanishing from
            # the monthly view.
            with engine.begin() as connection:
                connection.execute(text(
                    "UPDATE reward_point_entries SET entry_date = created_at WHERE entry_date IS NULL"
                ))

    if "templates" in existing_tables:
        columns = {col["name"] for col in inspector.get_columns("templates")}
        _add_column_if_missing(columns, "label_ids", "ALTER TABLE templates ADD COLUMN label_ids TEXT")

    if "auto_rules" in existing_tables:
        columns = {col["name"] for col in inspector.get_columns("auto_rules")}
        _add_column_if_missing(columns, "notify_discord", "ALTER TABLE auto_rules ADD COLUMN notify_discord BOOLEAN DEFAULT FALSE")

    if "gmail_accounts" in existing_tables:
        columns = {col["name"] for col in inspector.get_columns("gmail_accounts")}
        _add_column_if_missing(columns, "last_checked_at", "ALTER TABLE gmail_accounts ADD COLUMN last_checked_at TIMESTAMP")
        _add_column_if_missing(columns, "last_error", "ALTER TABLE gmail_accounts ADD COLUMN last_error TEXT")
        _add_column_if_missing(columns, "reauth_notified_at", "ALTER TABLE gmail_accounts ADD COLUMN reauth_notified_at TIMESTAMP")

    if "notification_rules" in existing_tables:
        columns = {col["name"] for col in inspector.get_columns("notification_rules")}
        _add_column_if_missing(columns, "keyword_negate", "ALTER TABLE notification_rules ADD COLUMN keyword_negate BOOLEAN DEFAULT FALSE")
        _add_column_if_missing(columns, "amount_operator", "ALTER TABLE notification_rules ADD COLUMN amount_operator VARCHAR(10) DEFAULT 'none'")
        _add_column_if_missing(columns, "amount_value", "ALTER TABLE notification_rules ADD COLUMN amount_value FLOAT")
        _add_column_if_missing(columns, "amount_value_max", "ALTER TABLE notification_rules ADD COLUMN amount_value_max FLOAT")
        _add_column_if_missing(columns, "amount_negate", "ALTER TABLE notification_rules ADD COLUMN amount_negate BOOLEAN DEFAULT FALSE")
        _add_column_if_missing(columns, "condition_logic", "ALTER TABLE notification_rules ADD COLUMN condition_logic VARCHAR(3) DEFAULT 'and'")

    if "transaction_watchers" in existing_tables:
        columns = {col["name"] for col in inspector.get_columns("transaction_watchers")}
        _add_column_if_missing(columns, "match_amount", "ALTER TABLE transaction_watchers ADD COLUMN match_amount FLOAT")
        # match_keyword (single string) -> match_keywords (JSON array) — a watcher's
        # description often needs more than one alternate phrasing to reliably match.
        # The old column is left in place (unused) rather than dropped, same as every
        # other migration here; existing single values are backfilled as one-item lists.
        needs_keywords_backfill = "match_keywords" not in columns and "match_keyword" in columns
        _add_column_if_missing(columns, "match_keywords", "ALTER TABLE transaction_watchers ADD COLUMN match_keywords TEXT")
        if needs_keywords_backfill:
            import json as _json
            with engine.begin() as connection:
                rows = connection.execute(text(
                    "SELECT id, match_keyword FROM transaction_watchers WHERE match_keyword IS NOT NULL"
                )).fetchall()
                for wid, kw in rows:
                    connection.execute(
                        text("UPDATE transaction_watchers SET match_keywords = :kws WHERE id = :id"),
                        {"kws": _json.dumps([kw]), "id": wid},
                    )
            if rows:
                logger.info("Backfilled match_keywords for %d transaction watcher(s)", len(rows))
        if "match_keyword" in columns:
            # The ORM model no longer sets this (superseded by match_keywords), but
            # the live column is still NOT NULL from its original creation — relax
            # it so new INSERTs (which never populate it) don't get rejected.
            try:
                with engine.begin() as connection:
                    connection.execute(text(
                        "ALTER TABLE transaction_watchers ALTER COLUMN match_keyword DROP NOT NULL"
                    ))
            except Exception:
                logger.warning("Failed to relax transaction_watchers.match_keyword NOT NULL", exc_info=True)
        _add_column_if_missing(columns, "frequency", "ALTER TABLE transaction_watchers ADD COLUMN frequency VARCHAR(10) DEFAULT 'monthly'")
        # current_period widened from 'YYYY-MM' (7 chars) to fit 'YYYY-Www' (8 chars)
        # now that weekly/daily/yearly frequencies are supported.
        try:
            with engine.begin() as connection:
                connection.execute(text(
                    "ALTER TABLE transaction_watchers ALTER COLUMN current_period TYPE VARCHAR(10)"
                ))
        except Exception:
            logger.warning("Failed to widen transaction_watchers.current_period", exc_info=True)

    # Widen columns that now hold encrypted values (ciphertext is longer than plaintext).
    _widen_to_text(inspector, existing_tables, "users", "avatar_url")  # holds base64 data URLs
    _widen_to_text(inspector, existing_tables, "banks", "account_password")
    _widen_to_text(inspector, existing_tables, "pdf_statements", "password_hash")
    _widen_to_text(inspector, existing_tables, "bank_configs", "password_hints")

    # Indexes on hot query columns (idempotent; create_all does not add indexes to
    # pre-existing tables). Postgres supports CREATE INDEX IF NOT EXISTS.
    _ensure_index("ix_transactions_user_date", "transactions", "(user_id, transaction_date)")
    _ensure_index("ix_transactions_user_bank", "transactions", "(user_id, bank_id)")
    _ensure_index("ix_transactions_transaction_date", "transactions", "(transaction_date)")

    # transaction_labels.transaction_id was declared with ondelete="CASCADE" in the
    # model from the start, but the live table predates that (create_all only
    # creates NEW tables — it never alters an existing FK) and was actually built
    # with NO ACTION. That silently broke "reprocess this PDF" (delete-then-recreate
    # its transactions) for any transaction that had a manually-applied label —
    # Postgres rejected the delete with a FK violation instead of cascading.
    _ensure_cascade_delete("transaction_labels_transaction_id_fkey", "transaction_labels",
                           "transaction_id", "transactions", "id")


def _ensure_cascade_delete(constraint_name: str, table: str, column: str, ref_table: str, ref_column: str) -> None:
    """Make sure a foreign key has ON DELETE CASCADE, replacing it if it doesn't."""
    try:
        with engine.begin() as connection:
            row = connection.execute(text(
                "SELECT confdeltype FROM pg_constraint WHERE conname = :name"
            ), {"name": constraint_name}).first()
            if row is None or row[0] == 'c':
                return  # missing (nothing to fix) or already CASCADE
            connection.execute(text(f"ALTER TABLE {table} DROP CONSTRAINT {constraint_name}"))
            connection.execute(text(
                f"ALTER TABLE {table} ADD CONSTRAINT {constraint_name} "
                f"FOREIGN KEY ({column}) REFERENCES {ref_table}({ref_column}) ON DELETE CASCADE"
            ))
        logger.info("Fixed %s to ON DELETE CASCADE", constraint_name)
    except Exception:
        logger.warning("Failed to fix cascade delete for %s", constraint_name, exc_info=True)


def _ensure_index(name: str, table: str, columns_sql: str) -> None:
    """Create an index if it does not already exist (Postgres-safe, idempotent)."""
    try:
        with engine.begin() as connection:
            connection.execute(text(f"CREATE INDEX IF NOT EXISTS {name} ON {table} {columns_sql}"))
    except Exception:
        logger.warning("Failed to ensure index %s on %s", name, table, exc_info=True)


def _add_column_if_missing(existing_columns: set, column_name: str, ddl: str) -> None:
    if column_name in existing_columns:
        return
    try:
        with engine.begin() as connection:
            connection.execute(text(ddl))
        logger.info("Added missing column %s", column_name)
    except Exception:
        # Log the full traceback so migration failures are diagnosable, not silent.
        logger.warning("Failed to add column %s", column_name, exc_info=True)


def _widen_to_text(inspector, existing_tables, table: str, column: str) -> None:
    """Convert a VARCHAR column to TEXT so encrypted values are never truncated."""
    if table not in existing_tables:
        return
    try:
        col = next((c for c in inspector.get_columns(table) if c["name"] == column), None)
        if col is None or "TEXT" in str(col["type"]).upper():
            return
        with engine.begin() as connection:
            connection.execute(text(f"ALTER TABLE {table} ALTER COLUMN {column} TYPE TEXT"))
        logger.info("Widened %s.%s to TEXT", table, column)
    except Exception:
        logger.warning("Failed to widen %s.%s to TEXT", table, column, exc_info=True)


_SCHEMA_LOCK_KEY = 741_852_963  # arbitrary constant advisory-lock id for schema bootstrap


def _bootstrap_schema() -> None:
    """Run all schema setup under a Postgres advisory lock.

    With uvicorn --workers 2, every worker process runs this on startup. Without
    serialization they race on CREATE TABLE/INDEX and one worker dies with a catalog
    unique-violation. The advisory lock makes exactly one worker do the (idempotent)
    work while the others wait, then no-op. Any residual error is logged, not fatal.
    """
    lock_conn = engine.connect()
    try:
        lock_conn.exec_driver_sql("SELECT pg_advisory_lock(%s)", (_SCHEMA_LOCK_KEY,))
        try:
            Base.metadata.create_all(bind=engine)
            _ensure_columns()
            _ensure_admin_user()
            _claim_orphaned_banks()
            _seed_user_defaults()
            _reap_stale_syncs()
        finally:
            lock_conn.exec_driver_sql("SELECT pg_advisory_unlock(%s)", (_SCHEMA_LOCK_KEY,))
    except Exception:
        # Never let schema bootstrap crash the worker; it is idempotent and any partial
        # state is completed on the next start.
        logger.warning("Schema bootstrap encountered an error (continuing)", exc_info=True)
    finally:
        lock_conn.close()


def _reap_stale_syncs() -> None:
    """Reconcile syncs left stuck in queued/processing by a prior crash/restart, so the
    UI never shows a phantom 'sync in progress'."""
    db = SessionLocal()
    try:
        from app.api.endpoints.sync import reap_stale_syncs
        n = reap_stale_syncs(db)
        if n:
            logger.info("Reaped %d stale sync job(s) on startup", n)
    except Exception:
        db.rollback()
        logger.warning("Failed to reap stale syncs", exc_info=True)
    finally:
        db.close()


def _claim_orphaned_banks() -> None:
    """Assign any banks with a NULL owner to the admin user.

    Such rows predate user-scoping. They used to be shown to every user (a cross-user
    metadata leak); now that queries filter strictly by owner, we attribute them to the
    admin so the data stays accessible instead of becoming invisible to everyone.
    """
    from app.models.models import Bank
    db = SessionLocal()
    try:
        admin = db.query(User).filter(User.role == UserRole.ADMIN).order_by(User.id).first()
        if not admin:
            return
        orphaned = db.query(Bank).filter(Bank.user_id.is_(None)).all()
        if not orphaned:
            return
        for bank in orphaned:
            bank.user_id = admin.id
        db.commit()
        logger.info("Claimed %d orphaned bank(s) for admin user '%s'", len(orphaned), admin.username)
    except Exception:
        db.rollback()
        logger.warning("Failed to claim orphaned banks", exc_info=True)
    finally:
        db.close()


def _seed_user_defaults() -> None:
    """Seed default categories + currencies (and backfill account currency) for
    every existing user that lacks them. Idempotent."""
    from app.services.seed_service import seed_user_defaults
    db = SessionLocal()
    try:
        for (uid,) in db.query(User.id).all():
            seed_user_defaults(db, uid)
    except Exception:
        db.rollback()
        logger.warning("Failed to seed user defaults", exc_info=True)
    finally:
        db.close()


def _ensure_admin_user() -> None:
    """Ensure an admin account exists.

    The admin password is NOT reset on every startup (that would silently overwrite a
    rotated password). It is only (re)set when ADMIN_RESET_PASSWORD=true AND a non-empty
    ADMIN_PASSWORD is provided. On first creation with no password configured, a secure
    random one is generated and logged once.
    """
    if not settings.ADMIN_EMAIL or not settings.ADMIN_USERNAME:
        return

    db = SessionLocal()
    try:
        existing = db.query(User).filter(
            (User.username == settings.ADMIN_USERNAME) | (User.email == settings.ADMIN_EMAIL)
        ).first()
        if existing:
            existing.username = settings.ADMIN_USERNAME
            existing.email = settings.ADMIN_EMAIL
            existing.role = UserRole.ADMIN
            existing.is_active = True
            if settings.ADMIN_RESET_PASSWORD and settings.ADMIN_PASSWORD:
                existing.hashed_password = get_password_hash(settings.ADMIN_PASSWORD)
                logger.warning("Admin password reset from ADMIN_PASSWORD (ADMIN_RESET_PASSWORD=true).")
            db.commit()
            return

        password = settings.ADMIN_PASSWORD
        generated = not password
        if generated:
            password = secrets.token_urlsafe(16)

        admin = User(
            username=settings.ADMIN_USERNAME,
            email=settings.ADMIN_EMAIL,
            hashed_password=get_password_hash(password),
            role=UserRole.ADMIN,
            is_active=True
        )
        db.add(admin)
        db.commit()

        if generated:
            logger.warning(
                "Created admin user '%s' with a GENERATED password: %s  — store it now and "
                "change it after first login (it will not be shown again).",
                settings.ADMIN_USERNAME, password
            )
        else:
            logger.info("Created admin user '%s' from ADMIN_PASSWORD.", settings.ADMIN_USERNAME)
    finally:
        db.close()


# Create FastAPI application
app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    description="Multi-Bank Finance Tracking System",
    lifespan=lifespan
)

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)

# Include routers
app.include_router(router, prefix="/api")


@app.get("/")
async def root():
    """Root endpoint"""
    return {
        "message": "Finance Tracker API",
        "version": settings.APP_VERSION,
        "status": "running"
    }


@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {"status": "healthy"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
