"""
AstrologyStudio ·
server/astrologystudio/audit.py

The activity log: logins, codes, sign-ups, password and key changes, and what the owner does
to an account. Never a password, code, token or key (a key's prefix at most).

Kept for 12 months unless the owner chooses otherwise; deleted with the account, and part of
the person's own data download.

Copyright (c) 2026 Gavin Melhuish
MIT License; see LICENSE in the project root.
SPDX-License-Identifier: MIT
"""

from __future__ import annotations

import json
import random
import sqlite3
from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import Request

from .db import now

RETENTION_SETTING = "activity_retention_months"
DEFAULT_RETENTION_MONTHS = 12
PAGE = 50

# Outcomes that aren't failures (the rest show under "Failures only").
OK = frozenset({
    "success", "requested", "completed", "by-person", "by-owner", "by-disabling", "code-skipped",
    "saved", "switched", "forgotten", "done",
})  # fmt: skip


def _client(request: Request | None) -> tuple[str, str]:
    if request is None:
        return "", ""
    ip = request.client.host if request.client else ""
    return ip, (request.headers.get("user-agent") or "")[:300]


def record(
    conn: sqlite3.Connection,
    request: Request | None,
    event: str,
    outcome: str,
    *,
    user_id: str | None = None,
    email: str = "",
    detail: str = "",
) -> None:
    """Write one event. Outside a transaction it's written at once (the connection autocommits),
    so a failed login is kept even though the request then fails."""
    ip, agent = _client(request)
    if user_id and not email:
        row = conn.execute("SELECT email FROM users WHERE id = ?", (user_id,)).fetchone()
        email = row["email"] if row else ""
    if user_id is None and email:
        row = conn.execute("SELECT id FROM users WHERE email = ?", (email,)).fetchone()
        user_id = row["id"] if row else None
    conn.execute(
        "INSERT INTO auth_events (user_id, email, at, ip, user_agent, event, outcome, detail)"
        " VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        (user_id, email, now(), ip, agent, event, outcome, detail[:300]),
    )
    if random.random() < 0.02:  # now and then, rather than on a timer
        prune(conn)


def retention_months(conn: sqlite3.Connection) -> int:
    row = conn.execute("SELECT value FROM settings WHERE key = ?", (RETENTION_SETTING,)).fetchone()
    value = json.loads(row["value"]) if row else None
    return int(value) if isinstance(value, int) and value > 0 else DEFAULT_RETENTION_MONTHS


def prune(conn: sqlite3.Connection, moment: datetime | None = None) -> int:
    """Remove events older than the retention period. Returns how many went."""
    moment = moment or datetime.now(UTC)
    cutoff = moment - timedelta(days=31 * retention_months(conn))
    stamp = cutoff.isoformat(timespec="milliseconds").replace("+00:00", "Z")
    gone = conn.execute("DELETE FROM auth_events WHERE at < ?", (stamp,)).rowcount
    return int(gone)


def _public(row: sqlite3.Row, with_user: bool) -> dict[str, Any]:
    event = {k: row[k] for k in ("id", "at", "event", "outcome", "detail", "ip", "user_agent")}
    event["failed"] = row["outcome"] not in OK
    if with_user:
        event["user_id"] = row["user_id"]
        event["email"] = row["email"]
    return event


def page(
    conn: sqlite3.Connection,
    *,
    user_id: str | None,
    before: int | None = None,
    failures: bool = False,
    every_user: bool = False,
) -> dict[str, Any]:
    """Newest first, 50 at a time; `next` is the `before` for the next page (null at the end)."""
    where: list[str] = []
    args: list[Any] = []
    if not every_user:
        where.append("user_id = ?")
        args.append(user_id)
    if before:
        where.append("id < ?")
        args.append(before)
    if failures:
        where.append(f"outcome NOT IN ({','.join('?' * len(OK))})")
        args.extend(sorted(OK))
    sql = "SELECT * FROM auth_events" + (" WHERE " + " AND ".join(where) if where else "")
    rows = conn.execute(sql + " ORDER BY id DESC LIMIT ?", (*args, PAGE + 1)).fetchall()
    more = len(rows) > PAGE
    rows = rows[:PAGE]
    return {
        "data": [_public(r, every_user) for r in rows],
        "next": rows[-1]["id"] if more and rows else None,
    }


def for_export(conn: sqlite3.Connection, user_id: str) -> list[dict[str, Any]]:
    rows = conn.execute("SELECT * FROM auth_events WHERE user_id = ? ORDER BY id", (user_id,)).fetchall()
    return [_public(r, False) for r in rows]
