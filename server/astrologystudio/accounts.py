"""
AstrologyStudio ·
server/astrologystudio/accounts.py

People who log in:

password hashing, sessions and login throttling.

Passwords are hashed with scrypt (Python's standard library), with a random salt
and parameters stored alongside so they can be raised later without breaking old
hashes. Session tokens are random; the database keeps only their SHA-256, so a
copy of the database can't be used to log in.

Copyright (c) 2026 Gavin Melhuish
MIT License; see LICENSE in the project root.
SPDX-License-Identifier: MIT
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import secrets
import sqlite3
import threading
import time
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

from .db import now
from .ids import new_id

SESSION_COOKIE = "as_session"
SESSION_LIFETIME = timedelta(days=30)
_SEEN_RESOLUTION = timedelta(minutes=5)

# scrypt cost: 2^16 * 8 * 128 bytes = 64 MiB per hash, comfortable on a small VPS.
_N, _R, _P = 2**16, 8, 1
MIN_PASSWORD_LENGTH = 10


def _b64(data: bytes) -> str:
    return base64.b64encode(data).decode()


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(
        password.encode(), salt=salt, n=_N, r=_R, p=_P, maxmem=128 * 1024 * 1024, dklen=32
    )
    return f"scrypt${_N}${_R}${_P}${_b64(salt)}${_b64(digest)}"


def check_password(password: str, stored: str) -> bool:
    try:
        scheme, n, r, p, salt, expected = stored.split("$")
        if scheme != "scrypt":
            return False
        digest = hashlib.scrypt(
            password.encode(),
            salt=base64.b64decode(salt),
            n=int(n),
            r=int(r),
            p=int(p),
            maxmem=256 * 1024 * 1024,
            dklen=32,
        )
    except (ValueError, TypeError):
        return False
    return hmac.compare_digest(digest, base64.b64decode(expected))


# A real hash to compare against when the email is unknown, so a login attempt
# takes the same time whether or not the account exists.
_DUMMY_HASH = hash_password(secrets.token_hex(8))


def password_problem(password: str, email: str = "") -> str | None:
    if len(password) < MIN_PASSWORD_LENGTH:
        return f"Use at least {MIN_PASSWORD_LENGTH} characters."
    if email and password.strip().lower() == email.strip().lower():
        return "Don't use your email address as your password."
    return None


# ---------------------------------------------------------------------------
# Users


def user_count(conn: sqlite3.Connection) -> int:
    count: int = conn.execute("SELECT COUNT(*) FROM users").fetchone()[0]
    return count


def create_user(
    conn: sqlite3.Connection, *, email: str, name: str, password: str, owner: bool = False
) -> str:
    user_id = new_id("user")
    conn.execute(
        "INSERT INTO users (id, email, name, password_hash, is_owner, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        (user_id, email, name, hash_password(password), int(owner), now()),
    )
    return user_id


def public_user(row: sqlite3.Row) -> dict[str, Any]:
    user = {k: row[k] for k in ("id", "email", "name", "created_at", "last_login_at")}
    user["is_owner"] = bool(row["is_owner"])
    user["signs_in_with"] = row["signs_in_with"]
    return user


# People who registered through ephemeralREST: no password here, so this can never match one.
NO_LOCAL_PASSWORD = "!ephemeralrest"
REGISTRATION_SETTING = "registration_open"


def create_ephemeral_user(conn: sqlite3.Connection, *, email: str, name: str) -> str:
    """Someone who signs in with their ephemeralREST account (email, password and emailed code)."""
    user_id = new_id("user")
    conn.execute(
        "INSERT INTO users (id, email, name, password_hash, is_owner, created_at, signs_in_with)"
        " VALUES (?, ?, ?, ?, 0, ?, 'ephemeral')",
        (user_id, email, name, NO_LOCAL_PASSWORD, now()),
    )
    return user_id


def registration_open(conn: sqlite3.Connection) -> bool:
    """Whether new people may create accounts (through ephemeralREST). Off unless the owner turns it on."""
    row = conn.execute("SELECT value FROM settings WHERE key = ?", (REGISTRATION_SETTING,)).fetchone()
    return bool(row is not None and json.loads(row["value"]) is True)


def authenticate_password(conn: sqlite3.Connection, email: str, password: str) -> sqlite3.Row | None:
    row: sqlite3.Row | None = conn.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
    if row is None:
        check_password(password, _DUMMY_HASH)
        return None
    return row if check_password(password, row["password_hash"]) else None


# ---------------------------------------------------------------------------
# Sessions


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _iso(moment: datetime) -> str:
    return moment.isoformat(timespec="milliseconds").replace("+00:00", "Z")


@dataclass(frozen=True, slots=True)
class Session:
    user_id: str
    name: str
    email: str
    csrf_token: str
    is_owner: bool


def start_session(conn: sqlite3.Connection, user_id: str) -> str:
    """Create a session and return the cookie value."""
    token = secrets.token_urlsafe(32)
    moment = datetime.now(UTC)
    conn.execute("DELETE FROM sessions WHERE expires_at < ?", (_iso(moment),))
    conn.execute(
        "INSERT INTO sessions (token_hash, user_id, csrf_token, created_at, expires_at, last_seen_at)"
        " VALUES (?, ?, ?, ?, ?, ?)",
        (
            _token_hash(token),
            user_id,
            secrets.token_urlsafe(24),
            _iso(moment),
            _iso(moment + SESSION_LIFETIME),
            _iso(moment),
        ),
    )
    conn.execute("UPDATE users SET last_login_at = ? WHERE id = ?", (_iso(moment), user_id))
    return token


def load_session(conn: sqlite3.Connection, token: str) -> Session | None:
    """The session for a cookie value, extending it while it's in use."""
    row = conn.execute(
        "SELECT s.token_hash, s.csrf_token, s.expires_at, s.last_seen_at, u.id, u.name, u.email, u.is_owner"
        " FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?",
        (_token_hash(token),),
    ).fetchone()
    moment = datetime.now(UTC)
    if row is None or datetime.fromisoformat(row["expires_at"]) < moment:
        return None
    if datetime.fromisoformat(row["last_seen_at"]) < moment - _SEEN_RESOLUTION:
        conn.execute(
            "UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE token_hash = ?",
            (_iso(moment), _iso(moment + SESSION_LIFETIME), row["token_hash"]),
        )
    return Session(
        user_id=row["id"],
        name=row["name"],
        email=row["email"],
        csrf_token=row["csrf_token"],
        is_owner=bool(row["is_owner"]),
    )


