"""
AstrologyStudio ·
server/astrologystudio/astro/aspects.py

Aspects between points, with orbs, and whether each is applying or separating.

Copyright (c) 2026 Gavin Melhuish
MIT License; see LICENSE in the project root.
SPDX-License-Identifier: MIT
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Final


@dataclass(frozen=True, slots=True)
class AspectType:
    key: str
    name: str
    angle: float
    glyph: str
    orb: float
    """Default orb in degrees."""
    major: bool
    on: bool
    """On by default."""
    kind: str
    """'hard', 'soft' or 'neutral': used for colouring."""


ASPECTS: Final[tuple[AspectType, ...]] = (
    AspectType("conjunction", "Conjunction", 0.0, "☌", 8.0, True, True, "neutral"),
    AspectType("opposition", "Opposition", 180.0, "☍", 8.0, True, True, "hard"),
    AspectType("trine", "Trine", 120.0, "△", 7.0, True, True, "soft"),
    AspectType("square", "Square", 90.0, "□", 7.0, True, True, "hard"),
    AspectType("sextile", "Sextile", 60.0, "⚹", 5.0, True, True, "soft"),
    AspectType("quincunx", "Quincunx", 150.0, "⚻", 3.0, False, True, "neutral"),
    AspectType("semisquare", "Semi-square", 45.0, "∠", 2.0, False, True, "hard"),
    AspectType("sesquiquadrate", "Sesquiquadrate", 135.0, "⚼", 2.0, False, True, "hard"),
    AspectType("semisextile", "Semi-sextile", 30.0, "⚺", 2.0, False, False, "soft"),
    AspectType("quintile", "Quintile", 72.0, "Q", 1.5, False, False, "soft"),
    AspectType("biquintile", "Biquintile", 144.0, "bQ", 1.5, False, False, "soft"),
)
BY_KEY: Final = {a.key: a for a in ASPECTS}


def default_settings() -> dict[str, dict[str, Any]]:
    return {a.key: {"on": a.on, "orb": a.orb} for a in ASPECTS}


def separation(a: float, b: float) -> float:
    """The shorter angular distance between two longitudes, 0-180."""
    d = abs((a - b) % 360.0)
    return 360.0 - d if d > 180.0 else d


@dataclass(frozen=True, slots=True)
class Found:
    a: str
    b: str
    aspect: str
    orb: float
    """How far from exact, in degrees (always positive)."""
    applying: bool | None
    """None when either speed is unknown."""

    def as_dict(self) -> dict[str, Any]:
        return {
            "a": self.a,
            "b": self.b,
            "aspect": self.aspect,
            "orb": round(self.orb, 4),
            "applying": self.applying,
        }


def _applying(
    lon_a: float, speed_a: float | None, lon_b: float, speed_b: float | None, angle: float
) -> bool | None:
    if speed_a is None or speed_b is None:
        return None
    now = abs(separation(lon_a, lon_b) - angle)
    step = 1.0 / 24.0  # an hour later
    later = abs(separation(lon_a + speed_a * step, lon_b + speed_b * step) - angle)
    return later < now


def find(
    first: dict[str, dict[str, Any]],
    settings: dict[str, dict[str, Any]],
    second: dict[str, dict[str, Any]] | None = None,
    orb_factor: float = 1.0,
) -> list[Found]:
    """Aspects within one set of points, or between two (`second`, e.g. transits to natal).

    Points are `{"lon": float, "speed": float | None}`. Only the closest aspect is kept
    for each pair. `orb_factor` narrows orbs, e.g. 0.5 for transits.
    """
    active = [
        (BY_KEY[key], float(value.get("orb", BY_KEY[key].orb)) * orb_factor)
        for key, value in settings.items()
        if key in BY_KEY and value.get("on")
    ]
    names_a = list(first)
    pairs: list[tuple[str, str]]
    if second is None:
        pairs = [(x, y) for i, x in enumerate(names_a) for y in names_a[i + 1 :]]
        other = first
    else:
        pairs = [(x, y) for x in names_a for y in second]
        other = second
    found = []
    for x, y in pairs:
        px, py = first[x], other[y]
        gap = separation(px["lon"], py["lon"])
        best: tuple[float, AspectType] | None = None
        for aspect, orb in active:
            off = abs(gap - aspect.angle)
            if off <= orb and (best is None or off < best[0]):
                best = (off, aspect)
        if best is not None:
            off, aspect = best
            found.append(
                Found(
                    x,
                    y,
                    aspect.key,
                    off,
                    _applying(px["lon"], px.get("speed"), py["lon"], py.get("speed"), aspect.angle),
                )
            )
    found.sort(key=lambda f: f.orb)
    return found
