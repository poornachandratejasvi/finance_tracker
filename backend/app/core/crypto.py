"""Symmetric encryption helpers for sensitive data stored at rest.

Uses Fernet (AES-128-CBC + HMAC) with a key derived from ``settings.ENCRYPTION_KEY``
(falling back to ``SECRET_KEY``). Encrypted values are prefixed with a marker so that
legacy plaintext rows remain readable and are transparently upgraded to ciphertext on
their next write.
"""
import base64
import hashlib
import logging
from functools import lru_cache

from cryptography.fernet import Fernet, InvalidToken
from sqlalchemy.types import TypeDecorator, Text

from app.core.config import settings

logger = logging.getLogger(__name__)

# Bump the version suffix if the key-derivation scheme ever changes.
_MARKER = "enc::v1::"


@lru_cache(maxsize=1)
def _get_fernet() -> Fernet:
    """Build a Fernet instance from the configured key material (cached)."""
    key_material = (getattr(settings, "ENCRYPTION_KEY", "") or settings.SECRET_KEY or "").encode()
    if not key_material:
        raise RuntimeError("ENCRYPTION_KEY or SECRET_KEY must be set to encrypt data at rest")
    digest = hashlib.sha256(key_material).digest()
    fernet_key = base64.urlsafe_b64encode(digest)
    return Fernet(fernet_key)


def encrypt_value(plaintext):
    """Encrypt a string. Returns None for None; idempotent for already-encrypted input."""
    if plaintext is None:
        return None
    if not isinstance(plaintext, str):
        plaintext = str(plaintext)
    if plaintext.startswith(_MARKER):
        return plaintext  # already encrypted
    token = _get_fernet().encrypt(plaintext.encode("utf-8")).decode("ascii")
    return _MARKER + token


def decrypt_value(value):
    """Decrypt a value produced by :func:`encrypt_value`.

    Legacy plaintext values (no marker) are returned unchanged, so existing rows keep
    working during the transition to encryption at rest.
    """
    if value is None:
        return None
    if not isinstance(value, str) or not value.startswith(_MARKER):
        return value  # legacy plaintext or non-string
    token = value[len(_MARKER):]
    try:
        return _get_fernet().decrypt(token.encode("ascii")).decode("utf-8")
    except (InvalidToken, ValueError) as exc:
        # NEVER return the raw ciphertext — doing so silently leaks the encrypted blob
        # downstream (e.g. it would be used verbatim as a PDF password, or fed to
        # json.loads). Return None so the value reads as "absent", which fails loudly
        # and safely at the point of use instead of corrupting behaviour silently.
        logger.error(
            "Failed to decrypt stored value (wrong/rotated key or corrupted data): %s", exc
        )
        return None


class EncryptedText(TypeDecorator):
    """SQLAlchemy column type that transparently encrypts on write / decrypts on read.

    Application code reads and writes plaintext; only the database sees ciphertext.
    """

    impl = Text
    cache_ok = True

    def process_bind_param(self, value, dialect):
        return encrypt_value(value)

    def process_result_value(self, value, dialect):
        return decrypt_value(value)
