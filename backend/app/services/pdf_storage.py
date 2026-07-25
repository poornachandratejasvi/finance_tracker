import os
import logging
from datetime import datetime
from typing import List, Optional, Tuple

from app.core.config import settings
from app.core.time_utils import utcnow
from app.services.pdf_parser import PDFParser

logger = logging.getLogger(__name__)


def get_preferred_pdf_path(pdf_statement) -> str:
    """Return decrypted path if available, otherwise original file path."""
    if pdf_statement.decrypted_path and os.path.exists(pdf_statement.decrypted_path):
        return pdf_statement.decrypted_path
    return pdf_statement.file_path


def _build_decrypted_path(pdf_statement) -> str:
    base_name = os.path.splitext(os.path.basename(pdf_statement.file_name))[0]
    safe_name = "".join(c if c.isalnum() or c in "-_" else "_" for c in base_name).strip("_")
    filename = f"{pdf_statement.id}_{safe_name}_decrypted.pdf"
    decrypted_dir = os.path.join(settings.UPLOAD_DIR, "decrypted")
    os.makedirs(decrypted_dir, exist_ok=True)
    return os.path.join(decrypted_dir, filename)


def _delete_encrypted_original(pdf_statement) -> None:
    """Delete the encrypted original PDF file after successful decryption."""
    original = pdf_statement.file_path
    if original and os.path.exists(original):
        # Only delete if it's not the same file as decrypted_path
        if original != pdf_statement.decrypted_path:
            try:
                os.remove(original)
                logger.info("Deleted encrypted original: %s", original)
            except OSError as e:
                logger.warning("Could not delete encrypted original %s: %s", original, e)


def ensure_decrypted_pdf(
    db,
    pdf_statement,
    password: Optional[str]
) -> Optional[str]:
    """Ensure a decrypted copy exists for a password-protected PDF.
    After successful decryption the encrypted original is removed."""
    if not pdf_statement.is_password_protected:
        return pdf_statement.file_path

    if pdf_statement.decrypted_path and os.path.exists(pdf_statement.decrypted_path):
        return pdf_statement.decrypted_path

    if not password:
        return None

    decrypted_path = _build_decrypted_path(pdf_statement)
    if PDFParser.unlock_pdf(pdf_statement.file_path, password, decrypted_path):
        pdf_statement.decrypted_path = decrypted_path
        pdf_statement.decrypted_at = utcnow()
        db.commit()
        _delete_encrypted_original(pdf_statement)
        return decrypted_path

    return None


def ensure_decrypted_with_candidates(
    db,
    pdf_statement,
    passwords: List[str]
) -> Tuple[Optional[str], Optional[str]]:
    """Try multiple passwords and persist the decrypted PDF on success.
    Removes the encrypted original after successful decryption."""
    if not pdf_statement.is_password_protected:
        return pdf_statement.file_path, None

    if pdf_statement.decrypted_path and os.path.exists(pdf_statement.decrypted_path):
        return pdf_statement.decrypted_path, None

    for pwd in passwords:
        if not pwd:
            continue
        decrypted_path = _build_decrypted_path(pdf_statement)
        if PDFParser.unlock_pdf(pdf_statement.file_path, pwd, decrypted_path):
            pdf_statement.decrypted_path = decrypted_path
            pdf_statement.decrypted_at = utcnow()
            db.commit()
            _delete_encrypted_original(pdf_statement)
            return decrypted_path, pwd

    return None, None
