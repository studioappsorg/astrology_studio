"""
AstrologyStudio ·
server/tests/test_hellenistic.py

Hellenistic rules:

sect, lots, dignities, solar phase, joys, aspects by sign, profections.

Copyright (c) 2026 Gavin Melhuish
MIT License; see LICENSE in the project root.
SPDX-License-Identifier: MIT
"""

from __future__ import annotations

from datetime import date

import pytest
from fastapi.testclient import TestClient

from astrologystudio import catalog
from astrologystudio.astro import hellenistic as h

from .test_charts import make


def p(lon: float) -> dict[str, float | None]:
    return {"lon": lon, "speed": None}


def test_sect() -> None:
    assert h.sect(270.0, 0.0)["sect"] == "day"  # Sun near the MC
    assert h.sect(90.0, 0.0)["sect"] == "night"  # Sun near the IC
    day = h.sect(200.0, 10.0)
    assert (day["sect_light"], day["benefic_of_sect"], day["malefic_of_sect"]) == ("sun", "jupiter", "saturn")
    night = h.sect(100.0, 10.0)
    assert (night["sect_light"], night["benefic_of_sect"], night["malefic_of_sect"]) == (
        "moon",
        "venus",
        "mars",
    )
    # Just above the Descendant is day, just below is night; both are near the horizon.
    assert h.sect(180.5, 0.0)["sect"] == "day" and h.sect(180.5, 0.0)["sect_near_horizon"]
    assert h.sect(179.5, 0.0)["sect"] == "night" and h.sect(179.5, 0.0)["sect_near_horizon"]
    assert not h.sect(270.0, 0.0)["sect_near_horizon"]


POINTS = {"asc": 10.0, "sun": 270.0, "moon": 100.0, "mercury": 250.0, "venus": 300.0,
          "mars": 40.0, "jupiter": 150.0, "saturn": 210.0}  # fmt: skip


def test_lots_by_day() -> None:
    lots = h.lots(POINTS, day=True)
    fortune = (10 + 100 - 270) % 360  # 200
    spirit = (10 + 270 - 100) % 360  # 180
    assert lots["part_of_fortune"] == pytest.approx(fortune)
    assert lots["lot_spirit"] == pytest.approx(spirit)
    assert lots["lot_eros"] == pytest.approx((10 + 300 - spirit) % 360)
    assert lots["lot_necessity"] == pytest.approx((10 + fortune - 250) % 360)
    assert lots["lot_courage"] == pytest.approx((10 + fortune - 40) % 360)
    assert lots["lot_victory"] == pytest.approx((10 + 150 - spirit) % 360)
    assert lots["lot_nemesis"] == pytest.approx((10 + fortune - 210) % 360)


def test_lots_by_night() -> None:
    lots = h.lots(POINTS, day=False)
    fortune = (10 + 270 - 100) % 360
    spirit = (10 + 100 - 270) % 360
    assert lots["part_of_fortune"] == pytest.approx(fortune)
    assert lots["lot_spirit"] == pytest.approx(spirit)
    assert lots["lot_eros"] == pytest.approx((10 + spirit - 300) % 360)
    assert lots["lot_necessity"] == pytest.approx((10 + 250 - fortune) % 360)
    assert lots["lot_nemesis"] == pytest.approx((10 + 210 - fortune) % 360)
    # The modern habit: Fortune by the day formula, even at night.
    same = h.lots(POINTS, day=False, fortune_by_sect=False)
    assert same["part_of_fortune"] == pytest.approx((10 + 100 - 270) % 360)
    assert same["lot_spirit"] == pytest.approx(spirit)


def test_bounds_tables_are_whole() -> None:
    for sign, bounds in enumerate(h.BOUNDS):
        ends = [end for _, end in bounds]
        assert ends == sorted(ends) and ends[-1] == 30, h.SIGNS[sign]
        rulers = [r for r, _ in bounds]
        assert sorted(rulers) == ["jupiter", "mars", "mercury", "saturn", "venus"], h.SIGNS[sign]
    # Each planet's bounds add up to its years: Saturn 57, Jupiter 79, Mars 66, Venus 82, Mercury 76.
    totals: dict[str, float] = {}
    for bounds in h.BOUNDS:
        start = 0
        for ruler, end in bounds:
            totals[ruler] = totals.get(ruler, 0) + end - start
            start = end
    assert totals == {"saturn": 57, "jupiter": 79, "mars": 66, "venus": 82, "mercury": 76}


