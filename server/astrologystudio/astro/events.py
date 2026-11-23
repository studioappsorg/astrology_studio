"""
AstrologyStudio ·
server/astrologystudio/astro/events.py

Event lists:

when a moving body makes an exact aspect to a natal one, and the ephemeris events of a month
(sign ingresses and stations).

Aspects are found by sampling and then narrowing each crossing down by bisection on
the interpolated ephemeris, to well under a minute of time for transits.

Copyright (c) 2026 Gavin Melhuish
MIT License; see LICENSE in the project root.
SPDX-License-Identifier: MIT
"""

from __future__ import annotations

import itertools
from collections.abc import Callable
from datetime import UTC, date, datetime, timedelta
from typing import Any

from .aspects import BY_KEY

Points = dict[str, dict[str, Any]]
_NO_STATIONS = frozenset({"mean_node", "true_node", "south_node", "mean_lilith", "true_lilith"})


def _offset(mover: float, target: float, angle: float) -> float:
    """Signed distance (-180..180) of the mover from the exact aspect point."""
    return (mover - target - angle + 180.0) % 360.0 - 180.0


def _angles(aspect: str) -> list[float]:
    angle = BY_KEY[aspect].angle
    return [angle] if angle in (0.0, 180.0) else [angle, -angle]


def exact_aspects(
    layer: Callable[[datetime], Points],
    targets: Points,
    movers: list[str],
    aspects: list[str],
    start: datetime,
    end: datetime,
    step: timedelta,
    precision: timedelta = timedelta(minutes=1),
) -> list[dict[str, Any]]:
    """Every moment between `start` and `end` when a mover is exactly in aspect to a target."""
    found: list[dict[str, Any]] = []
    previous: Points | None = None
    t0 = start
    while t0 < end:
        t1 = min(t0 + step, end)
        a = previous or layer(t0)
        b = layer(t1)
        for mover in movers:
            if mover not in a or mover not in b:
                continue
            for target, tp in targets.items():
                for aspect in aspects:
                    for angle in _angles(aspect):
                        d0 = _offset(a[mover]["lon"], tp["lon"], angle)
                        d1 = _offset(b[mover]["lon"], tp["lon"], angle)
                        # A real crossing, not the jump from +180 to -180 on the far side.
                        if (d0 == 0 or d0 * d1 < 0) and abs(d0 - d1) < 90:
                            when = _bisect(layer, mover, tp["lon"], angle, t0, t1, d0, precision)
                            at = layer(when)[mover]
                            found.append(
                                {
                                    "at": when.isoformat(),
                                    "mover": mover,
                                    "target": target,
                                    "aspect": aspect,
                                    "retro": bool(at.get("retro")),
                                    "lon": round(at["lon"], 6),
                                }
                            )
        previous = b
        t0 = t1
    found.sort(key=lambda e: e["at"])
    return found


def _bisect(
    layer: Callable[[datetime], Points],
    mover: str,
    target: float,
    angle: float,
    lo: datetime,
    hi: datetime,
    d_lo: float,
    precision: timedelta,
) -> datetime:
    while hi - lo > precision:
        mid = lo + (hi - lo) / 2
        d_mid = _offset(layer(mid)[mover]["lon"], target, angle)
        if d_lo == 0 or d_lo * d_mid <= 0:
            hi = mid
        else:
            lo, d_lo = mid, d_mid
    return lo + (hi - lo) / 2


def month_events(days: dict[str, Points]) -> list[dict[str, Any]]:
    """Sign ingresses and stations between consecutive noons (dated to the day)."""
    ordered = sorted(days)
    events: list[dict[str, Any]] = []
    for first, second in itertools.pairwise(ordered):
        a, b = days[first], days[second]
        for body in a.keys() & b.keys():
            if body in ("moon", "asc", "mc"):
                continue
            sign_a, sign_b = int(a[body]["lon"] // 30), int(b[body]["lon"] // 30)
            if sign_a != sign_b:
                events.append({"date": second, "body": body, "kind": "ingress", "sign": sign_b})
            speed_a, speed_b = a[body].get("speed") or 0.0, b[body].get("speed") or 0.0
            # Node and Lilith (true) wobble back and forth every few days: not stations worth listing.
            if body not in _NO_STATIONS and speed_a * speed_b < 0:
                events.append(
                    {
                        "date": second,
                        "body": body,
                        "kind": "station",
                        "direction": "retrograde" if speed_b < 0 else "direct",
                    }
                )
    events.sort(key=lambda e: e["date"])
    return events


def noon(day: date) -> datetime:
    return datetime(day.year, day.month, day.day, 12, tzinfo=UTC)
