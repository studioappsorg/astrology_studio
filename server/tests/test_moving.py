"""
AstrologyStudio ·
server/tests/test_moving.py

Tests:

transits, progressions and solar arc worked out for a moment.

Copyright (c) 2026 Gavin Melhuish
MIT License; see LICENSE in the project root.
SPDX-License-Identifier: MIT
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from astrologystudio.astro import angles, moving

from .fake_ephemeral import FakeEphemeral, positions_for

NEW = {"name": "Jane", "date": "1985-06-12", "time": "14:30", "place": "Perth"}


def test_angles_match_swiss_ephemeris() -> None:
    # Swiss Ephemeris (Placidus) for 1879-03-14 10:30 UT at 48.4 N, 9.99 E: ASC 97.4362, MC 337.4642.
    found = angles.angles(datetime(1879, 3, 14, 10, 30, tzinfo=UTC), 48.4, 9.99)
    assert found["asc"] == pytest.approx(97.4362, abs=0.02)
    assert found["mc"] == pytest.approx(337.4642, abs=0.02)
    # Southern hemisphere: 2026-11-17 02:00 UT at Perth. ASC 302.5577, MC 203.7798.
    found = angles.angles(datetime(2026, 11, 17, 2, tzinfo=UTC), -31.95, 115.86)
    assert found["asc"] == pytest.approx(302.5577, abs=0.02)
    assert found["mc"] == pytest.approx(203.7798, abs=0.02)


def test_mc_and_ramc_round_trip() -> None:
    for mc in (0.0, 45.0, 123.4, 270.0, 359.0):
        assert angles.mc_from_ramc(angles.ramc_from_mc(mc, 23.44), 23.44) == pytest.approx(mc, abs=1e-6)


def test_progressed_moment_is_a_day_a_year() -> None:
    natal = datetime(1985, 6, 12, 6, 30, tzinfo=UTC)
    later = natal + timedelta(days=30 * moving.YEAR)
    assert moving.progressed_moment(natal, later) == natal + timedelta(days=30)


def test_transits_interpolate_and_cache(
    client: TestClient, ready: dict[str, str], fake: FakeEphemeral
) -> None:
    chart = client.post("/api/v1/charts", json=NEW, headers=ready).json()
    at = "2026-11-17T03:00:00Z"
    body = client.get(f"/api/v1/charts/{chart['id']}/moving", params={"at": at, "layers": "transits"}).json()
    moon = body["layers"]["transits"]["points"]["moon"]["lon"]
    assert moon == pytest.approx(
        positions_for(datetime(2026, 11, 17, 3, tzinfo=UTC))["moon"]["longitude"], abs=1e-6
    )
    assert "asc" in body["layers"]["transits"]["points"]
    fetched = len([c for c in fake.calls if c[1] == "/ephemeris"])
    client.get(f"/api/v1/charts/{chart['id']}/moving", params={"at": "2026-11-17T09:00:00Z"})
    assert len([c for c in fake.calls if c[1] == "/ephemeris"]) == fetched  # months come from the cache
    assert not [c for c in fake.calls if c[1] == "/calculate"][1:]  # nothing more saved in ephemeralREST


def test_progressions_and_solar_arc(client: TestClient, ready: dict[str, str]) -> None:
    chart = client.post("/api/v1/charts", json=NEW, headers=ready).json()
    params = {"at": "2015-06-12T06:30:00Z", "layers": "progressions,solar_arc"}
    body = client.get(f"/api/v1/charts/{chart['id']}/moving", params=params).json()
    prog, sa = body["layers"]["progressions"], body["layers"]["solar_arc"]
    assert prog["moment"].startswith("1985-07-12")  # thirty years on: thirty days on
    assert sa["arc"] == pytest.approx(prog["arc"])
    natal_moon = chart["points"]["moon"]["lon"]
    assert sa["points"]["moon"]["lon"] == pytest.approx((natal_moon + sa["arc"]) % 360)
    assert "mc" in prog["points"] and "asc" in prog["points"]
    for a in sa["aspects"]:
        assert a["orb"] <= 1.0  # capped at the profile's moving-chart orb


def test_bad_requests(client: TestClient, ready: dict[str, str]) -> None:
    chart = client.post("/api/v1/charts", json=NEW, headers=ready).json()
    url = f"/api/v1/charts/{chart['id']}/moving"
    assert client.get(url, params={"at": "soon"}).status_code == 422
    assert client.get(url, params={"at": "2026-01-01", "layers": "tarot"}).status_code == 422
    assert client.get(url, params={"at": "1700-01-01"}).status_code == 422
