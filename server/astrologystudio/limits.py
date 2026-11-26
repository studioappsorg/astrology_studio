"""
AstrologyStudio ·
server/astrologystudio/limits.py

Limits on how many calls AstrologyStudio sends to ephemeralREST for each person: per hour, day,
week (from Monday) and month, in the time zone the owner chooses. Answers from the cache cost
nothing. A person's own limits replace the site's defaults; a missing limit means none; the
owner is never limited.

Copyright (c) 2026 Gavin Melhuish
MIT License; see LICENSE in the project root.
SPDX-License-Identifier: MIT
"""

from __future__ import annotations

import json
import sqlite3
from datetime import UTC, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from . import audit
from .db import now, transaction
from .errors import ProblemError

PERIODS = ("hour", "day", "week", "month")
COLUMNS = {p: f"per_{p}" for p in PERIODS}
DEFAULTS_SETTING = "default_limits"
ZONE_SETTING = "limits_time_zone"

_WORDS = {"hour": "this hour", "day": "today", "week": "this week", "month": "this month"}
_PER = {"hour": "an hour", "day": "a day", "week": "a week", "month": "a month"}
_RESETS = {"hour": "on the hour", "day": "at midnight", "week": "on Monday", "month": "on the 1st"}


def _setting(conn: sqlite3.Connection, key: str) -> Any:
    row = conn.execute("SELECT value FROM settings WHERE key = ?", (key,)).fetchone()
    return json.loads(row["value"]) if row else None


def _put_setting(conn: sqlite3.Connection, key: str, value: Any) -> None:
    conn.execute(
        "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)"
        " ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
        (key, json.dumps(value), now()),
    )


def time_zone(conn: sqlite3.Connection) -> str:
    value = _setting(conn, ZONE_SETTING)
    return value if isinstance(value, str) and value else "UTC"


def _zone(conn: sqlite3.Connection) -> ZoneInfo:
    try:
        return ZoneInfo(time_zone(conn))
    except ZoneInfoNotFoundError:
        return ZoneInfo("UTC")


def valid_zone(name: str) -> bool:
    try:
        ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError):
        return False
    return True


def window(period: str, moment: datetime, zone: ZoneInfo) -> tuple[datetime, datetime]:
    """The start and end (as UTC) of the period's window holding `moment`."""
    local = moment.astimezone(zone)
    if period == "hour":
        start = local.replace(minute=0, second=0, microsecond=0)
        end = start + timedelta(hours=1)
    elif period == "day":
        start = local.replace(hour=0, minute=0, second=0, microsecond=0)
        end = start + timedelta(days=1)  # wall-clock arithmetic: the next midnight
    elif period == "week":
        day = local.replace(hour=0, minute=0, second=0, microsecond=0)
        start = day - timedelta(days=day.weekday())
        end = start + timedelta(days=7)
    else:
        start = local.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        end = (start + timedelta(days=32)).replace(day=1)
    # Re-attach the zone so a time across a clock change has that day's offset.
    start = start.replace(tzinfo=None).replace(tzinfo=zone)
    end = end.replace(tzinfo=None).replace(tzinfo=zone)
    return start.astimezone(UTC), end.astimezone(UTC)


def _iso(moment: datetime) -> str:
    return moment.isoformat(timespec="seconds").replace("+00:00", "Z")


def _clean(values: Any) -> dict[str, int | None]:
    values = values if isinstance(values, dict) else {}
    out: dict[str, int | None] = {}
    for period in PERIODS:
        value = values.get(period)
        out[period] = int(value) if isinstance(value, int) and value >= 0 else None
    return out


def site_defaults(conn: sqlite3.Connection) -> dict[str, int | None]:
    return _clean(_setting(conn, DEFAULTS_SETTING))


def set_site_defaults(conn: sqlite3.Connection, values: dict[str, int | None], zone: str | None) -> None:
    with transaction(conn):
        _put_setting(conn, DEFAULTS_SETTING, _clean(values))
        if zone is not None:
            _put_setting(conn, ZONE_SETTING, zone)


def own_limits(conn: sqlite3.Connection, user_id: str) -> dict[str, int | None] | None:
    row = conn.execute("SELECT * FROM user_limits WHERE user_id = ?", (user_id,)).fetchone()
    return {p: row[COLUMNS[p]] for p in PERIODS} if row else None


