"""
AstrologyStudio ·
server/astrologystudio/astro/angles.py

Ascendant and Midheaven from a moment and a place, worked out here so moving charts
(transits, directions) need no saved chart in ephemeralREST. Accurate to about a minute
of arc, which is far finer than a wheel shows and well inside any orb.

Copyright (c) 2026 Gavin Melhuish
MIT License; see LICENSE in the project root.
SPDX-License-Identifier: MIT
"""

from __future__ import annotations

import math
from datetime import UTC, datetime


def julian_day(moment: datetime) -> float:
    moment = moment.astimezone(UTC)
    return moment.timestamp() / 86400.0 + 2440587.5


def obliquity(jd: float) -> float:
    t = (jd - 2451545.0) / 36525.0
    return 23.439291 - 0.0130042 * t


def ramc(jd: float, east_longitude: float) -> float:
    """Right ascension of the Midheaven (local sidereal time) in degrees."""
    t = (jd - 2451545.0) / 36525.0
    gmst = 280.46061837 + 360.98564736629 * (jd - 2451545.0) + 0.000387933 * t * t - t**3 / 38710000.0
    return (gmst + east_longitude) % 360.0


def mc_from_ramc(ramc_deg: float, eps_deg: float) -> float:
    r, e = math.radians(ramc_deg), math.radians(eps_deg)
    return math.degrees(math.atan2(math.sin(r), math.cos(r) * math.cos(e))) % 360.0


def asc_from_ramc(ramc_deg: float, eps_deg: float, latitude: float) -> float:
    r, e, phi = math.radians(ramc_deg), math.radians(eps_deg), math.radians(latitude)
    return (
        math.degrees(math.atan2(math.cos(r), -(math.sin(r) * math.cos(e) + math.tan(phi) * math.sin(e))))
        % 360.0
    )


def ramc_from_mc(mc_deg: float, eps_deg: float) -> float:
    m, e = math.radians(mc_deg), math.radians(eps_deg)
    return math.degrees(math.atan2(math.sin(m) * math.cos(e), math.cos(m))) % 360.0


def angles(moment: datetime, latitude: float, east_longitude: float) -> dict[str, float]:
    jd = julian_day(moment)
    eps = obliquity(jd)
    r = ramc(jd, east_longitude)
    return {"asc": asc_from_ramc(r, eps, latitude), "mc": mc_from_ramc(r, eps)}
