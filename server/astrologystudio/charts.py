"""
AstrologyStudio ·
server/astrologystudio/charts.py

Charts:

created, recalculated and stored by ephemeralREST, organised here.

A chart is always calculated with every body and point switched on, so what a
person sees can change with My View without calculating again. Positions are
returned in one tidy shape (`Chart`) whatever shape ephemeralREST sent.

Copyright (c) 2026 Gavin Melhuish
MIT License; see LICENSE in the project root.
SPDX-License-Identifier: MIT
"""

from __future__ import annotations

import json
import re
import sqlite3
from dataclasses import dataclass, field
from datetime import date, time
from typing import Any

from .astro import zodiac
from .db import now
from .ephemeral import Ephemeral
from .errors import ProblemError

DEFAULT_HOUSE_SYSTEM = "placidus"

HOUSE_SYSTEMS: dict[str, str] = {
    "placidus": "Placidus",
    "koch": "Koch",
    "regiomontanus": "Regiomontanus",
    "campanus": "Campanus",
    "equal": "Equal",
    "whole_sign": "Whole Sign",
    "porphyrius": "Porphyry",
    "topocentric": "Topocentric",
    "alcabitus": "Alcabitus",
    "meridian": "Meridian",
    "morinus": "Morinus",
    "vehlow_equal": "Vehlow Equal",
}

RATINGS = ("", "AA", "A", "B", "C", "DD", "X", "XX")

# Ask for everything when calculating; My View decides what's shown.
FULL_OUTPUT: dict[str, Any] = {
    "geocentric": True,
    "heliocentric": True,
    "right_ascension": True,
    "declination": True,
    "longitude_speed": True,
    "latitude_speed": True,
    "declination_speed": True,
    "retrograde": True,
    "angles": {"asc": True, "mc": True, "vertex": True, "east_point": True, "armc": True},
    "bodies": {
        "sun": True,
        "moon": True,
        "mercury": True,
        "venus": True,
        "mars": True,
        "jupiter": True,
        "saturn": True,
        "uranus": True,
        "neptune": True,
        "pluto": True,
        "earth": True,
        "asteroids": True,
        "ceres": True,
        "pallas": True,
        "juno": True,
        "vesta": True,
        "chiron": True,
        "mean_node": True,
        "true_node": True,
        "south_node": True,
        "mean_lilith": True,
        "true_lilith": True,
        "part_of_fortune": True,
    },
    "meta": {"api_usage": False, "from_cache": False},
}

_OFFSET = re.compile(r"^[+-](?:0\d|1[0-4]):[0-5]\d$")
_UUID = re.compile(r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}")
_TAG = re.compile(r"^[a-z0-9][a-z0-9 _-]{0,39}$")


def valid_offset(value: str) -> str:
    value = value.strip()
    if value and not _OFFSET.match(value):
        raise ValueError("Use a UTC offset like +10:00 or -05:30")
    return value


def clean_tags(values: list[str]) -> list[str]:
    tags = sorted({" ".join(v.strip().lower().split()) for v in values if v.strip()})
    for tag in tags:
        if not _TAG.match(tag):
            raise ValueError(f"Tag {tag!r}: use up to 40 letters, digits, spaces, hyphens or underscores")
    if len(tags) > 30:
        raise ValueError("At most 30 tags per chart")
    return tags


@dataclass(frozen=True, slots=True)
class BirthData:
    name: str
    date: date
    time: time | None
    """None when the time is unknown: the chart is set for noon."""
    place: str
    utc_offset: str = ""
    """'+10:00' to set the offset by hand; '' lets ephemeralREST look it up for the place."""

    @property
    def datetime_text(self) -> str:
        moment = self.time or time(12, 0)
        return f"{self.date.isoformat()}T{moment.isoformat(timespec='seconds')}{self.utc_offset}"

    @property
    def time_text(self) -> str:
        return self.time.isoformat(timespec="minutes") if self.time else ""


# ---------------------------------------------------------------------------
# Positions in one shape


