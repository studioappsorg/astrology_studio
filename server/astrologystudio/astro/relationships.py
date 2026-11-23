"""
AstrologyStudio ·
server/astrologystudio/astro/relationships.py

Composite (midpoint) charts and the Davison time-and-space midpoint.

Copyright (c) 2026 Gavin Melhuish
MIT License; see LICENSE in the project root.
SPDX-License-Identifier: MIT
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from .midpoints import midpoint


def composite_points(a: dict[str, dict[str, Any]], b: dict[str, dict[str, Any]]) -> dict[str, dict[str, Any]]:
    """Each body at the nearer midpoint of its two natal positions."""
    out = {}
    for key in a.keys() & b.keys():
        pa, pb = a[key], b[key]
        speeds = [s for s in (pa.get("speed"), pb.get("speed")) if isinstance(s, int | float)]
        out[key] = {
            "lon": midpoint(pa["lon"], pb["lon"]),
            "lat": (float(pa.get("lat") or 0) + float(pb.get("lat") or 0)) / 2.0,
            "speed": sum(speeds) / len(speeds) if len(speeds) == 2 else None,
            "decl": None,
            "ra": None,
            "retro": False,
        }
    return out


def composite_houses(a: list[float] | None, b: list[float] | None) -> list[float] | None:
    """Cusp by cusp midpoints, keeping the houses in zodiac order (the cusps' nearer midpoints
    can land opposite the Ascendant's; then all twelve are turned to match it)."""
    if not a or not b:
        return None
    cusps = [midpoint(x, y) for x, y in zip(a, b, strict=True)]
    # The ASC midpoint should be followed by the IC side, i.e. cusp 4 about 90° later.
    if (cusps[3] - cusps[0]) % 360.0 > 180.0:
        cusps = [(c + 180.0) % 360.0 for c in cusps]
    return cusps


def davison_moment(a: datetime, b: datetime) -> datetime:
    return a + (b - a) / 2


def davison_place(lat_a: float, lon_a: float, lat_b: float, lon_b: float) -> tuple[float, float]:
    """Halfway in latitude, and halfway along the shorter way round in longitude."""
    d = (lon_b - lon_a) % 360.0
    if d > 180.0:
        d -= 360.0
    lon = lon_a + d / 2.0
    lon = (lon + 180.0) % 360.0 - 180.0
    return (lat_a + lat_b) / 2.0, lon
