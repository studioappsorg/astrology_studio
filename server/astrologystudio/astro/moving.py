"""
AstrologyStudio ·
server/astrologystudio/astro/moving.py

Transits, secondary progressions and solar arc directions for a natal chart.

Copyright (c) 2026 Gavin Melhuish
MIT License; see LICENSE in the project root.
SPDX-License-Identifier: MIT
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

from . import angles
from .ephemeris import Ephemeris

YEAR = 365.2422
LAYERS = ("transits", "progressions", "solar_arc")
LABELS = {"transits": "Transits", "progressions": "Progressions", "solar_arc": "Solar arc"}
ANGLE_KEYS = ("asc", "mc")


def parse_utc(text: str) -> datetime:
    moment = datetime.fromisoformat(text.replace("Z", "+00:00"))
    return moment.replace(tzinfo=UTC) if moment.tzinfo is None else moment.astimezone(UTC)


def _angle_point(lon: float) -> dict[str, Any]:
    return {"lon": lon % 360.0, "lat": 0.0, "speed": None, "decl": None, "ra": None, "retro": False}


def transits(
    ephemeris: Ephemeris, at: datetime, latitude: float | None, longitude: float | None
) -> dict[str, Any]:
    points = ephemeris.at(at)
    if latitude is not None and longitude is not None:
        shift = ephemeris.ayanamsa_at(at) or 0.0  # the angles are worked out tropical here
        for key, lon in angles.angles(at, latitude, longitude).items():
            points[key] = _angle_point(lon - shift)
    return {"points": points}


def progressed_moment(natal: datetime, at: datetime) -> datetime:
    """Day for a year: each year of life after birth is one day of planetary motion."""
    return natal + timedelta(days=(at - natal).total_seconds() / 86400.0 / YEAR)


def progressions(
    ephemeris: Ephemeris,
    natal_points: dict[str, dict[str, Any]],
    natal: datetime,
    at: datetime,
    latitude: float | None,
) -> dict[str, Any]:
    moment = progressed_moment(natal, at)
    points = ephemeris.at(moment)
    arc = _arc(points, natal_points)
    # Progressed angles by solar arc in longitude on the MC, and the Ascendant that goes with it.
    if "mc" in natal_points and arc is not None:
        mc = (natal_points["mc"]["lon"] + arc) % 360.0
        points["mc"] = _angle_point(mc)
        if latitude is not None:
            # The Ascendant comes from the MC through the equator, so in tropical terms: a
            # sidereal MC goes back by the ayanamsa first, and the Ascendant comes back by it.
            shift = ephemeris.ayanamsa_at(moment) or 0.0
            eps = angles.obliquity(angles.julian_day(moment))
            tropical_mc = (mc + shift) % 360.0
            points["asc"] = _angle_point(
                angles.asc_from_ramc(angles.ramc_from_mc(tropical_mc, eps), eps, latitude) - shift
            )
    return {"points": points, "moment": moment.isoformat(), "arc": arc}


def _arc(progressed: dict[str, dict[str, Any]], natal_points: dict[str, dict[str, Any]]) -> float | None:
    if "sun" not in progressed or "sun" not in natal_points:
        return None
    return float(progressed["sun"]["lon"] - natal_points["sun"]["lon"]) % 360.0


def solar_arc(
    ephemeris: Ephemeris, natal_points: dict[str, dict[str, Any]], natal: datetime, at: datetime
) -> dict[str, Any]:
    """Every natal point moved by the same arc: progressed Sun minus natal Sun."""
    progressed = ephemeris.at(progressed_moment(natal, at))
    arc = _arc(progressed, natal_points)
    if arc is None:
        return {"points": {}, "arc": None}
    rate = progressed["sun"]["speed"] / YEAR  # degrees per day of real time
    points = {
        key: {**p, "lon": (p["lon"] + arc) % 360.0, "speed": rate, "retro": False}
        for key, p in natal_points.items()
    }
    return {"points": points, "arc": arc}


def fixed(points: dict[str, dict[str, Any]]) -> dict[str, dict[str, Any]]:
    """Natal points as targets: they don't move, so applying and separating depend only on the mover."""
    return {k: {**p, "speed": 0.0} for k, p in points.items()}


def tight(settings: dict[str, dict[str, Any]], max_orb: float) -> dict[str, dict[str, Any]]:
    """The profile's aspects with each orb capped for moving charts."""
    return {k: {**v, "orb": min(float(v.get("orb", 0)), max_orb)} for k, v in settings.items()}
