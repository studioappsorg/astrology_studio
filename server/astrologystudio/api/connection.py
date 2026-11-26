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

from fastapi import APIRouter, Request, Response
from pydantic import Field

from .. import signup
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
    signup.forget_features(request)
    return {"url": url, **status}


# ---------------------------------------------------------------------------
# The site key: a domain key for this site, so sign-up emails link back here


class SiteKeyUpdate(Strict):
    api_key: Annotated[str, Field(min_length=8, max_length=200)]


def _site_public(request: Request, conn: Db) -> dict[str, Any]:
    found = signup.stored_site(conn)
    here, why = signup.links_state(request, conn)
    return {
        "configured": found is not None,
        "prefix": found.get("prefix") if found else None,
        "domain": found.get("domain") if found else None,
        "origin": signup.site_origin(request.app.state.settings),
        "links_here": here,
        "reason": why or None,
    }


@router.get("/site-key", summary="The site key (never the key itself), and where sign-up emails link")
def get_site_key(request: Request, conn: Db, _: OwnerPrincipal) -> dict[str, Any]:
    return _site_public(request, conn)


@router.put("/site-key", summary="Save the site key")
def set_site_key(body: SiteKeyUpdate, request: Request, conn: Db, _: OwnerPrincipal) -> dict[str, Any]:
    """A domain key for this site's address, from whoever runs this ephemeralREST. It's checked
    against this site's address, and the address is added to the key's link origins, so sign-up
    and password emails link back here. Each person's charts still use their own key."""
    settings: Settings = request.app.state.settings
    url = configured_url(conn, settings)
    if not url:
        raise ProblemError(409, "no-ephemeral-url", "Save the ephemeralREST address first", None)
    key = body.api_key.strip()
    origin = signup.site_origin(settings)
    try:
        with Ephemeral(url, key, transport(request)) as client:
            found = client.get("/keys/self/link-origins")
            domain = str(found.get("domain") or "")
            if not signup.host_matches(origin, domain):
                raise ProblemError(
                    422,
                    "site-key-domain",
                    "That key is for another address",
                    f"This key is for {domain}; this site is at {origin.split('://', 1)[1]}.",
                )
            origins = [str(o) for o in found.get("origins") or []]
            if origin not in origins:
                client.put("/keys/self/link-origins", {"origins": [*origins, origin]})
    except ProblemError as problem:
        if problem.slug == "ephemeral-forbidden":
            raise ProblemError(
                422,
                "not-a-site-key",
                "That's a personal key",
                "A site key is a domain key for this site's address.",
            ) from None
        if problem.slug == "not-found":
            raise ProblemError(
                422, "site-keys-unsupported", "This ephemeralREST doesn't take site keys yet", None
            ) from None
        raise
    with transaction(conn):
        signup.save_site(conn, settings, key, domain, origin)
    signup.forget_features(request)
    return _site_public(request, conn)


@router.delete("/site-key", status_code=204, summary="Forget the site key")
def delete_site_key(request: Request, conn: Db, _: OwnerPrincipal) -> Response:
    """Sign-up emails go back to linking to ephemeralREST's own pages."""
    with transaction(conn):
        signup.forget_site(conn)
    return Response(status_code=204)
