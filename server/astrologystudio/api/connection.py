"""
AstrologyStudio ·
server/astrologystudio/api/connection.py

/api/v1/connection:

where ephemeralREST is. Set once by the owner for everyone.

Copyright (c) 2026 Gavin Melhuish
MIT License; see LICENSE in the project root.
SPDX-License-Identifier: MIT
"""

from __future__ import annotations

import json
from typing import Annotated, Any

from fastapi import APIRouter, Request
from pydantic import Field

from ..config import Settings
from ..db import now, transaction
from ..deps import Db, OwnerPrincipal, UserPrincipal, transport
from ..ephemeral import SETTING_KEY, Ephemeral, configured_url
from ..errors import ProblemError
from ..schemas import Strict

router = APIRouter(prefix="/connection", tags=["Connection"])


class ConnectionUpdate(Strict):
    url: Annotated[str, Field(min_length=1, max_length=500)]


def _check(request: Request, url: str) -> dict[str, Any]:
    """Ask ephemeralREST's /ping, which needs no key."""
    try:
        with Ephemeral(url, None, transport(request)) as client:
            client.get("/ping")
    except ProblemError as problem:
        return {"reachable": False, "problem": problem.title}
    return {"reachable": True, "problem": None}


@router.get("", summary="The ephemeralREST address, and whether it answers")
def get_connection(request: Request, conn: Db, _: UserPrincipal) -> dict[str, Any]:
    settings: Settings = request.app.state.settings
    url = configured_url(conn, settings)
    result: dict[str, Any] = {"url": url or None}
    result.update(_check(request, url) if url else {"reachable": False, "problem": None})
    return result


@router.put("", summary="Set the ephemeralREST address")
def set_connection(body: ConnectionUpdate, request: Request, conn: Db, _: OwnerPrincipal) -> dict[str, Any]:
    url = body.url.strip().rstrip("/")
    if not url.startswith(("http://", "https://")):
        raise ProblemError(
            422,
            "bad-url",
            "Enter the full address",
            "Start with https://, for example https://api.example.com",
        )
    status = _check(request, url)
    if not status["reachable"]:
        raise ProblemError(
            422, "unreachable", "ephemeralREST didn't answer at that address", status["problem"]
        )
    with transaction(conn):
        conn.execute(
            "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)"
            " ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
            (SETTING_KEY, json.dumps(url), now()),
        )
    return {"url": url, **status}
