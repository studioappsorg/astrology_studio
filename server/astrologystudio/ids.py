"""
AstrologyStudio ·
server/astrologystudio/ids.py

Prefixed, time-sortable identifiers such as `usr_01JD0Q5V8Z3K2M4N6P7R8S9T0V`.

The body is a ULID (48-bit millisecond timestamp + 80 random bits, Crockford
base32). IDs sort by creation time, which makes them usable as pagination cursors.

Copyright (c) 2026 Gavin Melhuish
MIT License; see LICENSE in the project root.
SPDX-License-Identifier: MIT
"""

from __future__ import annotations

import secrets
import time
from typing import Final

_ALPHABET: Final = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"

PREFIXES: Final = {
    "user": "usr",
    "folder": "fld",
    "profile": "prf",
    "theme": "thm",
    "site-theme": "sth",
    "layout": "lay",
    "preset": "pst",
}


def _ulid() -> str:
    value = (int(time.time() * 1000) << 80) | secrets.randbits(80)
    chars = []
    for _ in range(26):
        chars.append(_ALPHABET[value & 0x1F])
        value >>= 5
    return "".join(reversed(chars))


def new_id(kind: str) -> str:
    return f"{PREFIXES[kind]}_{_ulid()}"


def has_prefix(value: str, kind: str) -> bool:
    prefix = PREFIXES[kind] + "_"
    return value.startswith(prefix) and len(value) == len(prefix) + 26
