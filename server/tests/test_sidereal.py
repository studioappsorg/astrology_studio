"""
AstrologyStudio ·
server/tests/test_sidereal.py

Sidereal charts: tropical positions from ephemeralREST less its ayanamsa, in charts, the daily
ephemeris, moving charts, relationships and harmonics, and staying tropical (and saying so)
with an ephemeralREST that sends no ayanamsas.

Copyright (c) 2026 Gavin Melhuish
MIT License; see LICENSE in the project root.
SPDX-License-Identifier: MIT
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

import pytest
from fastapi.testclient import TestClient

from astrologystudio.astro import zodiac

from .fake_ephemeral import FakeEphemeral, ayanamsas_for, positions_for

BIRTH = {"name": "A", "date": "2000-06-15", "time": "12:00", "place": "London"}
MOMENT = datetime(2000, 6, 15, 12, tzinfo=UTC)


def _sidereal(client: TestClient, headers: dict[str, str], ayanamsa: str = "lahiri", **more: Any) -> None:
    response = client.patch(
        "/api/v1/preferences/calculation",
        json={"zodiac": "sidereal", "ayanamsa": ayanamsa, **more},
        headers=headers,
    )
    assert response.status_code == 200, response.text


def _close(a: float, b: float, tol: float = 1e-6) -> bool:
    return abs((a - b + 180.0) % 360.0 - 180.0) < tol


@pytest.mark.parametrize("ayanamsa", list(zodiac.AYANAMSAS))
def test_a_chart_is_its_tropical_positions_less_the_ayanamsa(
    client: TestClient, ready: dict[str, str], ayanamsa: str
) -> None:
    tropical = client.post("/api/v1/charts", json=BIRTH, headers=ready).json()
    _sidereal(client, ready, ayanamsa)
    chart = client.get(f"/api/v1/charts/{tropical['id']}", headers=ready).json()
    amount = ayanamsas_for(MOMENT)[ayanamsa]
    assert chart["zodiac"] == {"type": "sidereal", "ayanamsa": ayanamsa, "value": amount}
    assert chart["sidereal_pending"] is False
    for body in ("sun", "moon", "saturn", "asc", "mc"):
        assert _close(chart["points"][body]["lon"], tropical["points"][body]["lon"] - amount), body
    for body in tropical["helio"]:
        assert _close(chart["helio"][body]["lon"], tropical["helio"][body]["lon"] - amount)
    assert all(_close(s, t - amount) for s, t in zip(chart["houses"], tropical["houses"], strict=True))
    assert _close(chart["points"]["aries_point"]["lon"], -amount), "0 deg tropical Aries"
    # Declination and right ascension don't depend on the zodiac.
    assert chart["points"]["sun"]["decl"] == tropical["points"]["sun"]["decl"]


def test_whole_sign_houses_start_at_the_sidereal_ascendants_sign(
    client: TestClient, ready: dict[str, str]
) -> None:
    _sidereal(client, ready, house_system="whole_sign")
    chart = client.post("/api/v1/charts", json=BIRTH, headers=ready).json()
    asc = chart["points"]["asc"]["lon"]
    assert chart["houses"][0] == (asc // 30) * 30
    assert all(chart["houses"][i] % 30 == 0 for i in range(12))


def test_an_ephemeralrest_without_ayanamsas_stays_tropical_and_says_so(
    client: TestClient, ready: dict[str, str], fake: FakeEphemeral
) -> None:
    fake.with_ayanamsas = False
    _sidereal(client, ready)
    chart = client.post("/api/v1/charts", json=BIRTH, headers=ready).json()
    assert chart["zodiac"]["type"] == "tropical"
    assert chart["sidereal_pending"] is True
    assert _close(chart["points"]["sun"]["lon"], positions_for(MOMENT)["sun"]["longitude"])
    assert chart["points"]["aries_point"]["lon"] == 0.0


def test_the_ephemeris_page_is_sidereal_day_by_day(client: TestClient, ready: dict[str, str]) -> None:
    tropical = client.get("/api/v1/ephemeris", params={"year": 2001, "month": 3}, headers=ready).json()
    assert tropical["zodiac"]["type"] == "tropical"
    _sidereal(client, ready, "fagan_bradley")
    page = client.get("/api/v1/ephemeris", params={"year": 2001, "month": 3}, headers=ready).json()
    assert page["zodiac"] == {"type": "sidereal", "ayanamsa": "fagan_bradley"}
    for day in ("2001-03-01", "2001-03-31"):
        amount = ayanamsas_for(datetime.fromisoformat(day + "T12:00:00+00:00"))["fagan_bradley"]
        assert _close(page["days"][day]["sun"]["lon"], tropical["days"][day]["sun"]["lon"] - amount)
    lunation = page["lunations"][0]
    amount = lunation["ayanamsa"]["fagan_bradley"]
    assert _close(lunation["moon_longitude"], 55.0 - amount) and _close(
        lunation["sun_longitude"], 235.0 - amount
    )


def test_a_month_cached_before_ayanamsas_is_fetched_again_when_needed(
    client: TestClient, ready: dict[str, str], fake: FakeEphemeral
) -> None:
    fake.with_ayanamsas = False
    _sidereal(client, ready)
    client.get("/api/v1/ephemeris", params={"year": 2002, "month": 5}, headers=ready)
    asked = sum(1 for _, path in fake.calls if path == "/ephemeris")
    client.get("/api/v1/ephemeris", params={"year": 2002, "month": 5}, headers=ready)
    assert sum(1 for _, path in fake.calls if path == "/ephemeris") == asked, (
        "an older ephemeralREST isn't asked again at once"
    )
    fake.with_ayanamsas = True
    from astrologystudio.db import connect

    db = connect(client.app.state.settings.database_path)
    db.execute("UPDATE ephemeris_months SET fetched_at = '2000-01-01T00:00:00Z'")  # six hours on
    db.close()
    before = sum(1 for _, path in fake.calls if path == "/ephemeris")
    page = client.get("/api/v1/ephemeris", params={"year": 2002, "month": 5}, headers=ready).json()
    assert page["zodiac"]["type"] == "sidereal"
    # May, and April for its last day (the page reads it to catch an ingress on the 1st).
    assert sum(1 for _, path in fake.calls if path == "/ephemeris") == before + 2
    client.get("/api/v1/ephemeris", params={"year": 2002, "month": 5}, headers=ready)
    assert sum(1 for _, path in fake.calls if path == "/ephemeris") == before + 2, "kept after that"


def test_transits_and_their_angles_are_sidereal(client: TestClient, ready: dict[str, str]) -> None:
    chart = client.post("/api/v1/charts", json=BIRTH, headers=ready).json()
    at = "2010-03-01T06:00:00Z"
    tropical = client.get(f"/api/v1/charts/{chart['id']}/moving", params={"at": at}, headers=ready).json()
    _sidereal(client, ready)
    sidereal = client.get(f"/api/v1/charts/{chart['id']}/moving", params={"at": at}, headers=ready).json()
    t, s = tropical["layers"]["transits"]["points"], sidereal["layers"]["transits"]["points"]
    noon_before = ayanamsas_for(datetime(2010, 2, 28, 12, tzinfo=UTC))["lahiri"]
    noon_after = ayanamsas_for(datetime(2010, 3, 1, 12, tzinfo=UTC))["lahiri"]
    amount = noon_before + (noon_after - noon_before) * 18 / 24
    for key in ("sun", "saturn", "asc", "mc"):
        assert _close(s[key]["lon"], t[key]["lon"] - amount, 1e-5), key


def test_progressed_angles_are_the_tropical_ones_less_the_progressed_ayanamsa(
    client: TestClient, ready: dict[str, str]
) -> None:
    chart = client.post("/api/v1/charts", json=BIRTH, headers=ready).json()
    params = {"at": "2030-01-01T00:00:00Z", "layers": "progressions"}
    tropical = client.get(f"/api/v1/charts/{chart['id']}/moving", params=params, headers=ready).json()
    _sidereal(client, ready)
    sidereal = client.get(f"/api/v1/charts/{chart['id']}/moving", params=params, headers=ready).json()
    t, s = tropical["layers"]["progressions"], sidereal["layers"]["progressions"]
    moment = datetime.fromisoformat(t["moment"])
    noon = datetime(moment.year, moment.month, moment.day, 12, tzinfo=UTC)
    amount = ayanamsas_for(noon)["lahiri"]  # within a fraction of a second of the exact moment
    for key in ("sun", "mc", "asc"):
        assert _close(s["points"][key]["lon"], t["points"][key]["lon"] - amount, 1e-4), key


def test_relationships_and_harmonics_follow_the_zodiac(client: TestClient, ready: dict[str, str]) -> None:
    first = client.post("/api/v1/charts", json=BIRTH, headers=ready).json()
    second = client.post(
        "/api/v1/charts", json={**BIRTH, "name": "B", "date": "1990-01-01"}, headers=ready
    ).json()
    _sidereal(client, ready)
    composite = client.get(
        f"/api/v1/charts/{first['id']}/composite", params={"with": second["id"]}, headers=ready
    ).json()
    a1 = ayanamsas_for(MOMENT)["lahiri"]
    a2 = ayanamsas_for(datetime(1990, 1, 1, 12, tzinfo=UTC))["lahiri"]
    assert composite["zodiac"]["type"] == "sidereal"
    assert _close(composite["points"]["aries_point"]["lon"], -(a1 + a2) / 2)
    davison = client.get(
        f"/api/v1/charts/{first['id']}/davison", params={"with": second["id"]}, headers=ready
    ).json()
    again = client.get(
        f"/api/v1/charts/{first['id']}/davison", params={"with": second["id"]}, headers=ready
    ).json()
    assert davison["zodiac"]["type"] == again["zodiac"]["type"] == "sidereal", "kept and restored"
    assert davison["points"]["sun"]["lon"] == again["points"]["sun"]["lon"]
    harmonic = client.get(f"/api/v1/charts/derived/harmonic-5-{first['id']}", headers=ready).json()
    sidereal_sun = client.get(f"/api/v1/charts/{first['id']}", headers=ready).json()["points"]["sun"]["lon"]
    assert _close(harmonic["points"]["sun"]["lon"], sidereal_sun * 5)
    assert _close(harmonic["points"]["aries_point"]["lon"], -5 * a1)


def test_calculation_settings_say_sidereal_is_supported(client: TestClient, ready: dict[str, str]) -> None:
    calc = client.get("/api/v1/preferences/calculation", headers=ready).json()
    assert calc["sidereal_supported"] is True
    assert {a["key"] for a in calc["ayanamsas"]} == {"lahiri", "krishnamurti", "fagan_bradley", "raman"}
