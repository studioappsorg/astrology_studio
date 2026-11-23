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

import sqlite3
from typing import Annotated, Any

from fastapi import APIRouter, Response
from pydantic import EmailStr, Field

from .. import accounts
from ..db import transaction
from ..deps import Db, OwnerPrincipal
from ..errors import ProblemError, not_found
from ..schemas import Strict, normalise_email

router = APIRouter(prefix="/users", tags=["Users"])


class UserCreate(Strict):
    name: Annotated[str, Field(min_length=1, max_length=200)]
    email: EmailStr
    password: Annotated[str, Field(min_length=1, max_length=200)]
    """A starting password to pass on to them; they can change it after logging in."""


@router.get("", summary="List users")
def list_users(conn: Db, _: OwnerPrincipal) -> dict[str, Any]:
    rows = conn.execute("SELECT * FROM users ORDER BY created_at").fetchall()
    return {"data": [accounts.public_user(r) for r in rows]}


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
