from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import field_validator
from typing import List, Union
import os
import multiprocessing


class Settings(BaseSettings):
    """Application settings"""
    
    model_config = SettingsConfigDict(
        env_file=".env",
        case_sensitive=True,
        extra="ignore"
    )
    
    # Application
    APP_NAME: str = "Finance Tracker"
    APP_VERSION: str = "1.1.0"
    DEBUG: bool = False
    LOG_LEVEL: str = "INFO"
    BASE_DIR: str = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    BACKEND_URL: str = "http://localhost:8000"
    FRONTEND_URL: str = "http://localhost:3000"
    
    # Database
    DATABASE_URL: str
    
    # Redis
    REDIS_URL: str = "redis://redis:6379/0"
    
    # Security
    SECRET_KEY: str
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7
    # Key used to encrypt sensitive data at rest (OAuth tokens, bank passwords).
    # Falls back to SECRET_KEY when left blank. Set explicitly to rotate independently.
    ENCRYPTION_KEY: str = ""

    # Login rate limiting (brute-force protection)
    LOGIN_RATE_LIMIT_MAX: int = 10            # attempts allowed per window
    LOGIN_RATE_LIMIT_WINDOW_SECONDS: int = 300  # window length in seconds
    
    # CORS - can be a string or list
    ALLOWED_ORIGINS: Union[str, List[str]] = "http://localhost:3000,http://localhost:8000"
    
    @field_validator('ALLOWED_ORIGINS', mode='before')
    @classmethod
    def parse_cors(cls, v):
        if isinstance(v, str):
            return [origin.strip() for origin in v.split(',')]
        return v
    
    # Gmail
    GMAIL_CREDENTIALS_PATH: str = "/app/credentials/credentials.json"
    GMAIL_TOKEN_PATH: str = "/app/credentials/token.json"

    # Google Identity Services (GIS) — web "Sign in with Google" (Client ID only,
    # no secret / credentials.json). Also used to verify Drive access tokens.
    GOOGLE_CLIENT_ID: str = ""
    
    # File Upload
    MAX_UPLOAD_SIZE: int = 10485760  # 10MB
    UPLOAD_DIR: str = "/app/uploads"

    # CSV Export
    CSV_SUBDIR: str = "csv"

    # SMTP Email
    SMTP_HOST: str = ""
    SMTP_PORT: int = 587
    SMTP_USER: str = ""
    SMTP_PASSWORD: str = ""
    SMTP_FROM: str = ""
    SMTP_USE_TLS: bool = True

    # Concurrency — 0 means auto-detect (use all CPU cores)
    MAX_WORKERS: int = 0

    @field_validator('MAX_WORKERS', mode='after')
    @classmethod
    def resolve_max_workers(cls, v: int) -> int:
        if v <= 0:
            return multiprocessing.cpu_count()
        return v
    
    # Pagination
    DEFAULT_PAGE_SIZE: int = 50
    MAX_PAGE_SIZE: int = 100
    
    # Admin Account
    # ADMIN_PASSWORD has NO default: it must be provided via the environment.
    # If left blank, a secure random password is generated on first admin creation
    # and printed once to the logs. The admin password is NOT reset on restart unless
    # ADMIN_RESET_PASSWORD=true is set alongside a non-empty ADMIN_PASSWORD.
    ADMIN_EMAIL: str = "admin@financetracker.com"
    ADMIN_PASSWORD: str = ""
    ADMIN_USERNAME: str = "admin"
    ADMIN_RESET_PASSWORD: bool = False


settings = Settings()
