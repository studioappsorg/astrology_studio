"""
AstrologyStudio ·
server/astrologystudio/deps.py

Request-level plumbing shared by every endpoint: the database connection,
the logged-in person, and their ephemeralREST client.

Copyright (c) 2026 Gavin Melhuish
MIT License; see LICENSE in the project root.
SPDX-License-Identifier: MIT
"""

from __future__ import annotations

import hmac
import sqlite3
from collections.abc import Iterator
from dataclasses import dataclass
from typing import Annotated

import httpx
from fastapi import Cookie, Depends, Header, Request

from . import secretbox
from .accounts import SESSION_COOKIE, load_session
from .config import Settings
from .db import connect
from .ephemeral import Ephemeral, configured_url
from .errors import ProblemError


def get_db(request: Request) -> Iterator[sqlite3.Connection]:
    settings: Settings = request.app.state.settings
    conn = connect(settings.database_path)
    try:
        yield conn
    finally:
        conn.close()


Db = Annotated[sqlite3.Connection, Depends(get_db)]

_SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})


@dataclass(frozen=True, slots=True)
class Person:
    """Who is making a request: someone logged in to the web app."""

    id: str
    name: str
    email: str
    is_owner: bool
    csrf_token: str


def require_user(
    request: Request,
    conn: Db,
    as_session: Annotated[str | None, Cookie(alias=SESSION_COOKIE)] = None,
    x_csrf_token: Annotated[str | None, Header()] = None,
) -> Person:
    """The logged-in person. Changes must also carry the session's CSRF token,
    so other websites can't act on someone's behalf."""
    session = load_session(conn, as_session) if as_session else None
    if session is None:
        raise ProblemError(401, "unauthorized", "Please log in", None)
    if request.method not in _SAFE_METHODS and not (
        x_csrf_token and hmac.compare_digest(x_csrf_token, session.csrf_token)
    ):
        raise ProblemError(403, "csrf", "Missing security token", "Reload the page and try again.")
    return Person(session.user_id, session.name, session.email, session.is_owner, session.csrf_token)


UserPrincipal = Annotated[Person, Depends(require_user)]


def require_owner(person: UserPrincipal) -> Person:
    if not person.is_owner:
        raise ProblemError(403, "owner-only", "Only the owner can do this", None)
    return person


OwnerPrincipal = Annotated[Person, Depends(require_owner)]


def transport(request: Request) -> httpx.BaseTransport | None:
    """Tests put a stand-in ephemeralREST here; normally None (the real network)."""
    value: httpx.BaseTransport | None = getattr(request.app.state, "ephemeral_transport", None)
    return value


def stored_key(conn: sqlite3.Connection, settings: Settings, user_id: str) -> str | None:
    row = conn.execute("SELECT encrypted FROM ephemeral_keys WHERE user_id = ?", (user_id,)).fetchone()
    return secretbox.decrypt(settings, row["encrypted"]) if row else None


def get_ephemeral(request: Request, conn: Db, person: UserPrincipal) -> Iterator[Ephemeral]:
    """An ephemeralREST client using the logged-in person's own key."""
    settings: Settings = request.app.state.settings
    key = stored_key(conn, settings, person.id)
    if not key:
        raise ProblemError(
            409,
            "no-api-key",
            "Add your ephemeralREST API key",
            "Enter your key in Account. Each person uses their own key.",
        )
    client = Ephemeral(
        configured_url(conn, settings), key, transport(request), request.app.state.ephemeral_cache
    )
    try:
        yield client
    finally:
        client.close()


Eph = Annotated[Ephemeral, Depends(get_ephemeral)]
