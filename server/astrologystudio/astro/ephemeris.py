"""
AstrologyStudio ·
server/astrologystudio/astro/ephemeris.py

Positions at any moment from ephemeralREST's monthly ephemeris (daily, noon UT).

Transits and secondary progressions are read from here rather than calculated as charts,
because every /calculate call saves a chart in ephemeralREST. Months are cached in this
install's database. Each value is interpolated through the three nearest noons, which
keeps even the Moon within a minute of arc (39" at worst, checked against the Swiss Ephemeris).

With `sidereal` (an ayanamsa key), positions come out sidereal: less that day's ayanamsa from
ephemeralREST's ephemeris, interpolated to the moment. A month cached before ayanamsas were
kept is fetched again the first time it's needed sidereal.

Copyright (c) 2026 Gavin Melhuish
MIT License; see LICENSE in the project root.
SPDX-License-Identifier: MIT
"""

from __future__ import annotations

import json
import sqlite3
from datetime import UTC, date, datetime, timedelta
from typing import Any

from ..db import now, transaction
from ..ephemeral import Ephemeral
from ..errors import ProblemError

FIELDS = ("lon", "lat", "speed", "decl")
FIRST_YEAR, LAST_YEAR = 1800, 2199
_NOON0 = datetime(2000, 1, 1, 12, tzinfo=UTC)


def _compact(day: dict[str, Any]) -> dict[str, dict[str, float]]:
    geo = day.get("geocentric") or day
    out: dict[str, dict[str, float]] = {}
    for name, raw in geo.items():
        if isinstance(raw, dict) and isinstance(raw.get("longitude"), int | float):
            out[name] = {
                "lon": float(raw["longitude"]) % 360.0,
                "lat": float(raw.get("latitude") or 0.0),
                "speed": float(raw["longitude_speed"])
                if isinstance(raw.get("longitude_speed"), int | float)
                else 0.0,
                "decl": float(raw["declination"]) if isinstance(raw.get("declination"), int | float) else 0.0,
            }
    return out


RETRY_AYANAMSAS = timedelta(hours=6)
"""A month that came without ayanamsas is asked for again, for a sidereal profile, after this:
soon enough to pick them up once ephemeralREST has them, without asking an older one each time."""


def _without_ayanamsas(row: sqlite3.Row) -> bool:
    if row["ayanamsas"] is None:  # cached before ayanamsas were kept
        return True
    if row["ayanamsas"] not in ("{}", ""):
        return False
    fetched = datetime.fromisoformat(str(row["fetched_at"]).replace("Z", "+00:00"))
    if fetched.tzinfo is None:
        fetched = fetched.replace(tzinfo=UTC)
    return datetime.now(UTC) - fetched > RETRY_AYANAMSAS


