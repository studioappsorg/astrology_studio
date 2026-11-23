"""
AstrologyStudio ·
server/astrologystudio/api/account.py

/api/v1/account:

your own ephemeralREST API key, a copy of your data, and deleting your account.

Copyright (c) 2026 Gavin Melhuish
MIT License; see LICENSE in the project root.
SPDX-License-Identifier: MIT
"""

from __future__ import annotations

import json
import sqlite3
from typing import Annotated, Any

from fastapi import APIRouter, Request, Response
from pydantic import Field

from .. import __version__, accounts, charts, secretbox
from ..config import Settings
from ..db import now, transaction
from ..deps import Db, UserPrincipal, stored_key, transport
from ..ephemeral import Ephemeral, configured_url
from ..errors import ProblemError
from ..schemas import Strict, normalise_email

router = APIRouter(prefix="/account", tags=["Account"])


class KeyUpdate(Strict):
    api_key: Annotated[str, Field(min_length=8, max_length=200)]


def _public(row: Any) -> dict[str, Any]:
    if row is None:
        return {"configured": False}
    identity = json.loads(row["identity"]) if row["identity"] else None
    return {
        "configured": True,
        "prefix": row["prefix"],
        "identity": identity,
        "checked_at": row["checked_at"],
        "updated_at": row["updated_at"],
    }


@router.get("/ephemeral-key", summary="Your ephemeralREST key (never the key itself)")
def get_key(conn: Db, person: UserPrincipal) -> dict[str, Any]:
    row = conn.execute("SELECT * FROM ephemeral_keys WHERE user_id = ?", (person.id,)).fetchone()
    return _public(row)


@router.put("/ephemeral-key", summary="Save your ephemeralREST key")
def set_key(body: KeyUpdate, request: Request, conn: Db, person: UserPrincipal) -> dict[str, Any]:
    """Checked with ephemeralREST's /me before it's saved, so a typo is caught straight away."""
    settings: Settings = request.app.state.settings
    key = body.api_key.strip()
    with Ephemeral(configured_url(conn, settings), key, transport(request)) as client:
        me = client.get("/me")
    identity = {k: me.get(k) for k in ("name", "identifier", "rate_limits")} if isinstance(me, dict) else None
    with transaction(conn):
        store_key(conn, settings, person.id, key, identity)
    row = conn.execute("SELECT * FROM ephemeral_keys WHERE user_id = ?", (person.id,)).fetchone()
    return _public(row)


def store_key(
    conn: sqlite3.Connection, settings: Settings, user_id: str, key: str, identity: dict[str, Any] | None
) -> None:
    """Save (or replace) someone's ephemeralREST key, encrypted. Call inside a transaction."""
    moment = now()
    conn.execute(
        "INSERT INTO ephemeral_keys (user_id, encrypted, prefix, identity, checked_at, updated_at)"
        " VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (user_id) DO UPDATE SET encrypted = excluded.encrypted,"
        " prefix = excluded.prefix, identity = excluded.identity, checked_at = excluded.checked_at,"
        " updated_at = excluded.updated_at",
        (user_id, secretbox.encrypt(settings, key), key[:8], json.dumps(identity), moment, moment),
    )


@router.delete("/ephemeral-key", status_code=204, summary="Forget your ephemeralREST key")
def delete_key(conn: Db, person: UserPrincipal) -> Response:
    with transaction(conn):
        conn.execute("DELETE FROM ephemeral_keys WHERE user_id = ?", (person.id,))
    return Response(status_code=204)


# ---------------------------------------------------------------------------
# Your data


def _your_ephemeral(request: Request, conn: Db, user_id: str) -> Ephemeral | None:
    settings: Settings = request.app.state.settings
    key = stored_key(conn, settings, user_id)
    url = configured_url(conn, settings)
    if not key or not url:
        return None
    return Ephemeral(url, key, transport(request), request.app.state.ephemeral_cache)


