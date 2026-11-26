"""
AstrologyStudio ·
server/astrologystudio/api/users.py

/api/v1/users:

the people who can log in. Only the owner sees, adds or removes them.

Copyright (c) 2026 Gavin Melhuish
MIT License; see LICENSE in the project root.
SPDX-License-Identifier: MIT
"""

from __future__ import annotations

import json
import sqlite3
from typing import Annotated, Any

from fastapi import APIRouter, Request, Response
from pydantic import EmailStr, Field

from .. import accounts, audit, limits
from ..db import now, transaction
from ..deps import Db, OwnerPrincipal
from ..errors import ProblemError, not_found
from ..schemas import Strict, normalise_email

router = APIRouter(prefix="/users", tags=["Users"])


class UserCreate(Strict):
    name: Annotated[str, Field(min_length=1, max_length=200)]
    email: EmailStr
    password: Annotated[str, Field(min_length=1, max_length=200)]
    """A starting password to pass on to them; they can change it after logging in."""


def _listed(row: sqlite3.Row) -> dict[str, Any]:
    """What the owner sees of someone: with whether they're switched off, and why."""
    return {
        **accounts.public_user(row),
        "disabled": bool(row["disabled_at"]),
        "disabled_at": row["disabled_at"],
        "disabled_reason": row["disabled_reason"],
    }


def _user(conn: sqlite3.Connection, user_id: str) -> sqlite3.Row:
    row: sqlite3.Row | None = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    if row is None:
        raise not_found("User", user_id)
    return row


@router.get("", summary="List users")
def list_users(conn: Db, _: OwnerPrincipal) -> dict[str, Any]:
    rows = conn.execute("SELECT * FROM users ORDER BY created_at").fetchall()
    return {"data": [_listed(r) for r in rows]}


@router.get("/activity", summary="Everyone's activity, newest first (with addresses that have no account)")
def all_activity(
    conn: Db, _: OwnerPrincipal, before: int | None = None, failures: bool = False
) -> dict[str, Any]:
    return audit.page(conn, user_id=None, before=before, failures=failures, every_user=True)


@router.get("/{user_id}", summary="One person, for the user window")
def get_user(user_id: str, conn: Db, _: OwnerPrincipal) -> dict[str, Any]:
    """Their details, their key's prefix and ephemeralREST's own limits for it, and their limits
    here with what they've used."""
    row = _user(conn, user_id)
    key = conn.execute("SELECT prefix, identity FROM ephemeral_keys WHERE user_id = ?", (user_id,)).fetchone()
    identity = json.loads(key["identity"]) if key and key["identity"] else None
    own = limits.own_limits(conn, user_id)
    return {
        **_listed(row),
        "key_prefix": key["prefix"] if key else None,
        "ephemeral_limits": (identity or {}).get("rate_limits") if isinstance(identity, dict) else None,
        "limits": own,
        "uses_site_defaults": own is None,
        "site_defaults": limits.site_defaults(conn),
        "usage": limits.usage(conn, user_id),
    }


@router.get("/{user_id}/activity", summary="One person's activity, newest first")
def user_activity(
    user_id: str, conn: Db, _: OwnerPrincipal, before: int | None = None, failures: bool = False
) -> dict[str, Any]:
    _user(conn, user_id)
    return audit.page(conn, user_id=user_id, before=before, failures=failures)


class StatusChange(Strict):
    enabled: bool
    reason: Annotated[str, Field(max_length=300)] = ""
    """Only the owner sees it. The person is told the same thing whatever it says."""


