"""Column encryption for complainant contact data and keyed hashes used for matching."""

from __future__ import annotations

import hashlib
import hmac
import re
import unicodedata
from functools import lru_cache

from cryptography.fernet import Fernet, InvalidToken

from app.core.config import get_settings


@lru_cache
def _fernet() -> Fernet:
    key = get_settings().field_encryption_key.get_secret_value()
    if not key:
        raise RuntimeError("FIELD_ENCRYPTION_KEY is not set")
    return Fernet(key.encode())


def encrypt(value: str | None) -> str | None:
    if not value:
        return None
    return _fernet().encrypt(value.encode()).decode()


def decrypt(token: str | None) -> str | None:
    if not token:
        return None
    try:
        return _fernet().decrypt(token.encode()).decode()
    except InvalidToken:
        return "[unreadable: key mismatch]"


def _norm_phone(phone: str) -> str:
    digits = re.sub(r"\D", "", unicodedata.normalize("NFKC", phone))
    return digits[-10:] if len(digits) >= 10 else digits


def complainant_hmac(phone: str | None, email: str | None) -> str | None:
    """Keyed hash of the complainant's phone (or e-mail when there is no phone).

    Lets matching recognise the same complainant across channels without reading the contact itself. Phone is
    preferred because it is the field most consistently present across CPGRAMS, letters and e-mail.
    """
    if phone and _norm_phone(phone):
        material = "p:" + _norm_phone(phone)
    elif email and email.strip():
        material = "e:" + email.strip().lower()
    else:
        return None
    key = get_settings().hmac_key.get_secret_value().encode()
    if not key:
        raise RuntimeError("HMAC_KEY is not set")
    return hmac.new(key, material.encode(), hashlib.sha256).hexdigest()


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()