def test_lords() -> None:
    assert h.bound_lord(5.9) == "jupiter" and h.bound_lord(6.0) == "venus"
    assert h.bound_lord(120 + 11.5) == "saturn"  # Leo 11°30'
    assert h.bound_lord(359.9) == "saturn"
    assert [h.decan_lord(x) for x in (0, 15, 25, 30, 359)] == ["mars", "sun", "venus", "mercury", "mars"]
    assert h.triplicity_lords(0) == ("sun", "jupiter", "saturn")
    assert h.triplicity_lords(100) == ("venus", "mars", "moon")  # Cancer, water
    mars = h.dignity_of("mars", 3.0, day=False)  # Mars at 3° Aries
    assert mars["domicile"] == "mars" and "domicile" in mars["own"]
    assert mars["triplicity"] == "jupiter"  # fire by night
    jupiter = h.dignity_of("jupiter", 3.0, day=False)
    assert {"triplicity", "bound"} <= set(jupiter["own"])
    venus = h.dignity_of("venus", 185.0, day=True)  # Libra
    assert "domicile" in venus["own"]
    assert "fall" in h.dignity_of("sun", 190.0, day=True)["own"]


def test_solar_phase() -> None:
    assert h.solar_phase(100.2, 100.0)["phase"] == "cazimi"
    assert h.solar_phase(100.0 + 17 / 60 + 0.01, 100.0)["phase"] == "combust"
    assert h.solar_phase(108.5, 100.0)["phase"] == "combust"
    assert h.solar_phase(108.6, 100.0)["phase"] == "beams"
    assert h.solar_phase(115.0, 100.0)["phase"] == "beams"
    assert h.solar_phase(115.1, 100.0)["phase"] == "free"
    assert h.solar_phase(90.0, 100.0)["orientation"] == "morning"
    assert h.solar_phase(110.0, 100.0)["orientation"] == "evening"


def test_joys_and_angularity() -> None:
    result = h.analyse({"asc": p(5.0), "sun": p(250.0), "mercury": p(15.0), "saturn": p(340.0)})
    assert result is not None
    assert result["houses"]["mercury"] == {"house": 1, "angularity": "angular"}
    assert result["houses"]["sun"] == {"house": 9, "angularity": "cadent"}
    assert set(result["joys"]) == {"mercury", "sun", "saturn"}


def test_aspects_by_sign() -> None:
    found = {(a.a, a.b): a for a in h.sign_aspects({"venus": p(29.0), "mars": p(91.0), "jupiter": p(31.0)})}
    square = found[("venus", "mars")]
    assert square.aspect == "square" and square.overcoming == "a"
    assert square.degrees_apart == pytest.approx(62.0)
    assert ("venus", "jupiter") not in found  # aversion though 2° apart
    by_sign = h.sign_aspects({"saturn": p(280.0), "sun": p(10.0)})[0]  # Capricorn to Aries
    assert by_sign.aspect == "square" and by_sign.overcoming == "a"  # Saturn overcomes from the 10th
    trine = h.sign_aspects({"a": p(130.0), "b": p(10.0)})[0]  # Leo and Aries
    assert trine.aspect == "trine" and trine.superior == "b" and trine.overcoming is None


def test_profections() -> None:
    points = {"asc": p(95.0), "sun": p(200.0), "moon": p(330.0), "jupiter": p(100.0)}
    result = h.profections(points, date(1985, 6, 12), date(2026, 6, 11))
    years = result["years"]
    assert years[0]["sign"] == "cancer" and years[0]["lord"] == "moon" and years[0]["planets"] == ["jupiter"]
    assert years[12]["sign"] == "cancer" and years[13]["sign"] == "leo"
    assert result["current_age"] == 40  # the 41st birthday is tomorrow
    assert h.profections(points, date(1985, 6, 12), date(2026, 6, 12))["current_age"] == 41
    leap = h.profections(points, date(2000, 2, 29), date(2001, 3, 1))["years"]
    assert leap[1]["start"] == "2001-02-28"


