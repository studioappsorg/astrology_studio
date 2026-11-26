"""
AstrologyStudio ·
server/astrologystudio/astro/zodiac.py

Zodiac choices. ephemeralREST always calculates tropical positions, and since its ayanamsa
release returns four ayanamsas with every calculation (and every day of its ephemeris). A
sidereal chart is the tropical one less the chosen ayanamsa:

    sidereal longitude = (tropical longitude - ayanamsa) mod 360

The ayanamsas are true ones (with nutation), matching ephemeralREST's apparent positions, so
this gives exactly what the Swiss Ephemeris gives in sidereal mode. House cusps shift the same
way, except whole sign houses, which start at the sign of the sidereal Ascendant.

An ephemeralREST from before then sends no ayanamsas: charts stay tropical and say so
(`sidereal_pending`).

Copyright (c) 2026 Gavin Melhuish
MIT License; see LICENSE in the project root.
SPDX-License-Identifier: MIT
"""

from __future__ import annotations

from typing import Any, Final

AYANAMSAS: Final[dict[str, str]] = {
    "lahiri": "Lahiri",
    "krishnamurti": "Krishnamurti (KP)",
    "fagan_bradley": "Fagan-Bradley",
    "raman": "B.V. Raman",
}

SIDEREAL_SUPPORTED: Final = True
"""AstrologyStudio converts to sidereal itself, from the ayanamsas ephemeralREST returns."""

SIDEREAL = "sidereal"
"""The key `selection()` puts the ayanamsa under. Never sent to ephemeralREST."""


def selection(zodiac: str, ayanamsa: str) -> dict[str, Any]:
    """What a chart request carries for the zodiac: `{"sidereal": "lahiri"}`, or nothing for
    tropical. It's taken off before anything goes to ephemeralREST (see charts.split_zodiac)."""
    if zodiac == "sidereal" and ayanamsa in AYANAMSAS:
        return {SIDEREAL: ayanamsa}
    return {}


def value(ayanamsas: Any, key: str | None) -> float | None:
    """One ayanamsa, in degrees, from an ephemeralREST `ayanamsa` object; None if it isn't there."""
    if not key or not isinstance(ayanamsas, dict):
        return None
    found = ayanamsas.get(key)
    return float(found) if isinstance(found, int | float) else None


def shift(points: dict[str, dict[str, Any]], amount: float) -> None:
    """Take `amount` degrees off every point's longitude, in place."""
    for point in points.values():
        if isinstance(point, dict) and isinstance(point.get("lon"), int | float):
            point["lon"] = (float(point["lon"]) - amount) % 360.0


def whole_sign_cusps(asc: float) -> list[float]:
    """Whole sign houses: the first starts at 0° of the Ascendant's sign."""
    first = (asc // 30.0) * 30.0
    return [(first + 30.0 * i) % 360.0 for i in range(12)]
