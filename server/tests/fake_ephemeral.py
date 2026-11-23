"""
AstrologyStudio ·
server/tests/fake_ephemeral.py

A stand-in ephemeralREST for tests:

just enough of its API, in memory.

Positions are simple deterministic numbers, not astronomy: tests check plumbing
and arithmetic, not the Swiss Ephemeris.

Copyright (c) 2026 Gavin Melhuish
MIT License; see LICENSE in the project root.
SPDX-License-Identifier: MIT
"""

from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime, timedelta, timezone
from typing import Any

import httpx

GOOD_KEY = "eph_test_key_123456"
PLACES = {
    "Perth WA, Australia": (-31.95, 115.86, 8),
    "London, UK": (51.51, -0.13, 0),
}
BODIES = [
    "sun",
    "moon",
    "mercury",
    "venus",
    "mars",
    "jupiter",
    "saturn",
    "uranus",
    "neptune",
    "pluto",
    "chiron",
    "ceres",
    "pallas",
    "juno",
    "vesta",
    "mean_node",
    "true_node",
    "mean_lilith",
]


def positions_for(moment: datetime) -> dict[str, dict[str, Any]]:
    """Each body moves at its own steady rate from a fixed start."""
    days = (moment - datetime(2000, 1, 1, tzinfo=UTC)).total_seconds() / 86400
    out = {}
    for i, name in enumerate(BODIES):
        speed = 13.2 if name == "moon" else 1.0 / (i + 1)
        out[name] = {
            "longitude": (i * 23.0 + days * speed) % 360,
            "latitude": 0.5,
            "longitude_speed": speed,
            "declination": 1.0,
            "right_ascension": 10.0,
            "retrograde": False,
        }
    return out


