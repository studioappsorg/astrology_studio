"""
AstrologyStudio ·
server/astrologystudio/astro/midpoints.py

Midpoints and the dial:

midpoint sort, midpoint trees and midpoint search.

On a dial of modulus m (90°, 120° or 360°), two positions are on the same axis when their
longitudes agree modulo m. On the 90° dial that means conjunction, square or opposition;
`include_half` adds the far end of the pointer (m/2), which on the 90° dial is the
semi-square and sesquiquadrate, as in Ebertin's structural pictures.

Copyright (c) 2026 Gavin Melhuish
MIT License; see LICENSE in the project root.
SPDX-License-Identifier: MIT
"""

from __future__ import annotations

from dataclasses import dataclass
from itertools import combinations
from typing import Any, Final

MODULI: Final = (90.0, 120.0, 360.0)
"""The dials offered first. Any size that divides 360 evenly works (see appearance.valid_modulus)."""


def midpoint(a: float, b: float) -> float:
    """The nearer midpoint, on the shorter arc between two longitudes."""
    d = (b - a) % 360.0
    if d > 180.0:
        d -= 360.0
    return (a + d / 2.0) % 360.0


def dial_distance(a: float, b: float, modulus: float, include_half: bool = False) -> float:
    """How far apart two longitudes are on a dial: 0 when on the same axis."""
    d = (a - b) % modulus
    d = min(d, modulus - d)
    if include_half:
        d = min(d, abs(d - modulus / 2.0))
    return d


@dataclass(frozen=True, slots=True)
class Midpoint:
    a: str
    b: str
    lon: float

    def as_dict(self, modulus: float) -> dict[str, Any]:
        return {"a": self.a, "b": self.b, "lon": round(self.lon, 6), "dial": round(self.lon % modulus, 6)}


def all_midpoints(points: dict[str, float]) -> list[Midpoint]:
    return [Midpoint(a, b, midpoint(points[a], points[b])) for a, b in combinations(points, 2)]


def sort(points: dict[str, float], modulus: float = 90.0) -> list[dict[str, Any]]:
    """Every factor and every midpoint in dial order (the 90° midpoint sort)."""
    rows: list[dict[str, Any]] = [
        {"a": k, "b": None, "lon": round(v, 6), "dial": round(v % modulus, 6)} for k, v in points.items()
    ]
    rows += [m.as_dict(modulus) for m in all_midpoints(points)]
    rows.sort(key=lambda r: (r["dial"], r["b"] is not None))
    return rows


def near(
    points: dict[str, float],
    target: float,
    orb: float,
    modulus: float = 90.0,
    include_half: bool = True,
    exclude: str | None = None,
) -> list[dict[str, Any]]:
    """Midpoints (and single factors) on the axis of `target`, closest first. A tree for a
    factor is `near(points, points[factor], ..., exclude=factor)`."""
    found: list[dict[str, Any]] = []
    for k, v in points.items():
        if k == exclude:
            continue
        d = dial_distance(v, target, modulus, include_half)
        if d <= orb:
            found.append({"a": k, "b": None, "lon": round(v, 6), "orb": round(d, 6)})
    for m in all_midpoints(points):
        if exclude in (m.a, m.b):
            continue
        d = dial_distance(m.lon, target, modulus, include_half)
        if d <= orb:
            found.append({"a": m.a, "b": m.b, "lon": round(m.lon, 6), "orb": round(d, 6)})
    found.sort(key=lambda r: r["orb"])
    return found