def test_hellenistic_chart(client: TestClient, ready: dict[str, str]) -> None:
    chart = make(client, ready)
    plain = client.get(f"/api/v1/charts/{chart['id']}").json()
    assert plain["mode"] == "standard" and plain["hellenistic"] is None
    assert plain["house_system"] == "placidus"
    assert "lot_spirit" in plain["points"] and "aries_point" in plain["points"]
    assert not any("aries_point" in (a["a"], a["b"]) for a in plain["aspects"])

    hel = client.get(f"/api/v1/charts/{chart['id']}", params={"mode": "hellenistic"}).json()
    asc = hel["points"]["asc"]["lon"]
    assert hel["house_system"] == "whole_sign"
    assert hel["houses"][0] == pytest.approx((asc // 30) * 30)
    assert all(a["by_sign"] for a in hel["aspects"])
    block = hel["hellenistic"]
    assert block["sect"] in ("day", "night")
    assert block["dignities"]["sun"]["bound"] in h.CHALDEAN
    day = block["sect"] == "day"
    lons = {k: v["lon"] for k, v in hel["points"].items()}
    assert hel["points"]["part_of_fortune"]["lon"] == pytest.approx(h.lots(lons, day)["part_of_fortune"])
    # The active profile is untouched.
    assert client.get(f"/api/v1/charts/{chart['id']}").json()["house_system"] == "placidus"


def test_switched_off_aspects_are_not_shown(client: TestClient, ready: dict[str, str]) -> None:
    """An aspect switched off in the profile (Your view → Aspects) is in neither the standard nor
    the Hellenistic chart's aspects, though by sign ignores orbs."""
    chart = make(client, ready)
    off = {k: {"on": False} for k in ("square", "trine", "sextile", "opposition", "conjunction")}
    changed = client.patch("/api/v1/preferences/calculation", json={"aspects": off}, headers=ready)
    assert changed.status_code == 200, changed.text
    for params in ({}, {"mode": "hellenistic"}):
        found = client.get(f"/api/v1/charts/{chart['id']}", params=params).json()["aspects"]
        assert not {a["aspect"] for a in found} & set(off), params


def test_fortune_follows_the_profile(client: TestClient, ready: dict[str, str]) -> None:
    chart = make(client, ready)
    plain = client.get(f"/api/v1/charts/{chart['id']}").json()
    lons = {k: v["lon"] for k, v in plain["points"].items()}
    day_formula = (lons["asc"] + lons["moon"] - lons["sun"]) % 360
    assert plain["points"]["part_of_fortune"]["lon"] == pytest.approx(day_formula)
    assert plain["profile"]["lot_formula"] == "day"
    changed = client.patch("/api/v1/preferences/calculation", json={"lot_formula": "sect"}, headers=ready)
    assert changed.status_code == 200, changed.text
    sect = client.get(f"/api/v1/charts/{chart['id']}").json()
    day = h.is_day(lons["sun"], lons["asc"])
    expected = day_formula if day else (lons["asc"] + lons["sun"] - lons["moon"]) % 360
    assert sect["points"]["part_of_fortune"]["lon"] == pytest.approx(expected)


def test_profections_endpoint(client: TestClient, ready: dict[str, str]) -> None:
    chart = make(client, ready)
    result = client.get(f"/api/v1/charts/{chart['id']}/profections", params={"today": "2026-06-12"}).json()
    assert result["current_age"] == 41
    assert result["years"][0]["sign"] == result["asc_sign"]
    assert len(result["years"]) == 101


def test_limit_to_school(client: TestClient, ready: dict[str, str]) -> None:
    view = client.get("/api/v1/preferences/view").json()
    assert view["display"]["school"] == "self"
    limited = client.post(
        "/api/v1/preferences/limit-to-school", json={"school": "hellenistic"}, headers=ready
    )
    assert limited.status_code == 200, limited.text
    body = limited.json()
    assert body["features"]["hellenistic"] and not body["features"]["dials"]
    assert body["bodies"]["lot_spirit"] and not body["bodies"]["uranus"]
    assert body["display"]["school"] == "hellenistic"
    back = client.patch("/api/v1/preferences/view", json={"features": {"dials": True}}, headers=ready)
    assert back.json()["features"]["dials"]
    common = client.post("/api/v1/preferences/limit-to-school", json={"school": "self"}, headers=ready)
    assert common.json()["features"] == catalog.default_features()
    assert common.json()["bodies"] == catalog.default_bodies()
    assert common.json()["display"]["school"] == "self"


def test_self_selected_is_the_first_school(client: TestClient, ready: dict[str, str]) -> None:
    listed = client.get("/api/v1/preferences/catalog").json()
    first = listed["schools"][0]
    assert first["key"] == "self" and first["label"] == "Self-selected" and first["hint"]
    assert listed["display"]["school"][0] == "self"
    features = client.get("/api/v1/preferences/view").json()["features"]
    assert features["transits"] and features["midpoints"] and not features["dials"]
    assert not features["hellenistic"] and not features["heliocentric"]
