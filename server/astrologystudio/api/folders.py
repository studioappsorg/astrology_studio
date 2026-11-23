"""
AstrologyStudio ·
server/astrologystudio/api/folders.py

/api/v1/folders:

your own folders for charts.

Copyright (c) 2026 Gavin Melhuish
MIT License; see LICENSE in the project root.
SPDX-License-Identifier: MIT
"""

from __future__ import annotations

import sqlite3
from typing import Annotated, Any

from fastapi import APIRouter, Response
from pydantic import Field

from ..db import now, transaction
from ..deps import Db, UserPrincipal
from ..errors import ProblemError, not_found
from ..ids import new_id
from ..schemas import Strict

router = APIRouter(prefix="/folders", tags=["Folders"])


class FolderBody(Strict):
    name: Annotated[str, Field(min_length=1, max_length=80)]


def _row(row: sqlite3.Row, counts: dict[str, int]) -> dict[str, Any]:
    return {"id": row["id"], "name": row["name"], "charts": counts.get(row["id"], 0)}


@router.get("", summary="Your folders")
def list_folders(conn: Db, person: UserPrincipal) -> dict[str, Any]:
    counts = {
        r["folder_id"]: r["n"]
        for r in conn.execute(
            "SELECT folder_id, COUNT(*) AS n FROM chart_notes WHERE user_id = ? AND folder_id IS NOT NULL"
            " GROUP BY folder_id",
            (person.id,),
        )
    }
    rows = conn.execute("SELECT * FROM folders WHERE user_id = ? ORDER BY name COLLATE NOCASE", (person.id,))
    return {"data": [_row(r, counts) for r in rows]}


def _duplicate(name: str) -> ProblemError:
    return ProblemError(409, "folder-exists", "You already have that folder", name)


@router.post("", status_code=201, summary="Add a folder")
def add_folder(body: FolderBody, conn: Db, person: UserPrincipal) -> dict[str, Any]:
    folder_id = new_id("folder")
    try:
        with transaction(conn):
            conn.execute(
                "INSERT INTO folders (id, user_id, name, created_at) VALUES (?, ?, ?, ?)",
                (folder_id, person.id, body.name.strip(), now()),
            )
    except sqlite3.IntegrityError:
        raise _duplicate(body.name) from None
    return {"id": folder_id, "name": body.name.strip(), "charts": 0}


@router.patch("/{folder_id}", summary="Rename a folder")
def rename_folder(folder_id: str, body: FolderBody, conn: Db, person: UserPrincipal) -> dict[str, Any]:
    try:
        with transaction(conn):
            changed = conn.execute(
                "UPDATE folders SET name = ? WHERE id = ? AND user_id = ?",
                (body.name.strip(), folder_id, person.id),
            ).rowcount
    except sqlite3.IntegrityError:
        raise _duplicate(body.name) from None
    if not changed:
        raise not_found("Folder", folder_id)
    return {"id": folder_id, "name": body.name.strip()}


@router.delete("/{folder_id}", status_code=204, summary="Remove a folder")
def remove_folder(folder_id: str, conn: Db, person: UserPrincipal) -> Response:
    """Its charts stay in your list, just not in a folder."""
    with transaction(conn):
        if not conn.execute(
            "DELETE FROM folders WHERE id = ? AND user_id = ?", (folder_id, person.id)
        ).rowcount:
            raise not_found("Folder", folder_id)
    return Response(status_code=204)