@router.put("/{user_id}/status", summary="Allow someone to log in, or switch their account off")
def set_status(
    user_id: str, body: StatusChange, request: Request, conn: Db, person: OwnerPrincipal
) -> dict[str, Any]:
    """Switching off ends their sessions at once and makes the next login ask for a code even on
    a trusted browser. Their charts, settings and ephemeralREST key are left as they are."""
    row = _user(conn, user_id)
    if not body.enabled and (row["is_owner"] or user_id == person.id):
        raise ProblemError(409, "cant-disable-owner", "The owner can't be switched off", None)
    reason = body.reason.strip()
    ended = 0
    with transaction(conn):
        if body.enabled:
            conn.execute(
                "UPDATE users SET disabled_at = NULL, disabled_by = NULL, disabled_reason = NULL"
                " WHERE id = ?",
                (user_id,),
            )
        else:
            conn.execute(
                "UPDATE users SET disabled_at = ?, disabled_by = ?, disabled_reason = ?, ignore_device = 1"
                " WHERE id = ?",
                (now(), person.id, reason or None, user_id),
            )
            ended = conn.execute("DELETE FROM sessions WHERE user_id = ?", (user_id,)).rowcount
    was = bool(row["disabled_at"])
    if body.enabled != (not was):
        audit.record(
            conn,
            request,
            "enabled" if body.enabled else "disabled",
            "by-owner",
            user_id=user_id,
            detail=reason,
        )
        if not body.enabled and ended:
            audit.record(conn, request, "session_ended", "by-disabling", user_id=user_id)
        from .auth import _tell  # optional, off unless the owner switches it on in Email designs

        _tell(
            conn,
            request,
            user_id,
            "account_status",
            {"status": "switched on" if body.enabled else "switched off"},
        )
    return _listed(_user(conn, user_id))


class Limits(Strict):
    hour: Annotated[int, Field(ge=0, le=1_000_000)] | None = None
    day: Annotated[int, Field(ge=0, le=1_000_000)] | None = None
    week: Annotated[int, Field(ge=0, le=10_000_000)] | None = None
    month: Annotated[int, Field(ge=0, le=10_000_000)] | None = None


class UserLimits(Strict):
    use_site_defaults: bool = False
    limits: Limits = Field(default_factory=Limits)
    """Empty (null) for no limit in that period."""


@router.get("/{user_id}/limits", summary="Someone's limits, and what they've used")
def get_limits(user_id: str, conn: Db, _: OwnerPrincipal) -> dict[str, Any]:
    _user(conn, user_id)
    own = limits.own_limits(conn, user_id)
    return {"use_site_defaults": own is None, "limits": own, "usage": limits.usage(conn, user_id)}


@router.put("/{user_id}/limits", summary="Set someone's limits")
def set_limits(
    user_id: str, body: UserLimits, request: Request, conn: Db, _: OwnerPrincipal
) -> dict[str, Any]:
    row = _user(conn, user_id)
    if row["is_owner"]:
        raise ProblemError(409, "owner-unlimited", "The owner has no limits", None)
    values = None if body.use_site_defaults else body.limits.model_dump()
    with transaction(conn):
        limits.set_own_limits(conn, user_id, values)
    shown = (
        "site defaults"
        if values is None
        else ", ".join(f"{v} a {k}" for k, v in values.items() if v is not None) or "no limits"
    )
    audit.record(conn, request, "limits_changed", "by-owner", user_id=user_id, detail=shown)
    return get_limits(user_id, conn, _)


@router.post("", status_code=201, summary="Add a user")
def add_user(body: UserCreate, conn: Db, _: OwnerPrincipal) -> dict[str, Any]:
    email = normalise_email(body.email)
    problem = accounts.password_problem(body.password, email)
    if problem:
        raise ProblemError(422, "weak-password", "Choose a stronger password", problem)
    try:
        with transaction(conn):
            user_id = accounts.create_user(conn, email=email, name=body.name, password=body.password)
    except sqlite3.IntegrityError:
        raise ProblemError(409, "email-exists", "Already a user", f"{email} can already log in.") from None
    row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    return accounts.public_user(row)


@router.delete("/{user_id}", status_code=204, summary="Remove a user")
def remove_user(user_id: str, conn: Db, person: OwnerPrincipal) -> Response:
    """Logs them out everywhere. You can't remove yourself, so there's always someone left."""
    if user_id == person.id:
        raise ProblemError(
            409, "cant-remove-self", "Can't remove yourself", "Ask another user to remove you."
        )
    with transaction(conn):
        if not conn.execute("DELETE FROM users WHERE id = ?", (user_id,)).rowcount:
            raise not_found("User", user_id)
    return Response(status_code=204)
