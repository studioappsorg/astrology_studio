"""
AstrologyStudio ·
server/astrologystudio/delivery.py

Emails ephemeralREST hands back for this site to send (its `deliver` objects), once the owner has
switched on "Send ephemeralREST's emails from this site" (Settings → Email). ephemeralREST only
does that for accounts made through this site's key, so a site never sees another site's (or the
portal's) codes or tokens.

A code or token is used only to build the email: it's never stored and never logged. If sending
fails, the person is told to try again (which gets a fresh code); there's no falling back to
ephemeralREST's own email, which would mix two brands.

Copyright (c) 2026 Gavin Melhuish
MIT License; see LICENSE in the project root.
SPDX-License-Identifier: MIT
"""

from __future__ import annotations

import json
import logging
import sqlite3
from datetime import datetime
from typing import Any

from fastapi import Request

from . import audit, email_design, signup
from .config import Settings
from .db import now
from .errors import ProblemError

log = logging.getLogger("astrologystudio")

FAILURE_SETTING = "email_delivery_failure"
"""When a delivered email last failed (shown to the owner), cleared by the next success."""


def _when(value: Any) -> str:
    if not isinstance(value, str) or not value:
        return "soon"
    try:
        moment = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return "soon"
    return moment.strftime("%d %b %Y, %H:%M UTC")


def _values(settings: Settings, deliver: dict[str, Any], name: str) -> tuple[str, dict[str, str]] | None:
    """The template and placeholder values for one `deliver` object (None: a kind we don't know)."""
    kind = deliver.get("kind")
    base = settings.base_url
    links = signup.links(settings)
    token = str(deliver.get("token") or "")
    common = {"name": name, "expires": _when(deliver.get("expires_at"))}
    if kind == "verify":
        return "verify", {**common, "link": links["verify"].replace("{token}", token)}
    if kind in ("password_reset", "set_password"):
        return "password_reset", {**common, "link": links["set_password"].replace("{token}", token)}
    if kind == "login_code":
        return "login_code", {**common, "code": str(deliver.get("code") or "")}
    if kind == "welcome":
        return "welcome", {"name": name, "login_link": f"{base}/"}
    if kind == "key_replaced":
        return "key_replaced", {"name": name, "date": now()[:10], "account_link": f"{base}/account"}
    return None


def send(request: Request, conn: sqlite3.Connection, deliver: dict[str, Any], email: str, name: str) -> None:
    settings: Settings = request.app.state.settings
    found = _values(settings, deliver, name)
    if found is None:
        log.warning("ephemeralREST handed back an email of a kind this version doesn't know")
        return
    key, values = found
    try:
        email_design.send(conn, settings, key, email, values)
    except ProblemError as problem:
        # Not the code or token, and not the email's text: only what went wrong.
        log.warning("A %s email couldn't be sent: %s", key, problem.title)
        audit.record(conn, request, "email_failed", key, email=email, detail=problem.title)
        conn.execute(
            "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)"
            " ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
            (FAILURE_SETTING, json.dumps({"at": now(), "kind": key, "problem": problem.title}), now()),
        )
        raise ProblemError(502, "email-failed", "We couldn't send the email", "Try again shortly.") from None
    conn.execute("DELETE FROM settings WHERE key = ?", (FAILURE_SETTING,))


def last_failure(conn: sqlite3.Connection) -> dict[str, Any] | None:
    row = conn.execute("SELECT value FROM settings WHERE key = ?", (FAILURE_SETTING,)).fetchone()
    value = json.loads(row["value"]) if row else None
    return value if isinstance(value, dict) else None