class FakeEphemeral:
    def __init__(self) -> None:
        self.calls: list[tuple[str, str]] = []
        self.bodies: list[Any] = []
        self.charts: dict[str, dict[str, Any]] = {}
        self.account: dict[str, dict[str, Any]] = {}
        self.derived: dict[str, dict[str, Any]] = {}
        self.cities_only = False
        # Registration and login, like ephemeralREST: email -> account. The verification and
        # set-password links (on the ephemeralADMIN portal) are stood in for by verify().
        self.registered: dict[str, dict[str, Any]] = {}
        self.codes: dict[str, str] = {}
        self.devices: dict[str, str] = {}
        """Like an ephemeralREST without Google geocoding: places by name only, no coordinates."""

    @property
    def transport(self) -> httpx.MockTransport:
        return httpx.MockTransport(self.handle)

    def handle(self, request: httpx.Request) -> httpx.Response:
        path = request.url.path
        self.calls.append((request.method, path))
        body = json.loads(request.content) if request.content else None
        self.bodies.append(body)
        if path == "/ping":
            return httpx.Response(200, json={"status": "ok"})
        if path == "/autocomplete":
            q = request.url.params.get("q", "").lower()
            return httpx.Response(
                200,
                json={"predictions": [{"description": p, "place_id": p} for p in PLACES if q in p.lower()]},
            )
        if path == "/register" and request.method == "POST":
            email = body["email"].strip().lower()
            self.registered.setdefault(email, {"name": body["name"], "verified": False, "password": None})
            return httpx.Response(201, json={"message": "Verification email sent.", "email": email})
        if path == "/login" and request.method == "POST":
            return self.login(body)
        if path == "/login/2fa" and request.method == "POST":
            email = body["email"].strip().lower()
            if self.codes.get(email) != body["code"]:
                return self.error(401, "Invalid or expired verification code")
            del self.codes[email]
            return httpx.Response(200, json=self.identity(email, remember=bool(body.get("remember_device"))))
        if path.startswith("/chart/") and request.method == "GET" and path.count("/") == 2:
            chart = self.charts.get(path.split("/")[2])
            return httpx.Response(200, json=chart) if chart else self.error(404, "Chart not found")
        if request.headers.get("X-API-Key") != GOOD_KEY:
            return self.error(401, "Invalid or missing API key")
        if path == "/me":
            return httpx.Response(
                200, json={"id": "7", "name": "Test Person", "identifier": "test@example.com"}
            )
        if path == "/calculate":
            return self.calculate(body)
        if path == "/account/charts":
            items = sorted(self.account.values(), key=lambda c: c["updated_at"], reverse=True)
            return httpx.Response(200, json={"charts": items})
        if path == "/ephemeris":
            return self.ephemeris(body)
        if path == "/lunations":
            return httpx.Response(
                200,
                json={
                    "mode": "range",
                    "lunations": [
                        {
                            "phase": "full_moon",
                            "datetime_utc": body["start_date"] + "T10:00:00",
                            "moon_longitude": 55.0,
                        }
                    ],
                },
            )
        if path == "/eclipses":
            return httpx.Response(
                200,
                json={
                    "eclipses": [
                        {"type": "lunar", "eclipse_type": "total", "datetime_utc": "2026-03-03T11:33:00"}
                    ]
                },
            )
        if path.startswith("/account/charts/"):
            chart_id = path.rsplit("/", 1)[1]
            if request.method == "PUT":
                self.account[chart_id] = {
                    "uuid": chart_id,
                    **body,
                    "parent_uuid": body.get("parent_uuid"),
                    "updated_at": datetime.now(UTC).isoformat(),
                }
            else:
                self.account.pop(chart_id, None)
            return httpx.Response(200, json={"ok": True})
        return self.dynamic(request, path, body)

    def dynamic(self, request: httpx.Request, path: str, body: Any) -> httpx.Response:
        if path.startswith("/derived/") and request.method == "GET":
            found = self.derived.get(path.rsplit("/", 1)[1])
            return httpx.Response(200, json=found) if found else self.error(404, "Derived chart not found")
        if path.startswith("/chart/") and path.endswith(("/progressions", "/solar-arc")):
            parent_id = path.split("/")[2]
            natal = self.charts.get(parent_id)
            if natal is None:
                return self.error(404, "Chart not found")
            when = body["progression_date"][:10]
            data = self.calculate(
                {
                    "chart_name": "Derived",
                    "datetime": f"{when}T12:00:00+00:00",
                    "location": body.get("location") or natal["location"]["formatted_address"],
                    "house_system": body.get("house_system"),
                }
            ).json()
            kind = "secondary_progression" if path.endswith("/progressions") else "solar_arc"
            label = "Progressions" if kind == "secondary_progression" else "Solar Arc"
            return self.keep_derived(data, parent_id, kind, f"{natal['chart_name']} — {label} {when}", when)
        if path.endswith("-return") and path.startswith("/chart/"):
            natal = self.charts.get(path.split("/")[2])
            if natal is None:
                return self.error(404, "Chart not found")
            month = body.get("return_month", 3)
            moment = datetime(body["return_year"], month, 14, 9, 47, tzinfo=UTC)
            data = self.calculate(
                {
                    "chart_name": "Return",
                    "datetime": moment.isoformat(),
                    "location": body.get("location") or natal["location"]["formatted_address"],
                    "house_system": body.get("house_system"),
                }
            ).json()
            data["return_datetime_utc"] = moment.isoformat()
            kind = "lunar_return" if path.endswith("lunar-return") else "solar_return"
            which = "Lunar" if kind == "lunar_return" else "Solar"
            name = f"{natal['chart_name']} — {which} Return {body['return_year']}"
            return self.keep_derived(data, path.split("/")[2], kind, name, moment.date().isoformat())
        return self.error(404, "Not found")

    def verify(self, email: str, password: str) -> None:
        """What the two emailed links do on the portal: verify the address, then set a password."""
        self.registered[email].update(verified=True, password=password)

    def login(self, body: dict[str, Any]) -> httpx.Response:
        email = body["email"].strip().lower()
        account = self.registered.get(email)
        if not account or not account["verified"] or account["password"] != body["password"]:
            return self.error(401, "Invalid email or password")
        if body.get("device_token") and self.devices.get(body["device_token"]) == email:
            return httpx.Response(200, json=self.identity(email))
        self.codes[email] = "123456"
        return httpx.Response(200, json={"2fa_required": True, "email": email})

    def identity(self, email: str, remember: bool = False) -> dict[str, Any]:
        result: dict[str, Any] = {
            "id": 9,
            "name": self.registered[email]["name"],
            "identifier": email,
            "admin": False,
            "active": True,
            "rate_limits": {},
            "api_key": GOOD_KEY,
        }
        if remember:
            token = f"device-{len(self.devices) + 1}"
            self.devices[token] = email
            result.update(device_token=token, device_token_expires_days=28)
        return result

    def keep_derived(
        self, data: dict[str, Any], parent_id: str, kind: str, name: str, when: str
    ) -> httpx.Response:
        """Like ephemeralREST: a derived chart gets its own id and is kept, linked to its parent."""
        self.charts.pop(data.pop("chart_id"), None)
        derived_id = str(uuid.uuid4())
        data.update(chart_id=parent_id, chart_type=kind, chart_name=name, derived_chart_id=derived_id)
        if kind == "secondary_progression":
            data["progression_date"] = when
        elif kind == "solar_arc":
            data["direction_date"] = when
        self.derived[derived_id] = {**data, "id": derived_id, "reference_date": when}
        return httpx.Response(200, json=data)

    @staticmethod
    def error(status: int, message: str) -> httpx.Response:
        return httpx.Response(status, json={"error": message, "status": status})

    def place(self, text: str) -> tuple[str, float, float, int] | None:
        for name, (lat, lon, hours) in PLACES.items():
            if text.lower().split(",")[0] in name.lower():
                return name, lat, lon, hours
        if self.cities_only:
            return None
        try:
            lat_text, lon_text = text.split(",")
            return text, float(lat_text), float(lon_text), 0
        except ValueError:
            return None

    def calculate(self, body: dict[str, Any]) -> httpx.Response:
        found = self.place(body["location"])
        if found is None:
            return self.error(400, f"Location '{body['location']}' not found in cities database.")
        name, lat, lon, hours = found
        moment = datetime.fromisoformat(body["datetime"].replace(" ", "T"))
        if moment.tzinfo is None:
            moment = moment.replace(tzinfo=timezone(timedelta(hours=hours)))
        utc = moment.astimezone(UTC)
        system = body.get("house_system")
        geo = positions_for(utc)
        asc = (lat + lon + utc.hour * 15) % 360
        geo["asc"] = {"longitude": asc, "latitude": 0}
        geo["mc"] = {"longitude": (asc + 270) % 360, "latitude": 0}
        cusps = {
            "system": system,
            "cusps": {str(i + 1): (asc + i * 30) % 360 for i in range(12)},
            "asc": asc,
            "mc": (asc + 270) % 360,
            "vertex": (asc + 180) % 360,
            "east_point": asc,
        }
        chart_id = body["chart_id"] if body.get("recalc") else str(uuid.uuid4())
        chart = {
            "chart_id": chart_id,
            "chart_name": body["chart_name"],
            "datetime_utc": utc.isoformat(),
            "datetime_local": moment.isoformat(),
            "location": {
                "formatted_address": name,
                "latitude": lat,
                "longitude": lon,
                "timezone": "Etc/Test",
                "utc_offset_seconds": int(moment.utcoffset().total_seconds()),
            },
            "house_cusps": cusps if system else None,
            "planetary_positions": {
                "geocentric": geo,
                "heliocentric": {
                    k: v
                    for k, v in positions_for(utc).items()
                    if k not in ("sun", "moon", "mean_node", "true_node")
                },
            },
        }
        self.charts[chart_id] = chart
        return httpx.Response(200, json=chart)

    def ephemeris(self, body: dict[str, Any]) -> httpx.Response:
        import calendar

        year, month = body["year"], body["month"]
        days = {}
        for d in range(1, calendar.monthrange(year, month)[1] + 1):
            noon = datetime(year, month, d, 12, tzinfo=UTC)
            days[noon.date().isoformat()] = {"geocentric": positions_for(noon)}
        return httpx.Response(200, json={"year": year, "month": month, "days": days})