def end_session(conn: sqlite3.Connection, token: str) -> None:
    conn.execute("DELETE FROM sessions WHERE token_hash = ?", (_token_hash(token),))


def end_other_sessions(conn: sqlite3.Connection, user_id: str, keep_token: str | None) -> None:
    conn.execute(
        "DELETE FROM sessions WHERE user_id = ? AND token_hash != ?",
        (user_id, _token_hash(keep_token) if keep_token else ""),
    )


# ---------------------------------------------------------------------------
# Login throttling


class LoginThrottle:
    """At most `limit` failed logins per email address (and per client address)
    within `window`. In memory: one process serves the whole install."""

    def __init__(self, limit: int = 10, window: timedelta = timedelta(minutes=15)) -> None:
        self.limit = limit
        self.window = window.total_seconds()
        self._failures: dict[str, list[float]] = {}
        self._lock = threading.Lock()

    def _recent(self, key: str, moment: float) -> list[float]:
        recent = [t for t in self._failures.get(key, []) if moment - t < self.window]
        self._failures[key] = recent
        return recent

    def blocked(self, *keys: str) -> bool:
        moment = time.monotonic()
        with self._lock:
            return any(len(self._recent(k, moment)) >= self.limit for k in keys)

    def failed(self, *keys: str) -> None:
        moment = time.monotonic()
        with self._lock:
            for key in keys:
                self._recent(key, moment).append(moment)

    def succeeded(self, email_key: str) -> None:
        with self._lock:
            self._failures.pop(email_key, None)
