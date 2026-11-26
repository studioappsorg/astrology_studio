"""
AstrologyStudio ·
server/astrologystudio/api/ephemeris.py

/api/v1/ephemeris:

a month of daily positions, with ingresses, stations, lunations and eclipses.

Copyright (c) 2026 Gavin Melhuish
MIT License; see LICENSE in the project root.
SPDX-License-Identifier: MIT
"""

from __future__ import annotations

import calendar
import contextlib
from datetime import date
from typing import Annotated, Any

from fastapi import APIRouter, Query

from .. import preferences as prefs
from ..astro import events, zodiac
from ..astro.ephemeris import Ephemeris
from ..deps import Db, Eph, UserPrincipal
from ..errors import ProblemError

router = APIRouter(prefix="/ephemeris", tags=["Ephemeris"])


@router.get("", summary="A month's ephemeris and events")
def month(
    conn: Db,
    eph: Eph,
    person: UserPrincipal,
    year: Annotated[int, Query(ge=1800, le=2199)],
    month: Annotated[int, Query(ge=1, le=12)],
) -> dict[str, Any]:
    """In the active profile's zodiac: sidereal days, ingresses and lunations when it's sidereal."""
    profile = prefs.active_profile(conn, person.id)
    sidereal = zodiac.selection(profile["zodiac"], profile["ayanamsa"]).get(zodiac.SIDEREAL)
    source = Ephemeris(eph, conn, sidereal)
    days = source.shown_month(year, month)
    # The last day of the previous month, so an ingress or station on the 1st is found.
    prev_y, prev_m = (year - 1, 12) if month == 1 else (year, month - 1)
    prev_last = f"{prev_y:04d}-{prev_m:02d}-{calendar.monthrange(prev_y, prev_m)[1]:02d}"
    span = dict(days)
    with contextlib.suppress(ProblemError, KeyError):
        span[prev_last] = source.shown_month(prev_y, prev_m)[prev_last]
    start = f"{year:04d}-{month:02d}-01"
    end = f"{year:04d}-{month:02d}-{calendar.monthrange(year, month)[1]:02d}"
    lunations = eph.post("/lunations", {"reference_date": start, "start_date": start, "end_date": end})
    eclipses = eph.post("/eclipses", {"reference_date": start, "years_ahead": 1})
    in_month = [
        e
        for e in (eclipses.get("eclipses") or [] if isinstance(eclipses, dict) else [])
        if isinstance(e, dict) and str(e.get("datetime_utc", "")).startswith(start[:7])
    ]
    found_lunations = lunations.get("lunations", []) if isinstance(lunations, dict) else []
    shown_sidereal = sidereal is not None and source.ayanamsa_on(date(year, month, 1)) is not None
    if shown_sidereal:
        for lunation in found_lunations:
            amount = zodiac.value(lunation.get("ayanamsa") if isinstance(lunation, dict) else None, sidereal)
            if amount is None:
                continue
            for key in ("sun_longitude", "moon_longitude"):
                if isinstance(lunation.get(key), int | float):
                    lunation[key] = (float(lunation[key]) - amount) % 360.0
    return {
        "year": year,
        "month": month,
        "days": days,
        "events": [e for e in events.month_events(span) if e["date"] >= start],
        "lunations": found_lunations,
        "eclipses": in_month,
        "zodiac": {
            "type": "sidereal" if shown_sidereal else "tropical",
            "ayanamsa": sidereal if shown_sidereal else None,
        },
        "sidereal_pending": sidereal is not None and not shown_sidereal,
    }
