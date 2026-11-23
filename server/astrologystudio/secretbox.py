"""
AstrologyStudio ·
server/astrologystudio/secretbox.py

Encrypting stored secrets (each person's ephemeralREST key).

The install keeps one random key in `<data>/secret.key`, created on first use and
readable only by the app. A copy of the database alone can't reveal anyone's key.

Copyright (c) 2026 Gavin Melhuish
MIT License; see LICENSE in the project root.
SPDX-License-Identifier: MIT
"""

from __future__ import annotations

import os
from pathlib import Path

from cryptography.fernet import Fernet, InvalidToken

from .config import Settings


def _key(settings: Settings) -> bytes:
    path: Path = settings.secret_path
    if not path.exists():
        settings.data_dir.mkdir(parents=True, exist_ok=True)
        key = Fernet.generate_key()
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "wb") as handle:
            handle.write(key)
        return key
    return path.read_bytes().strip()


def encrypt(settings: Settings, value: str) -> str:
    return Fernet(_key(settings)).encrypt(value.encode()).decode()


def decrypt(settings: Settings, token: str) -> str | None:
    """None when the secret key has changed since this was stored."""
    try:
        return Fernet(_key(settings)).decrypt(token.encode()).decode()
    except InvalidToken:
        return None
