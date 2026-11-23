"""
AstrologyStudio ·
server/tests/test_releasing.py

Zodiacal releasing:

period lengths, the loosing of the bond, peaks and the year length.

Copyright (c) 2026 Gavin Melhuish
MIT License; see LICENSE in the project root.
SPDX-License-Identifier: MIT
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from fastapi.testclient import TestClient

from astrologystudio.astro import hellenistic as h

from .test_charts import make

BIRTH = datetime(1985, 6, 12, 6, 30, tzinfo=UTC)
END = BIRTH + timedelta(days=365.25 * 90)


def days(period: dict[str, object]) -> float:
    start = datetime.fromisoformat(str(period["start"]))
    end = datetime.fromisoformat(str(period["end"]))
    return (end - start).total_seconds() / 86400


def test_level_1_from_aries() -> None:
    periods = h.releasing(5.0, 5.0, BIRTH, BIRTH, END, levels=1)
    assert [p["sign"] for p in periods[:4]] == ["aries", "taurus", "gemini", "cancer"]
    assert [days(p) for p in periods[:4]] == [15 * 360, 8 * 360, 20 * 360, 25 * 360]
    longer = h.releasing(5.0, 5.0, BIRTH, BIRTH, END, levels=1, year_days=365.25)
    assert days(longer[0]) == 15 * 365.25


def test_level_2_months_and_the_loosing_of_the_bond() -> None:
    # Cancer's 25 years: twelve signs take 211 months, then the bond is loosed to Capricorn.
    cancer = h.releasing(95.0, 95.0, BIRTH, BIRTH, END, levels=2)[0]
    subs = cancer["periods"]
    assert isinstance(subs, list)
    signs = [s["sign"] for s in subs]
    assert signs[:12] == list(h.SIGNS[3:]) + list(h.SIGNS[:3])
    assert signs[12:] == ["capricorn", "aquarius", "pisces", "aries", "taurus"]
    assert subs[12]["loosing"] and not any(s["loosing"] for s in subs[:12] + subs[13:])
    assert [days(s) for s in subs[:3]] == [25 * 30, 19 * 30, 20 * 30]
    assert days(subs[-1]) == 5 * 30  # Taurus cut short: 211 + 27 + 30 + 12 + 15 = 295 months, 5 left
    assert sum(days(s) for s in subs) == 25 * 360


def test_no_loosing_in_short_periods() -> None:
    taurus = h.releasing(35.0, 35.0, BIRTH, BIRTH, END, levels=2)[0]
    assert taurus["sign"] == "taurus"
    assert not any(s["loosing"] for s in taurus["periods"])


def test_level_3_and_peaks() -> None:
    first = h.releasing(5.0, 275.0, BIRTH, BIRTH, BIRTH + timedelta(days=60), levels=3)[0]
    aries_l2 = first["periods"][0]
    l3 = aries_l2["periods"]
    assert days(l3[0]) == 15 * 2.5 and l3[0]["sign"] == "aries"
    # Fortune in Capricorn: Aries is the 4th sign from it and Cancer the 7th.
    assert first["angular_from_fortune"] == 4
    peaks = {
        p["sign"]: p["angular_from_fortune"] for p in h.releasing(5.0, 275.0, BIRTH, BIRTH, END, levels=1)
    }
    assert peaks["cancer"] == 7 and peaks["taurus"] is None and peaks["gemini"] is None


def test_range_filter() -> None:
    later = BIRTH + timedelta(days=360 * 30)
    periods = h.releasing(5.0, 5.0, BIRTH, later, later + timedelta(days=10), levels=2)
    assert len(periods) == 1 and periods[0]["sign"] == "gemini"
    assert len(periods[0]["periods"]) == 1


def test_releasing_endpoint(client: TestClient, ready: dict[str, str]) -> None:
    chart = make(client, ready)
    url = f"/api/v1/charts/{chart['id']}/releasing"
    spirit = client.get(url).json()
    assert spirit["from"] == "spirit" and spirit["year_days"] == 360
    assert spirit["periods"][0]["sign"] == spirit["lot_sign"]
    assert "periods" in spirit["periods"][0]
    fortune = client.get(url, params={"from": "fortune", "year": "365.25", "levels": 1}).json()
    assert fortune["periods"][0]["sign"] == fortune["fortune_sign"]
    assert "periods" not in fortune["periods"][0]
    assert client.get(url, params={"start": "2030-01-01", "end": "2020-01-01"}).status_code == 422
    young = client.get(url, params={"to_age": 20, "levels": 1}).json()["periods"]
    assert len(young) < len(spirit["periods"])
