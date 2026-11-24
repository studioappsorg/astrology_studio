"""
AstrologyStudio ·
server/astrologystudio/api/branding.py

/api/v1/branding:

the owner's business details (free text: name, address, phone, website...) and logo. The logo
goes on saved chart images (PNG and SVG); both go in a box on client sheets. Anyone logged in
can fetch them; only the owner can change them. It's handed out inside JSON as a
data URL, never served as a file of its own, so an SVG logo can't run anything on this site.

Copyright (c) 2026 Gavin Melhuish
MIT License; see LICENSE in the project root.
SPDX-License-Identifier: MIT
"""

from __future__ import annotations

import base64
import binascii
import json
import re
from typing import Annotated, Any

from fastapi import APIRouter, Response
from pydantic import Field

from ..db import now, transaction
from ..deps import Db, OwnerPrincipal, UserPrincipal
from ..errors import ProblemError
from ..schemas import Strict

router = APIRouter(prefix="/branding", tags=["Branding"])

SETTING_KEY = "branding"
MAX_BYTES = 1024 * 1024
DATA_URL = re.compile(r"^data:(image/(?:png|jpeg|webp|svg\+xml));base64,([A-Za-z0-9+/=\s]+)$")
MAGIC = {
    "image/png": (b"\x89PNG\r\n\x1a\n",),
    "image/jpeg": (b"\xff\xd8\xff",),
    "image/webp": (b"RIFF",),
}


MAX_DETAILS = 1000


class DetailsUpdate(Strict):
    details: Annotated[str, Field(max_length=MAX_DETAILS)]
    """The business details as they should print: any lines of text, up to 1,000 characters."""


class LogoUpload(Strict):
    data_url: Annotated[str, Field(max_length=MAX_BYTES * 2)]
    """The image as a data URL: PNG, JPEG, WebP or SVG, up to 1 MB."""


def stored(conn: Db) -> dict[str, Any]:
    """Everything kept: {"logo": data URL or None, "details": text}."""
    row = conn.execute("SELECT value FROM settings WHERE key = ?", (SETTING_KEY,)).fetchone()
    value = json.loads(row["value"]) if row else {}
    if not isinstance(value, dict):
        value = {}
    found = value.get("logo")
    details = value.get("details")
    return {
        "logo": found if isinstance(found, str) else None,
        "details": details if isinstance(details, str) else "",
    }


def logo(conn: Db) -> str | None:
    found = stored(conn)["logo"]
    return found if isinstance(found, str) else None


def _save(conn: Db, **changes: Any) -> dict[str, Any]:
    value = {**stored(conn), **changes}
    with transaction(conn):
        if value["logo"] is None and not value["details"]:
            conn.execute("DELETE FROM settings WHERE key = ?", (SETTING_KEY,))
        else:
            conn.execute(
                "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)"
                " ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
                (SETTING_KEY, json.dumps(value), now()),
            )
    return value


def _check(data_url: str) -> str:
    match = DATA_URL.match(data_url.strip())
    if not match:
        raise ProblemError(422, "bad-logo", "Use a PNG, JPEG, WebP or SVG image", None)
    kind, encoded = match.group(1), re.sub(r"\s+", "", match.group(2))
    try:
        data = base64.b64decode(encoded, validate=True)
    except (binascii.Error, ValueError):
        raise ProblemError(422, "bad-logo", "That image couldn't be read", None) from None
    if len(data) > MAX_BYTES:
        raise ProblemError(422, "logo-too-big", "Use an image under 1 MB", None)
    if kind == "image/svg+xml":
        head = data[:2048].decode("utf-8", errors="replace").lower()
        if "<svg" not in head:
            raise ProblemError(422, "bad-logo", "That isn't an SVG image", None)
    elif not data.startswith(MAGIC[kind]):
        raise ProblemError(422, "bad-logo", "That image doesn't match its type", None)
    return f"data:{kind};base64,{encoded}"


@router.get("", summary="The business details and logo (as a data URL)")
def get_branding(conn: Db, _: UserPrincipal) -> dict[str, Any]:
    return stored(conn)


@router.put("/details", summary="Set the business details")
def put_details(body: DetailsUpdate, conn: Db, _: OwnerPrincipal) -> dict[str, Any]:
    lines = [line.rstrip() for line in body.details.replace("\r\n", "\n").split("\n")]
    return _save(conn, details="\n".join(lines).strip("\n"))


@router.put("/logo", summary="Set the business logo")
def put_logo(body: LogoUpload, conn: Db, _: OwnerPrincipal) -> dict[str, Any]:
    return _save(conn, logo=_check(body.data_url))


@router.delete("/logo", summary="Remove the business logo", status_code=204)
def delete_logo(conn: Db, _: OwnerPrincipal) -> Response:
    _save(conn, logo=None)
    return Response(status_code=204)