class Ephemeris:
    def __init__(self, eph: Ephemeral, conn: sqlite3.Connection, sidereal: str | None = None) -> None:
        self.eph = eph
        self.conn = conn
        self.sidereal = sidereal
        self._months: dict[tuple[int, int], dict[str, dict[str, dict[str, float]]]] = {}
        self._ayanamsas: dict[tuple[int, int], dict[str, dict[str, float]]] = {}

    def month(self, year: int, month: int) -> dict[str, dict[str, dict[str, float]]]:
        if not FIRST_YEAR <= year <= LAST_YEAR:
            raise ProblemError(422, "out-of-range", "Outside the ephemeris", "Dates from 1800 to 2199 work.")
        key = (year, month)
        if key in self._months:
            return self._months[key]
        row = self.conn.execute(
            "SELECT data, ayanamsas, fetched_at FROM ephemeris_months WHERE year = ? AND month = ?",
            (year, month),
        ).fetchone()
        if row is not None and not (self.sidereal and _without_ayanamsas(row)):
            data: dict[str, dict[str, dict[str, float]]] = json.loads(row["data"])
            self._ayanamsas[key] = json.loads(row["ayanamsas"] or "{}")
        else:
            from ..charts import FULL_OUTPUT

            output = {**FULL_OUTPUT, "heliocentric": False}
            raw = self.eph.post("/ephemeris", {"year": year, "month": month, "output": output})
            days = raw.get("days") if isinstance(raw, dict) else None
            if not isinstance(days, dict) or not days:
                raise ProblemError(502, "ephemeral-error", "ephemeralREST sent no ephemeris", None)
            data = {d: _compact(v) for d, v in days.items() if isinstance(v, dict)}
            raw_ayanamsas = raw.get("ayanamsa")
            ayanamsas = {
                d: {k: float(v) for k, v in values.items() if isinstance(v, int | float)}
                for d, values in (raw_ayanamsas.items() if isinstance(raw_ayanamsas, dict) else [])
                if isinstance(values, dict)
            }
            self._ayanamsas[key] = ayanamsas
            with transaction(self.conn):
                self.conn.execute(
                    "INSERT OR REPLACE INTO ephemeris_months (year, month, data, fetched_at, ayanamsas)"
                    " VALUES (?, ?, ?, ?, ?)",
                    (
                        year,
                        month,
                        json.dumps(data, separators=(",", ":")),
                        now(),
                        json.dumps(ayanamsas, separators=(",", ":")),
                    ),
                )
        self._months[key] = data
        return data

    def ayanamsa_on(self, when: date) -> float | None:
        """The chosen ayanamsa at noon UT on a day; None if tropical or ephemeralREST sent none."""
        if not self.sidereal:
            return None
        self.month(when.year, when.month)
        value = self._ayanamsas.get((when.year, when.month), {}).get(when.isoformat(), {}).get(self.sidereal)
        return float(value) if isinstance(value, int | float) else None

    def ayanamsa_at(self, moment: datetime) -> float | None:
        """The chosen ayanamsa at a moment, between the noons around it (it moves about 0.14"
        a day, so a straight line is exact enough); None if tropical or not available."""
        if not self.sidereal:
            return None
        moment = moment.astimezone(UTC)
        before = _NOON0 + timedelta(days=(moment - _NOON0).total_seconds() // 86400)
        a = self.ayanamsa_on(before.date())
        b = self.ayanamsa_on((before + timedelta(days=1)).date())
        if a is None or b is None:
            return a if b is None else b
        return a + (b - a) * (moment - before).total_seconds() / 86400.0

    def shown_month(self, year: int, month: int) -> dict[str, dict[str, dict[str, float]]]:
        """month(), sidereal day by day when it's sidereal (a copy: the cache stays tropical)."""
        data = self.month(year, month)
        if not self.sidereal:
            return data
        out: dict[str, dict[str, dict[str, float]]] = {}
        for day_text, bodies in data.items():
            amount = self.ayanamsa_on(date.fromisoformat(day_text))
            out[day_text] = (
                {k: {**p, "lon": (p["lon"] - amount) % 360.0} for k, p in bodies.items()}
                if amount is not None
                else bodies
            )
        return out

    def day(self, when: date) -> dict[str, dict[str, float]]:
        return self.month(when.year, when.month).get(when.isoformat(), {})

    def at(self, moment: datetime) -> dict[str, dict[str, Any]]:
        """Every body's position at `moment`, interpolated from the noons around it."""
        moment = moment.astimezone(UTC)
        # The noon (UT) nearest the moment is the middle of the three samples.
        offset = (moment - _NOON0).total_seconds() / 86400.0
        centre = _NOON0 + timedelta(days=round(offset))
        samples = [self.day((centre + timedelta(days=k)).date()) for k in (-1, 0, 1)]
        x = (moment - centre).total_seconds() / 86400.0  # days from the middle noon, -0.5..0.5
        out: dict[str, dict[str, Any]] = {}
        for name in samples[1]:
            if not all(name in s for s in samples):
                continue
            values: dict[str, Any] = {}
            for f in FIELDS:
                y0, y1, y2 = (s[name][f] for s in samples)
                if f == "lon":  # unwrap across 0° Aries
                    y0 = y1 + ((y0 - y1 + 180.0) % 360.0 - 180.0)
                    y2 = y1 + ((y2 - y1 + 180.0) % 360.0 - 180.0)
                # Lagrange through (-1, y0), (0, y1), (1, y2)
                values[f] = y1 + x * (y2 - y0) / 2.0 + x * x * (y2 - 2 * y1 + y0) / 2.0
            values["lon"] %= 360.0
            values["retro"] = values["speed"] < 0
            values["ra"] = None
            out[name] = values
        amount = self.ayanamsa_at(moment)
        if amount is not None:
            for values in out.values():
                values["lon"] = (values["lon"] - amount) % 360.0
        if "mean_node" in out and "south_node" not in out:
            out["south_node"] = {**out["mean_node"], "lon": (out["mean_node"]["lon"] + 180.0) % 360.0}
        return out
