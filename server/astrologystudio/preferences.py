"""
AstrologyStudio ·
server/astrologystudio/preferences.py

Each person's display preferences, kept in this install's database.

Stored as one JSON document per key. Values are always merged over the defaults
when read, so a new feature or body added in a later version just appears with
its default setting.

Copyright (c) 2026 Gavin Melhuish
MIT License; see LICENSE in the project root.
SPDX-License-Identifier: MIT
"""

from __future__ import annotations

import json
import re
import sqlite3
from typing import Any

from . import catalog
from .astro import aspects
from .db import now


def get(conn: sqlite3.Connection, user_id: str, key: str) -> Any:
    row = conn.execute(
        "SELECT value FROM preferences WHERE user_id = ? AND key = ?", (user_id, key)
    ).fetchone()
    return json.loads(row["value"]) if row else None


def put(conn: sqlite3.Connection, user_id: str, key: str, value: Any) -> None:
    conn.execute(
        "INSERT INTO preferences (user_id, key, value, updated_at) VALUES (?, ?, ?, ?)"
        " ON CONFLICT (user_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
        (user_id, key, json.dumps(value, separators=(",", ":")), now()),
    )


def _merged(defaults: dict[str, bool], stored: Any) -> dict[str, bool]:
    result = dict(defaults)
    if isinstance(stored, dict):
        for key, value in stored.items():
            if key in result and isinstance(value, bool):
                result[key] = value
    return result


def features(conn: sqlite3.Connection, user_id: str) -> dict[str, bool]:
    return _merged(catalog.default_features(), get(conn, user_id, "features"))


def bodies(conn: sqlite3.Connection, user_id: str) -> dict[str, bool]:
    return _merged(catalog.default_bodies(), get(conn, user_id, "bodies"))


HEX_COLOUR = re.compile(r"^#[0-9a-fA-F]{6}$")


def aspect_colours(conn: sqlite3.Connection, user_id: str) -> dict[str, str]:
    """Your own colour for an aspect (Your view → Aspects), over whichever theme is in use.
    Aspects without one take the theme's colour."""
    stored = get(conn, user_id, "aspect_colours")
    if not isinstance(stored, dict):
        return {}
    return {
        k: v.lower()
        for k, v in stored.items()
        if k in aspects.BY_KEY and isinstance(v, str) and HEX_COLOUR.match(v)
    }


def display(conn: sqlite3.Connection, user_id: str) -> dict[str, str]:
    result = catalog.default_display()
    stored = get(conn, user_id, "display")
    if isinstance(stored, dict):
        for key, value in stored.items():
            if key in catalog.DISPLAY and value in catalog.DISPLAY[key]:
                result[key] = value
    return result


# ---------------------------------------------------------------------------
# Calculation profiles: named sets of calculation settings, one of them active.

DEFAULT_PROFILE_ID = "standard"


def default_profile() -> dict[str, Any]:
    from .astro.aspects import default_settings

    return {
        "id": DEFAULT_PROFILE_ID,
        "name": "Standard",
        # None: use the person's default house system (Settings → Defaults).
        "house_system": None,
        "zodiac": "tropical",
        "ayanamsa": "lahiri",
        "aspects": default_settings(),
        "moving_orb": 1.0,
        "lot_formula": "day",
    }


def clean_profile(raw: dict[str, Any]) -> dict[str, Any]:
    """A stored profile, completed with defaults and with anything unknown dropped."""
    from .astro.aspects import BY_KEY
    from .astro.zodiac import AYANAMSAS
    from .charts import HOUSE_SYSTEMS

    base = default_profile()
    profile = {
        "id": str(raw.get("id") or base["id"]),
        "name": str(raw.get("name") or base["name"])[:60],
        "house_system": raw.get("house_system") if raw.get("house_system") in HOUSE_SYSTEMS else None,
        "zodiac": raw.get("zodiac") if raw.get("zodiac") in ("tropical", "sidereal") else "tropical",
        "ayanamsa": raw.get("ayanamsa") if raw.get("ayanamsa") in AYANAMSAS else base["ayanamsa"],
        "aspects": base["aspects"],
        "moving_orb": _orb(raw.get("moving_orb"), base["moving_orb"]),
        "lot_formula": raw.get("lot_formula") if raw.get("lot_formula") in ("day", "sect") else "day",
    }
    stored = raw.get("aspects")
    if isinstance(stored, dict):
        for key, value in stored.items():
            if key in BY_KEY and isinstance(value, dict):
                orb = value.get("orb", profile["aspects"][key]["orb"])
                profile["aspects"][key] = {
                    "on": bool(value.get("on", profile["aspects"][key]["on"])),
                    "orb": min(max(float(orb), 0.0), 15.0) if isinstance(orb, int | float) else 0.0,
                }
    return profile