@router.get("/export", summary="A copy of everything AstrologyStudio keeps for you")
def export(request: Request, conn: Db, person: UserPrincipal) -> Response:
    """One JSON file: your account, your chart list (birth details, and what each derived chart was
    worked out from), your notes, folders, ratings and tags, and every preference, theme, layout
    and preset. Your ephemeralREST key isn't included."""
    user = conn.execute(
        "SELECT email, name, is_owner, signs_in_with, created_at FROM users WHERE id = ?", (person.id,)
    ).fetchone()
    stored = {
        row["key"]: json.loads(row["value"])
        for row in conn.execute("SELECT key, value FROM preferences WHERE user_id = ?", (person.id,))
    }
    folders = [dict(r) for r in conn.execute("SELECT * FROM folders WHERE user_id = ?", (person.id,))]
    notes = [dict(r) for r in conn.execute("SELECT * FROM chart_notes WHERE user_id = ?", (person.id,))]
    kept = [dict(r) for r in conn.execute("SELECT * FROM kept_derived WHERE user_id = ?", (person.id,))]
    for item in folders + notes + kept:
        item.pop("user_id", None)
    data: dict[str, Any] = {
        "astrologystudio_export": 1,
        "exported_at": now(),
        "app_version": __version__,
        "account": dict(user),
        "charts": None,
        "chart_notes": notes,
        "kept_derived": kept,
        "folders": folders,
        "preferences": stored,
    }
    client = _your_ephemeral(request, conn, person.id)
    if client is None:
        data["charts_problem"] = "No ephemeralREST key saved, so your chart list couldn't be included."
    else:
        with client:
            try:
                data["charts"] = charts.account_list(client, None)
            except ProblemError as problem:
                data["charts_problem"] = f"{problem.title}. {problem.detail or ''}".strip()
    body = json.dumps(data, indent=2, ensure_ascii=False)
    name = f"astrologystudio-{(user['email'] or 'export').split('@')[0]}-{now()[:10]}.json"
    return Response(
        body,
        media_type="application/json",
        headers={"Content-Disposition": f'attachment; filename="{name}"', "Cache-Control": "no-store"},
    )


class DeleteAccount(Strict):
    password: str | None = None
    """People who log in with a password here confirm with it."""
    email: str | None = None
    """People who log in through ephemeralREST confirm by typing their email address."""
    remove_charts: bool = False
    """Also take every chart off your ephemeralREST chart list."""


@router.post("/delete", status_code=204, summary="Delete your account")
def delete_account(body: DeleteAccount, request: Request, conn: Db, person: UserPrincipal) -> Response:
    """Removes your account and everything kept for you here: preferences, themes, layouts, presets,
    notes, folders, your saved key and every session. With `remove_charts`, your charts are also
    taken off your ephemeralREST chart list first (your ephemeralREST account itself stays). The
    owner's account runs the install, so it can't be deleted this way."""
    row = conn.execute(
        "SELECT email, password_hash, is_owner, signs_in_with FROM users WHERE id = ?", (person.id,)
    ).fetchone()
    if row["is_owner"]:
        raise ProblemError(
            409,
            "owner-cant-delete",
            "The owner's account can't be deleted",
            "It runs this install. Remove the install instead, or ask for help moving it.",
        )
    if row["signs_in_with"] == "ephemeral":
        if normalise_email(body.email or "") != row["email"]:
            raise ProblemError(422, "confirm-email", "Type your email address to confirm", None)
    elif not body.password or not accounts.check_password(body.password, row["password_hash"]):
        raise ProblemError(422, "bad-password", "That password isn't right", None)
    if body.remove_charts:
        client = _your_ephemeral(request, conn, person.id)
        if client is not None:
            with client:
                listed = charts.account_list(client, None)
                # Derived charts first, then the charts they came from.
                for entry in sorted(listed, key=lambda c: c.get("type") != "derived"):
                    client.delete(f"/account/charts/{entry.get('uuid')}")
    with transaction(conn):
        conn.execute("DELETE FROM users WHERE id = ?", (person.id,))  # everything else cascades
    response = Response(status_code=204)
    response.delete_cookie(accounts.SESSION_COOKIE, path="/")
    return response