def set_own_limits(conn: sqlite3.Connection, user_id: str, values: dict[str, int | None] | None) -> None:
    """None: use the site's defaults."""
    if values is None:
        conn.execute("DELETE FROM user_limits WHERE user_id = ?", (user_id,))
        return
    clean = _clean(values)
    conn.execute(
        "INSERT INTO user_limits (user_id, per_hour, per_day, per_week, per_month, updated_at)"
        " VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (user_id) DO UPDATE SET per_hour = excluded.per_hour,"
        " per_day = excluded.per_day, per_week = excluded.per_week, per_month = excluded.per_month,"
        " updated_at = excluded.updated_at",
        (user_id, clean["hour"], clean["day"], clean["week"], clean["month"], now()),
    )


def effective(conn: sqlite3.Connection, user_id: str) -> tuple[dict[str, int | None], str]:
    """The limits that apply, and where they come from: "own", "site", or "owner" (none)."""
    row = conn.execute("SELECT is_owner FROM users WHERE id = ?", (user_id,)).fetchone()
    if row is None or row["is_owner"]:
        return dict.fromkeys(PERIODS), "owner"
    own = own_limits(conn, user_id)
    return (own, "own") if own is not None else (site_defaults(conn), "site")


def usage(conn: sqlite3.Connection, user_id: str, moment: datetime | None = None) -> dict[str, Any]:
    """Each period's count in its current window, its limit, and when it starts again."""
    moment = moment or datetime.now(UTC)
    zone = _zone(conn)
    limits, source = effective(conn, user_id)
    rows = {r["period"]: r for r in conn.execute("SELECT * FROM usage_counts WHERE user_id = ?", (user_id,))}
    periods = {}
    for period in PERIODS:
        start, end = window(period, moment, zone)
        row = rows.get(period)
        used = row["count"] if row is not None and row["period_start"] == _iso(start) else 0
        periods[period] = {"used": used, "limit": limits[period], "resets_at": _iso(end)}
    return {"source": source, "time_zone": time_zone(conn), "periods": periods}


_UPSERT = (
    "INSERT INTO usage_counts (user_id, period, period_start, count, reached) VALUES (?, ?, ?, ?, ?)"
    " ON CONFLICT (user_id, period) DO UPDATE SET period_start = excluded.period_start,"
    " count = excluded.count, reached = excluded.reached"
)


def spend(conn: sqlite3.Connection, user_id: str, moment: datetime | None = None) -> None:
    """Count one call to ephemeralREST for this person, or refuse it (429 limit-reached) if it
    would go over a limit. Called just before the call is sent."""
    moment = moment or datetime.now(UTC)
    limits, source = effective(conn, user_id)
    if source == "owner":
        return
    zone = _zone(conn)
    blocked: tuple[str, int, datetime] | None = None
    first_block = False
    with transaction(conn):
        windows = {p: window(p, moment, zone) for p in PERIODS}
        rows = {
            r["period"]: r for r in conn.execute("SELECT * FROM usage_counts WHERE user_id = ?", (user_id,))
        }
        counts: dict[str, tuple[int, bool]] = {}
        for period in PERIODS:
            row = rows.get(period)
            if row is not None and row["period_start"] == _iso(windows[period][0]):
                counts[period] = (int(row["count"]), bool(row["reached"]))
            else:
                counts[period] = (0, False)
        for period in PERIODS:
            limit = limits[period]
            if limit is not None and counts[period][0] + 1 > limit:
                blocked = (period, limit, windows[period][1])
                first_block = not counts[period][1]
                conn.execute(_UPSERT, (user_id, period, _iso(windows[period][0]), counts[period][0], 1))
                break
        else:
            for period in PERIODS:
                count, reached = counts[period]
                conn.execute(_UPSERT, (user_id, period, _iso(windows[period][0]), count + 1, int(reached)))
    if blocked is None:
        return
    period, limit, resets = blocked
    if first_block:
        audit.record(conn, None, "limit_reached", period, user_id=user_id, detail=f"{limit} {_WORDS[period]}")
    raise ProblemError(
        429,
        "limit-reached",
        f"You've reached your limit for {_WORDS[period]}",
        f"{limit} calculation{'' if limit == 1 else 's'} {_PER[period]}. It resets {_RESETS[period]}.",
        period=period,
        resets_at=_iso(resets),
    )