def _orb(value: Any, default: float) -> float:
    return min(max(float(value), 0.1), 5.0) if isinstance(value, int | float) else default


CALCULATION_VERSION = 2
"""2 (1.15): a profile's house system can be None, meaning the default."""


def calculation(conn: sqlite3.Connection, user_id: str) -> dict[str, Any]:
    """{"active": id, "profiles": [...]}, always with at least one profile."""
    stored = get(conn, user_id, "calculation")
    if not isinstance(stored, dict):
        stored = {}
    raw_profiles = stored.get("profiles")
    if not isinstance(raw_profiles, list) or not raw_profiles:
        # 0.2 kept just a house system: it becomes the Standard profile.
        raw_profiles = [{**default_profile(), "house_system": stored.get("house_system")}]
    if stored.get("v") != CALCULATION_VERSION:
        # Before 1.15 every profile had a house system, Placidus unless changed. Placidus was
        # the default, so those now follow the default house system instead.
        raw_profiles = [
            {**p, "house_system": None} if isinstance(p, dict) and p.get("house_system") == "placidus" else p
            for p in raw_profiles
        ]
    profiles = [clean_profile(p) for p in raw_profiles if isinstance(p, dict)]
    ids = [p["id"] for p in profiles]
    active = stored.get("active") if stored.get("active") in ids else ids[0]
    return {"active": active, "profiles": profiles}


def save_calculation(conn: sqlite3.Connection, user_id: str, value: dict[str, Any]) -> None:
    put(conn, user_id, "calculation", {**value, "v": CALCULATION_VERSION})


def active_profile(conn: sqlite3.Connection, user_id: str) -> dict[str, Any]:
    """The profile in use, with its house system filled in from the default when it has none
    of its own (`house_system_own` says which)."""
    calc = calculation(conn, user_id)
    profile: dict[str, Any] = next(p for p in calc["profiles"] if p["id"] == calc["active"])
    own = profile["house_system"]
    system = own or defaults(conn, user_id)["house_system"]
    return {**profile, "house_system": system, "house_system_own": own}


def house_system(conn: sqlite3.Connection, user_id: str) -> str:
    """The house system in use: the active profile's, or the default."""
    value: str = active_profile(conn, user_id)["house_system"]
    return value


def chart_house_system(conn: sqlite3.Connection, user_id: str, chart_id: str) -> str:
    """A chart's own house system if it has one, otherwise the one in use."""
    row = conn.execute(
        "SELECT house_system FROM chart_notes WHERE user_id = ? AND chart_id = ?", (user_id, chart_id)
    ).fetchone()
    from .charts import HOUSE_SYSTEMS

    if row and row["house_system"] in HOUSE_SYSTEMS:
        return str(row["house_system"])
    return house_system(conn, user_id)


# ---------------------------------------------------------------------------
# Defaults (Settings): the house system profiles use unless they have their own, and the place
# new charts and charts for now start from.

DEFAULTS = "defaults"


def defaults(conn: sqlite3.Connection, user_id: str) -> dict[str, Any]:
    from .charts import DEFAULT_HOUSE_SYSTEM, HOUSE_SYSTEMS

    stored = get(conn, user_id, DEFAULTS)
    stored = stored if isinstance(stored, dict) else {}
    system = stored.get("house_system")
    place = stored.get("place")
    return {
        "house_system": system if system in HOUSE_SYSTEMS else DEFAULT_HOUSE_SYSTEM,
        "place": place.strip()[:200] if isinstance(place, str) else "",
    }


def save_defaults(conn: sqlite3.Connection, user_id: str, value: dict[str, Any]) -> None:
    put(conn, user_id, DEFAULTS, value)