@dataclass(slots=True)
class Chart:
    id: str
    name: str
    datetime_utc: str
    datetime_local: str
    location: dict[str, Any]
    house_system: str | None
    houses: list[float] | None
    points: dict[str, dict[str, Any]] = field(default_factory=dict)
    helio: dict[str, dict[str, Any]] = field(default_factory=dict)
    ayanamsas: dict[str, float] | None = None
    """ephemeralREST's ayanamsas for this chart's moment (None from an older ephemeralREST)."""
    zodiac: str = "tropical"
    ayanamsa: str | None = None
    """In a sidereal chart, which ayanamsa, and (`ayanamsa_value`) how many degrees it took off."""
    ayanamsa_value: float | None = None

    def as_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "datetime_utc": self.datetime_utc,
            "datetime_local": self.datetime_local,
            "location": self.location,
            "house_system": self.house_system,
            "houses": self.houses,
            "points": self.points,
            "helio": self.helio,
            "zodiac": {"type": self.zodiac, "ayanamsa": self.ayanamsa, "value": self.ayanamsa_value},
        }

    @classmethod
    def restore(cls, data: dict[str, Any]) -> Chart:
        """A Chart from its as_dict() (kept in a cache), including one kept before zodiacs."""
        fields = {
            k: data[k]
            for k in (
                "id",
                "name",
                "datetime_utc",
                "datetime_local",
                "location",
                "house_system",
                "houses",
                "points",
                "helio",
            )
            if k in data
        }
        chart = cls(**fields)
        kind = data.get("zodiac")
        if isinstance(kind, dict) and kind.get("type") == "sidereal":
            chart.zodiac, chart.ayanamsa, chart.ayanamsa_value = (
                "sidereal",
                kind.get("ayanamsa"),
                kind.get("value"),
            )
        return chart

    def to_sidereal(self, key: str | None) -> Chart:
        """Turn this (tropical) chart sidereal with ayanamsa `key`, in place. Nothing happens if
        `key` is None, the chart is already sidereal, or ephemeralREST sent no ayanamsas."""
        amount = zodiac.value(self.ayanamsas, key)
        if amount is None or self.zodiac == "sidereal":
            return self
        zodiac.shift(self.points, amount)
        zodiac.shift(self.helio, amount)
        if self.houses is not None:
            if self.house_system == "whole_sign" and "asc" in self.points:
                self.houses = zodiac.whole_sign_cusps(self.points["asc"]["lon"])
            else:
                self.houses = [(c - amount) % 360.0 for c in self.houses]
        self.zodiac, self.ayanamsa, self.ayanamsa_value = "sidereal", key, amount
        return self


def split_zodiac(extra: dict[str, Any] | None) -> tuple[dict[str, Any], str | None]:
    """(fields for ephemeralREST, sidereal ayanamsa or None) from a chart request's `extra`."""
    fields = dict(extra or {})
    return fields, fields.pop(zodiac.SIDEREAL, None)


def _point(raw: Any) -> dict[str, Any] | None:
    if not isinstance(raw, dict) or not isinstance(raw.get("longitude"), int | float):
        return None
    speed = raw.get("longitude_speed")
    return {
        "lon": float(raw["longitude"]) % 360.0,
        "lat": float(raw.get("latitude") or 0.0),
        "speed": float(speed) if isinstance(speed, int | float) else None,
        "decl": raw.get("declination"),
        "ra": raw.get("right_ascension"),
        "retro": bool(raw.get("retrograde")) or (isinstance(speed, int | float) and speed < 0),
    }


def _angle(value: Any) -> dict[str, Any] | None:
    if not isinstance(value, int | float):
        return None
    return {"lon": float(value) % 360.0, "lat": 0.0, "speed": None, "decl": None, "ra": None, "retro": False}


def normalise(data: dict[str, Any], chart_id: str | None = None, sidereal: str | None = None) -> Chart:
    """Turn any ephemeralREST chart response (main or derived) into a Chart, sidereal with
    ayanamsa `sidereal` if it's given (and ephemeralREST sent the ayanamsas)."""
    positions = data.get("planetary_positions") or {}
    if "geocentric" in positions or "heliocentric" in positions:
        geo_raw = positions.get("geocentric") or {}
        helio_raw = positions.get("heliocentric") or {}
    else:  # older shape: geocentric bodies at the top, heliocentric alongside
        geo_raw = positions
        helio_raw = data.get("heliocentric") or {}

    points = {name: p for name, raw in geo_raw.items() if (p := _point(raw)) is not None}
    helio = {name: p for name, raw in helio_raw.items() if (p := _point(raw)) is not None}

    cusps_raw = data.get("house_cusps") or None
    houses: list[float] | None = None
    system: str | None = None
    if isinstance(cusps_raw, dict):
        system = cusps_raw.get("system")
        cusps = cusps_raw.get("cusps") or {}
        if isinstance(cusps, dict) and all(str(i) in cusps for i in range(1, 13)):
            houses = [float(cusps[str(i)]) % 360.0 for i in range(1, 13)]
        elif isinstance(cusps, list) and len(cusps) >= 12:
            houses = [float(c) % 360.0 for c in cusps[:12]]
        for key in ("asc", "mc", "vertex", "east_point"):
            if key not in points and (a := _angle(cusps_raw.get(key))) is not None:
                points[key] = a

    location = data.get("location") or {}
    return Chart(
        id=str(chart_id or data.get("chart_id") or data.get("derived_chart_id") or ""),
        name=str(data.get("chart_name") or ""),
        datetime_utc=str(data.get("datetime_utc") or data.get("return_datetime_utc") or ""),
        datetime_local=str(data.get("datetime_local") or data.get("return_datetime_local") or ""),
        location={
            "name": location.get("formatted_address") or location.get("formatted_name") or "",
            "latitude": location.get("latitude"),
            "longitude": location.get("longitude"),
            "timezone": location.get("timezone"),
            "utc_offset_seconds": location.get("utc_offset_seconds"),
            "daylight_saving": location.get("daylight_saving"),
        },
        house_system=system,
        houses=houses,
        points=points,
        helio=helio,
        ayanamsas=_ayanamsas(data.get("ayanamsa")),
    ).to_sidereal(sidereal)


