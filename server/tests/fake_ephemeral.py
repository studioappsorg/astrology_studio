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
SITE_KEY = "eph_site_key_123456"
"""A domain key, for example.com (and, like the real one, localhost for development)."""
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


# Like ephemeralREST's four ayanamsas: a steady drift of about 50" a year from J2000.
AYANAMSAS_2000 = {"lahiri": 23.857, "krishnamurti": 23.76, "fagan_bradley": 24.74, "raman": 22.41}


def ayanamsas_for(moment: datetime) -> dict[str, float]:
    years = (moment - datetime(2000, 1, 1, 12, tzinfo=UTC)).total_seconds() / 86400 / 365.25
    return {k: round(v + years * 0.013968, 7) for k, v in AYANAMSAS_2000.items()}


class FakeEphemeral:
    def __init__(self) -> None:
        self.with_ayanamsas = True
        """False: like an ephemeralREST from before ayanamsas, which sends none."""
        self.calls: list[tuple[str, str]] = []
        self.bodies: list[Any] = []
        self.charts: dict[str, dict[str, Any]] = {}
        # Each key has its own chart list; GOOD_KEY's is `account`.
        self.lists: dict[str, dict[str, dict[str, Any]]] = {GOOD_KEY: {}}
        self.identities: dict[str, dict[str, Any]] = {
            GOOD_KEY: {"id": "7", "name": "Test Person", "identifier": "test@example.com"}
        }
        self.domain_keys: dict[str, dict[str, Any]] = {SITE_KEY: {"domain": "example.com", "origins": []}}
        self.app_links = True
        """False: like an ephemeralREST from before app links (no registration flags, no links)."""
        self.outbox: list[dict[str, Any]] = []
        """What this ephemeralREST emailed: {"to", "kind", "link" or "code" or "key"}."""
        self.tokens: dict[str, dict[str, Any]] = {}
        self.rotations = 0
        self.derived: dict[str, dict[str, Any]] = {}
        self.cities_only = False
        self.rate_limited = False
        """Answer every call with ephemeralREST's own 429."""
        # Registration and login, like ephemeralREST: email -> account. The verification and
        # set-password links (on the ephemeralADMIN portal) are stood in for by verify().
        self.registered: dict[str, dict[str, Any]] = {}
        self.codes: dict[str, str] = {}
        self.devices: dict[str, str] = {}
        """Like an ephemeralREST without Google geocoding: places by name only, no coordinates."""

    @property
    def account(self) -> dict[str, dict[str, Any]]:
        return self.lists[GOOD_KEY]

    def _token(self, email: str, kind: str) -> str:
        token = f"{kind}-{len(self.tokens) + 1:04d}-{email}"
        self.tokens[token] = {"email": email, "kind": kind, "used": False}
        return token

    def _link(self, links: dict[str, str] | None, kind: str, token: str) -> str:
        if links and links.get(kind):
            return links[kind].replace("{token}", token)
        page = "verify.php" if kind == "verify" else "set-password.php"
        return f"https://portal.example.org/{page}?t={token}"

    def _caller(self, request: httpx.Request) -> tuple[str | None, httpx.Response | None]:
        key = request.headers.get("X-API-Key")
        if key and key not in self.domain_keys and key not in self.lists:
            return None, self.error(401, "Unauthorized")
        return key, None

    def _check_links(self, key: str | None, links: Any) -> httpx.Response | None:
        if not links:
            return None
        if not self.app_links:
            return self.error(400, "Unknown field: links")
        if key is None:
            return self.error(401, "link-needs-domain-key")
        if key not in self.domain_keys:
            return self.error(403, "link-needs-domain-key")
        for template in links.values():
            parts = template.split("/")
            origin = "/".join(parts[:3])
            if origin not in self.domain_keys[key]["origins"]:
                return httpx.Response(
                    422, json={"error": "link-not-allowed", "status": 422, "origin": origin}
                )
        return None

    def new_key_for(self, email: str) -> str:
        key = f"eph_user_{len(self.lists):04d}_{email}"
        self.lists[key] = {}
        self.identities[key] = {
            "id": str(len(self.lists)),
            "name": self.registered[email]["name"],
            "identifier": email,
        }
        self.registered[email]["key"] = key
        return key

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
        if self.rate_limited and path != "/health":
            return self.error(429, "Rate limit exceeded: 10 per minute")
        if path == "/health":
            health: dict[str, Any] = {"status": "healthy"}
            if self.app_links:
                health["registration"] = {
                    "open": True,
                    "app_links": True,
                    "complete": True,
                    "email_delivery": True,
                }
            if self.with_ayanamsas:
                health["ayanamsas"] = list(AYANAMSAS_2000)
            return httpx.Response(200, json=health)
        if (
            path in ("/register", "/register/complete", "/password/forgot", "/password/set")
            and request.method == "POST"
        ):
            return self.signup(request, path, body)
        if path.startswith("/keys/self/"):
            return self.key_settings(request, path, body)
        if path == "/autocomplete":
            q = request.url.params.get("q", "").lower()
            return httpx.Response(
                200,
                json={"predictions": [{"description": p, "place_id": p} for p in PLACES if q in p.lower()]},
            )
        if path == "/login" and request.method == "POST":
            return self.login(body, request.headers.get("X-API-Key"))
        if path == "/login/2fa" and request.method == "POST":
            email = body["email"].strip().lower()
            if self.codes.get(email) != body["code"]:
                return self.error(401, "Invalid or expired verification code")
            del self.codes[email]
            return httpx.Response(200, json=self.identity(email, remember=bool(body.get("remember_device"))))
        if path.startswith("/chart/") and request.method == "GET" and path.count("/") == 2:
            chart = self.charts.get(path.split("/")[2])
            return httpx.Response(200, json=chart) if chart else self.error(404, "Chart not found")
        key = request.headers.get("X-API-Key") or ""
        if key not in self.lists:
            return self.error(401, "Invalid or missing API key")
        if path == "/me":
            return httpx.Response(200, json=self.identities[key])
        if path == "/me/rotate" and request.method == "POST":
            return self.rotate(request, key, body)
        if path == "/calculate":
            return self.calculate(body)
        if path == "/account/charts":
            items = sorted(self.lists[key].values(), key=lambda c: c["updated_at"], reverse=True)
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
                            "sun_longitude": 235.0,
                            **(
                                {
                                    "ayanamsa": ayanamsas_for(
                                        datetime.fromisoformat(body["start_date"] + "T10:00:00+00:00")
                                    )
                                }
                                if self.with_ayanamsas
                                else {}
                            ),
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
            listed = self.lists[key]
            if request.method == "PUT":
                listed[chart_id] = {
                    "uuid": chart_id,
                    **body,
                    "parent_uuid": body.get("parent_uuid"),
                    "updated_at": datetime.now(UTC).isoformat(),
                }
            else:
                listed.pop(chart_id, None)
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
        # Accounts made this way share the test key (and its chart list), as the older tests expect.
        self.registered[email].setdefault("key", GOOD_KEY)

    def signup(self, request: httpx.Request, path: str, body: dict[str, Any]) -> httpx.Response:
        key, problem = self._caller(request)
        if problem:
            return problem
        if path == "/register":
            problem = self._check_links(key, body.get("links"))
            if problem:
                return problem
            email = body["email"].strip().lower()
            if email in self.registered:
                return httpx.Response(200, json={"message": "If this email is not already registered, ..."})
            self.registered[email] = {
                "name": body["name"],
                "verified": False,
                "password": None,
                "home": key if key in self.domain_keys else None,
            }
            token = self._token(email, "verify")
            response: dict[str, Any] = {"message": "Verification email sent.", "email": email}
            if self.delivers(email, key):
                response["deliver"] = {"kind": "verify", "token": token, "expires_at": "2099-01-01T00:00:00Z"}
            else:
                self.outbox.append(
                    {"to": email, "kind": "verify", "link": self._link(body.get("links"), "verify", token)}
                )
            return httpx.Response(201, json=response)
        if path == "/register/complete":
            found = self.tokens.get(body["token"])
            if not found or found["used"] or found["kind"] != "verify":
                return self.error(400, "Invalid, expired, or already used verification link")
            account = self.registered[found["email"]]
            if account["password"]:
                return self.error(409, "This account is already set up. Log in, or use Forgot password.")
            found["used"] = True
            account.update(verified=True, password=body["password"])
            new_key = self.new_key_for(found["email"])
            result = self.identity(found["email"])
            result["api_key"] = new_key
            if self.delivers(found["email"], key):
                result["deliver"] = {"kind": "welcome"}
            else:
                self.outbox.append({"to": found["email"], "kind": "activated", "key": new_key})
            return httpx.Response(200, json=result)
        if path == "/password/forgot":
            problem = self._check_links(key, body.get("links"))
            if problem:
                return problem
            email = body["email"].strip().lower()
            generic: dict[str, Any] = {
                "message": "If that email address is registered, a password reset link has been sent."
            }
            if email in self.registered and self.registered[email]["verified"]:
                token = self._token(email, "reset")
                if self.delivers(email, key):
                    generic["deliver"] = {
                        "kind": "password_reset",
                        "token": token,
                        "expires_at": "2099-01-01T00:00:00Z",
                    }
                else:
                    self.outbox.append(
                        {
                            "to": email,
                            "kind": "reset",
                            "link": self._link(body.get("links"), "set_password", token),
                        }
                    )
            return httpx.Response(200, json=generic)
        found = self.tokens.get(body.get("token") or "")
        if not found or found["used"]:
            return self.error(400, "Invalid or expired token")
        found["used"] = True
        self.registered[found["email"]]["password"] = body["new_password"]
        return httpx.Response(200, json={"message": "Password set"})

    def delivers(self, email: str, key: str | None) -> bool:
        """Like ephemeralREST: only the account's own site, allowed to and asking to (see Part 6)."""
        site = self.domain_keys.get(key or "")
        account = self.registered.get(email)
        return bool(site and account and account.get("home") == key and site.get("delivery") == "self")

    def key_settings(self, request: httpx.Request, path: str, body: Any) -> httpx.Response:
        key = request.headers.get("X-API-Key") or ""
        if not self.app_links:
            return self.error(404, "Not found")
        if key in self.lists:
            return self.error(403, "Only a domain key can use this.")
        site = self.domain_keys.get(key)
        if site is None:
            return self.error(401, "Unauthorized")
        if path == "/keys/self/link-origins":
            if request.method == "PUT":
                for origin in body["origins"]:
                    host = origin.split("://", 1)[1].split(":")[0]
                    if host not in ("localhost", "127.0.0.1") and not (
                        host == site["domain"] or host.endswith("." + site["domain"])
                    ):
                        return self.error(400, f"{origin}: isn't {site['domain']} or one of its subdomains")
                site["origins"] = list(body["origins"])
            return httpx.Response(
                200,
                json={
                    "domain": site["domain"],
                    "origins": site["origins"],
                    "email_delivery": {
                        "allowed": site.get("allowed", False),
                        "mode": site.get("delivery", "ephemeral"),
                    },
                },
            )
        if path == "/keys/self/email-delivery":
            if request.method == "PUT":
                if body["mode"] == "self" and not site.get("allowed"):
                    return httpx.Response(403, json={"error": "email-delivery-not-allowed", "status": 403})
                site["delivery"] = body["mode"]
            return httpx.Response(
                200, json={"allowed": site.get("allowed", False), "mode": site.get("delivery", "ephemeral")}
            )
        return self.error(404, "Not found")

    def rotate(self, request: httpx.Request, key: str, body: Any) -> httpx.Response:
        self.rotations += 1
        new_key = f"{key.split('~')[0]}~rotated{self.rotations}"
        self.lists[new_key] = self.lists.pop(key)
        self.identities[new_key] = self.identities.pop(key)
        for account in self.registered.values():
            if account.get("key") == key:
                account["key"] = new_key
        email = self.identities[new_key]["identifier"]
        result: dict[str, Any] = {"api_key": new_key, "key_prefix": new_key[:8]}
        site = request.headers.get("X-Site-Key")
        if email in self.registered and self.delivers(email, site):
            result["deliver"] = {"kind": "key_replaced"}
        else:
            self.outbox.append(
                {
                    "to": email,
                    "kind": "rotated",
                    "key": new_key if (body or {}).get("email_key", True) else None,
                }
            )
        return httpx.Response(200, json=result)

    def login(self, body: dict[str, Any], site: str | None = None) -> httpx.Response:
        email = body["email"].strip().lower()
        account = self.registered.get(email)
        if not account or not account["verified"] or account["password"] != body["password"]:
            return self.error(401, "Invalid email or password")
        if body.get("device_token") and self.devices.get(body["device_token"]) == email:
            return httpx.Response(200, json=self.identity(email))
        self.codes[email] = "123456"
        result: dict[str, Any] = {"2fa_required": True, "email": email}
        if self.delivers(email, site):
            result["deliver"] = {"kind": "login_code", "code": "123456", "expires_at": "2099-01-01T00:00:00Z"}
        else:
            self.outbox.append({"to": email, "kind": "code", "code": "123456"})
        return httpx.Response(200, json=result)

    def identity(self, email: str, remember: bool = False) -> dict[str, Any]:
        result: dict[str, Any] = {
            "id": 9,
            "name": self.registered[email]["name"],
            "identifier": email,
            "admin": False,
            "active": True,
            "rate_limits": {},
            "api_key": self.registered[email].get("key") or GOOD_KEY,
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
        if self.with_ayanamsas:
            chart["ayanamsa"] = ayanamsas_for(utc)
        self.charts[chart_id] = chart
        return httpx.Response(200, json=chart)

    def ephemeris(self, body: dict[str, Any]) -> httpx.Response:
        import calendar

        year, month = body["year"], body["month"]
        days = {}
        for d in range(1, calendar.monthrange(year, month)[1] + 1):
            noon = datetime(year, month, d, 12, tzinfo=UTC)
            days[noon.date().isoformat()] = {"geocentric": positions_for(noon)}
        result: dict[str, Any] = {"year": year, "month": month, "days": days}
        if self.with_ayanamsas:
            result["ayanamsa"] = {
                d: ayanamsas_for(datetime.fromisoformat(d + "T12:00:00+00:00")) for d in days
            }
        return httpx.Response(200, json=result)
