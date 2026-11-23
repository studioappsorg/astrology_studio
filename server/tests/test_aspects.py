"""
AstrologyStudio ·
server/tests/test_aspects.py

Tests:

finding aspects, orbs, applying and separating, and the aspect settings in profiles.

Copyright (c) 2026 Gavin Melhuish
MIT License; see LICENSE in the project root.
SPDX-License-Identifier: MIT
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from astrologystudio.astro import aspects

SETTINGS = aspects.default_settings()


def pts(**lons: float) -> dict[str, dict[str, float | None]]:
    return {k: {"lon": v, "speed": None} for k, v in lons.items()}


@pytest.mark.parametrize(
    ("a", "b", "expected"),
    [(10, 350, 20), (0, 180, 180), (359.5, 0.5, 1), (90, 270, 180), (45, 44, 1)],
)
def test_separation(a: float, b: float, expected: float) -> None:
    assert aspects.separation(a, b) == pytest.approx(expected)


def test_finds_closest_aspect_across_zero_aries() -> None:
    found = aspects.find(pts(sun=358.0, moon=122.5), SETTINGS)
    assert [(f.aspect, round(f.orb, 1)) for f in found] == [("trine", 4.5)]


def test_orbs_and_switches() -> None:
    assert aspects.find(pts(a=0, b=96), SETTINGS)[0].aspect == "square"
    assert aspects.find(pts(a=0, b=98), SETTINGS) == []  # square orb is 7
    off = {**SETTINGS, "square": {"on": False, "orb": 7}}
    assert aspects.find(pts(a=0, b=96), off) == []
    assert aspects.find(pts(a=0, b=96), SETTINGS, orb_factor=0.5) == []
    assert aspects.find(pts(a=0, b=30.5), SETTINGS) == []  # semi-sextile is off by default


def test_applying_and_separating() -> None:
    fast = {"moon": {"lon": 85.0, "speed": 13.0}, "sun": {"lon": 0.0, "speed": 1.0}}
    assert aspects.find(fast, SETTINGS)[0].applying is True
    fast["moon"]["lon"] = 95.0
    assert aspects.find(fast, SETTINGS)[0].applying is False


def test_between_two_sets() -> None:
    found = aspects.find(pts(t_sun=100), SETTINGS, second=pts(n_moon=10, n_sun=200))
    assert {(f.a, f.b, f.aspect) for f in found} == {("t_sun", "n_moon", "square")}


def test_profiles(client: TestClient, owner: dict[str, str]) -> None:
    calc = client.get("/api/v1/preferences/calculation").json()
    assert [p["name"] for p in calc["profiles"]] == ["Standard"]
    added = client.post("/api/v1/preferences/profiles", json={"name": "Tight orbs"}, headers=owner).json()
    new = next(p for p in added["profiles"] if p["name"] == "Tight orbs")
    changed = client.patch(
        f"/api/v1/preferences/profiles/{new['id']}",
        json={"house_system": "whole_sign", "zodiac": "sidereal", "aspects": {"conjunction": {"orb": 3}}},
        headers=owner,
    ).json()
    tight = next(p for p in changed["profiles"] if p["id"] == new["id"])
    assert tight["aspects"]["conjunction"] == {"on": True, "orb": 3.0}
    assert tight["zodiac"] == "sidereal"
    assert changed["active"] == "standard"
    active = client.post(f"/api/v1/preferences/profiles/{new['id']}/activate", headers=owner).json()
    assert active["house_system"] == "whole_sign"
    bad = client.patch(
        f"/api/v1/preferences/profiles/{new['id']}", json={"aspects": {"novile": {"on": True}}}, headers=owner
    )
    assert bad.status_code == 422
    assert client.delete("/api/v1/preferences/profiles/standard", headers=owner).status_code == 200
    assert client.delete(f"/api/v1/preferences/profiles/{new['id']}", headers=owner).status_code == 409


def test_chart_carries_aspects_and_sidereal_stub(client: TestClient, ready: dict[str, str]) -> None:
    client.patch("/api/v1/preferences/calculation", json={"zodiac": "sidereal"}, headers=ready)
    chart = client.post(
        "/api/v1/charts",
        json={"name": "A", "date": "2000-01-01", "time": "00:00", "place": "London"},
        headers=ready,
    ).json()
    assert chart["sidereal_pending"] is True
    assert chart["profile"]["zodiac"] == "sidereal"
    assert isinstance(chart["aspects"], list) and chart["aspects"]
    assert {"a", "b", "aspect", "orb", "applying"} <= set(chart["aspects"][0])