def _ayanamsas(raw: Any) -> dict[str, float] | None:
    if not isinstance(raw, dict):
        return None
    found = {k: float(v) for k, v in raw.items() if isinstance(v, int | float)}
    return found or None


# ---------------------------------------------------------------------------
# Talking to ephemeralREST


def calculate(
    eph: Ephemeral,
    birth: BirthData,
    house_system: str,
    recalc_id: str | None = None,
    extra: dict[str, Any] | None = None,
) -> Chart:
    """`extra` carries further /calculate fields, and the zodiac (see astro.zodiac)."""
    fields, sidereal = split_zodiac(extra)
    body: dict[str, Any] = {
        **fields,
        "chart_name": birth.name,
        "datetime": birth.datetime_text,
        "location": birth.place,
        "house_system": house_system,
        "output": FULL_OUTPUT,
    }
    if recalc_id:
        body.update(recalc=True, chart_id=recalc_id)
    return normalise(eph.post("/calculate", body), sidereal=sidereal)


def at_moment(
    eph: Ephemeral,
    name: str,
    utc_iso: str,
    lat: float,
    lon: float,
    house_system: str,
    extra: dict[str, Any] | None = None,
    place: str = "",
    coordinates: bool = True,
) -> Chart:
    """Calculate for an exact UTC moment. The moment carries its offset, so no time-zone lookup
    is involved. The place is sent by name when there is one, since an ephemeralREST without
    Google geocoding only knows places in its cities database; the coordinates are the
    fallback (they work where geocoding accepts them)."""
    moment = utc_iso.replace("Z", "+00:00")
    if not re.search(r"[+-]\d\d:\d\d$", moment):
        moment += "+00:00"
    fields, sidereal = split_zodiac(extra)
    wheres = [w for w in (place.strip(), f"{lat:.6f}, {lon:.6f}" if coordinates else "") if w]
    for i, where in enumerate(wheres):
        try:
            data = eph.post(
                "/calculate",
                {
                    **fields,
                    "chart_name": name,
                    "datetime": moment,
                    "location": where,
                    "house_system": house_system,
                    "output": FULL_OUTPUT,
                },
            )
        except ProblemError as error:
            if error.slug != "ephemeral-rejected" or i == len(wheres) - 1:
                raise
            continue
        return normalise(data, sidereal=sidereal)
    raise AssertionError("unreachable")


def load(eph: Ephemeral, chart_id: str, house_system: str, extra: dict[str, Any] | None = None) -> Chart:
    """A saved chart, in the house system wanted. A different house system is worked out
    from the chart's exact moment and place, without touching the saved chart. If ephemeralREST
    can't do that (it can't find the place), the chart comes back in its own house system
    rather than not at all."""
    fields, sidereal = split_zodiac(extra)
    chart = normalise(eph.get(f"/chart/{chart_id}"), chart_id)
    if chart.house_system == house_system and chart.houses is not None and not fields:
        return chart.to_sidereal(sidereal)
    lat, lon = chart.location.get("latitude"), chart.location.get("longitude")
    if not chart.datetime_utc or not isinstance(lat, int | float) or not isinstance(lon, int | float):
        return chart.to_sidereal(sidereal)
    try:
        redone = at_moment(
            eph,
            chart.name,
            chart.datetime_utc,
            lat,
            lon,
            house_system,
            extra,
            place=str(chart.location.get("name") or ""),
        )
    except ProblemError as error:
        if error.slug != "ephemeral-rejected":
            raise
        return chart.to_sidereal(sidereal)
    redone.id = chart.id
    redone.datetime_local = chart.datetime_local
    redone.location = chart.location
    return redone


def save_to_list(eph: Ephemeral, chart_id: str, birth: BirthData, place_name: str) -> None:
    eph.put(
        f"/account/charts/{chart_id}",
        {
            "type": "main",
            "name": birth.name,
            "date": birth.date.isoformat(),
            "time": birth.time_text or None,
            "location": place_name[:200],
        },
    )


def account_list(eph: Ephemeral, kind: str | None = "main") -> list[dict[str, Any]]:
    """Your list in ephemeralREST: main charts by default, `kind="derived"` for derived ones
    (progressions, directions and returns, each with its parent chart), None for both."""
    data = eph.get("/account/charts")
    charts = data.get("charts") if isinstance(data, dict) else None
    entries = [c for c in charts or [] if isinstance(c, dict)]
    return entries if kind is None else [c for c in entries if c.get("type", "main") == kind]


