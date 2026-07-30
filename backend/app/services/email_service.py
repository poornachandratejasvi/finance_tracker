"""Generic plain-text email sending via the app's configured SMTP server (Settings
→ env: SMTP_HOST/PORT/USER/PASSWORD/FROM). Used by notification rules; kept
separate from csv_service's attachment-carrying sender since most callers here
just need a plain message."""
import logging
import smtplib
from email.message import EmailMessage

from app.core.config import settings

logger = logging.getLogger(__name__)


def send_email(to_email: str, subject: str, body: str) -> None:
    if not settings.SMTP_HOST:
        raise ValueError("SMTP_HOST is not configured")
    sender = settings.SMTP_FROM or settings.SMTP_USER
    if not sender:
        raise ValueError("SMTP_FROM or SMTP_USER must be configured")
    if not to_email:
        raise ValueError("No recipient email address")

    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = sender
    msg["To"] = to_email
    msg.set_content(body)

    with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT) as server:
        if settings.SMTP_USE_TLS:
            server.starttls()
        if settings.SMTP_USER and settings.SMTP_PASSWORD:
            server.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
        server.send_message(msg)