# Derived charts: ephemeralREST calculates and keeps them; these are its endpoints and types.
DERIVED_KINDS: dict[str, tuple[str, str]] = {
    # kind here: (ephemeralREST endpoint, ephemeralREST chart_type)
    "progressed": ("progressions", "secondary_progression"),
    "solar_arc": ("solar-arc", "solar_arc"),
    "solar_return": ("solar-return", "solar_return"),
    "lunar_return": ("lunar-return", "lunar_return"),
}
KIND_OF_TYPE = {chart_type: kind for kind, (_, chart_type) in DERIVED_KINDS.items()}


def save_derived_to_list(
    eph: Ephemeral, derived_id: str, parent_id: str, name: str, when: str | None, place: str
) -> None:
    eph.put(
        f"/account/charts/{derived_id}",
        {
            "type": "derived",
            "parent_uuid": parent_id,
            "name": name[:200],
            "date": when,
            "time": None,
            "location": place[:200] or None,
        },
    )


# ---------------------------------------------------------------------------
# Notes kept here


NOTE_FIELDS = ("folder_id", "tags", "rating", "source", "notes", "time_unknown", "utc_offset", "house_system")


def notes_for(conn: sqlite3.Connection, user_id: str) -> dict[str, dict[str, Any]]:
    rows = conn.execute("SELECT * FROM chart_notes WHERE user_id = ?", (user_id,)).fetchall()
    return {row["chart_id"]: _note(row) for row in rows}


def note(conn: sqlite3.Connection, user_id: str, chart_id: str) -> dict[str, Any]:
    row = conn.execute(
        "SELECT * FROM chart_notes WHERE user_id = ? AND chart_id = ?", (user_id, chart_id)
    ).fetchone()
    return _note(row) if row else empty_note()


def empty_note() -> dict[str, Any]:
    return {
        "folder_id": None,
        "tags": [],
        "rating": "",
        "source": "",
        "notes": "",
        "time_unknown": False,
        "utc_offset": "",
        "house_system": "",
    }


def _note(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "folder_id": row["folder_id"],
        "tags": json.loads(row["tags"]),
        "rating": row["rating"],
        "source": row["source"],
        "notes": row["notes"],
        "time_unknown": bool(row["time_unknown"]),
        "utc_offset": row["utc_offset"],
        "house_system": row["house_system"],
    }


def save_note(conn: sqlite3.Connection, user_id: str, chart_id: str, values: dict[str, Any]) -> None:
    if (
        values.get("folder_id")
        and not conn.execute(
            "SELECT 1 FROM folders WHERE id = ? AND user_id = ?", (values["folder_id"], user_id)
        ).fetchone()
    ):
        raise ProblemError(422, "unknown-folder", "That folder doesn't exist", None)
    merged = {**note(conn, user_id, chart_id), **values}
    moment = now()
    conn.execute(
        "INSERT INTO chart_notes (user_id, chart_id, folder_id, tags, rating, source, notes, time_unknown,"
        " utc_offset, house_system, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
        " ON CONFLICT (user_id, chart_id) DO UPDATE SET folder_id = excluded.folder_id, tags = excluded.tags,"
        " rating = excluded.rating, source = excluded.source, notes = excluded.notes,"
        " time_unknown = excluded.time_unknown, utc_offset = excluded.utc_offset,"
        " house_system = excluded.house_system, updated_at = excluded.updated_at",
        (
            user_id,
            chart_id,
            merged["folder_id"],
            json.dumps(merged["tags"]),
            merged["rating"],
            merged["source"],
            merged["notes"],
            int(bool(merged["time_unknown"])),
            merged["utc_offset"],
            merged["house_system"] if merged["house_system"] in HOUSE_SYSTEMS else "",
            moment,
            moment,
        ),
    )


def forget_note(conn: sqlite3.Connection, user_id: str, chart_id: str) -> None:
    conn.execute("DELETE FROM chart_notes WHERE user_id = ? AND chart_id = ?", (user_id, chart_id))


def shared_id(value: str) -> str:
    """A chart id from a pasted id or link (the last path segment that looks like a UUID)."""
    found: list[str] = re.findall(
        r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}", value
    )
    if not found:
        raise ProblemError(
            422, "bad-chart-id", "That isn't a chart id or link", "Paste the chart's id or link."
        )
    return found[-1].lower()


def account_entry(eph: Ephemeral, chart_id: str) -> dict[str, Any] | None:
    """This chart's entry in the person's ephemeralREST list, if it's there."""
    return next((c for c in account_list(eph) if str(c.get("uuid")) == chart_id), None)
