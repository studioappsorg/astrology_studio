"""
AstrologyStudio ·
server/tests/test_time_tools.py

Tests:

events over a range of dates, the ephemeris and harmonics.

Copyright (c) 2026 Gavin Melhuish
MIT License; see LICENSE in the project root.
SPDX-License-Identifier: MIT
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient

from astrologystudio.astro import events

START = datetime(2026, 1, 1, tzinfo=UTC)


def linear(rate: float, at0: float) -> Any:
    def layer(moment: datetime) -> dict[str, dict[str, Any]]:
        days = (moment - START).total_seconds() / 86400
        return {"mars": {"lon": (at0 + rate * days) % 360, "speed": rate, "retro": rate < 0}}

    return layer


def test_exact_aspect_found_to_the_minute() -> None:
    # Mars from 350° at 0.5°/day; natal Sun at 20°: conjunction after 60 days, square (110°) after 240.
    found = events.exact_aspects(
        linear(0.5, 350.0),
        {"sun": {"lon": 20.0}},
        ["mars"],
        ["conjunction", "square"],
        START,
        START + timedelta(days=300),
        timedelta(days=1),
    )
    kinds = [(e["aspect"], e["at"][:16]) for e in found]
    assert kinds[0] == ("conjunction", (START + timedelta(days=60)).isoformat()[:16])
    squares = [e for e in found if e["aspect"] == "square"]
    assert squares[0]["at"][:16] == (START + timedelta(days=240)).isoformat()[:16]


def test_both_sides_of_an_aspect() -> None:
    # A full lap passes the waning and the waxing square.
    found = events.exact_aspects(
        linear(2.0, 0.0),
        {"sun": {"lon": 0.0}},
        ["mars"],
        ["square"],
        START,
        START + timedelta(days=180),
        timedelta(days=1),
    )
    assert [round(e["lon"]) for e in found] == [90, 270]


def test_month_events() -> None:
    days = {
        "2026-01-01": {"mars": {"lon": 29.6, "speed": 0.5}, "mercury": {"lon": 100.0, "speed": 0.1}},
        "2026-01-02": {"mars": {"lon": 30.1, "speed": 0.5}, "mercury": {"lon": 100.05, "speed": -0.05}},
    }
    found = events.month_events(days)
    assert {"date": "2026-01-02", "body": "mars", "kind": "ingress", "sign": 1} in found
    assert {"date": "2026-01-02", "body": "mercury", "kind": "station", "direction": "retrograde"} in found


@pytest.fixture
def chart_id(client: TestClient, ready: dict[str, str]) -> str:
    new = {"name": "Jane", "date": "1985-06-12", "time": "14:30", "place": "Perth"}
    return str(client.post("/api/v1/charts", json=new, headers=ready).json()["id"])


def test_events_endpoint(client: TestClient, chart_id: str) -> None:
    url = f"/api/v1/charts/{chart_id}/events"
    body = client.get(url, params={"start": "2026-01-01", "end": "2026-03-01"}).json()
    assert body["events"] == sorted(body["events"], key=lambda e: e["at"])
    assert all(e["mover"] != "moon" for e in body["events"])
    assert client.get(url, params={"start": "2026-01-01", "end": "2029-01-01"}).status_code == 422
    prog = client.get(url, params={"start": "2026-01-01", "end": "2036-01-01", "layer": "progressions"})
    assert prog.status_code == 200
    # Choose the moving bodies and the natal ones they aspect.
    some = {"start": "2026-01-01", "end": "2026-07-01", "movers": "saturn,jupiter", "targets": "sun,mc"}
    chosen = client.get(url, params=some).json()["events"]
    assert chosen and {e["mover"] for e in chosen} <= {"saturn", "jupiter"}
    assert {e["target"] for e in chosen} <= {"sun", "mc"}
    assert client.get(url, params={**some, "targets": "sun,pluto_x"}).status_code == 422
    assert client.get(url, params={**some, "movers": "nobody"}).status_code == 422


def test_harmonic(client: TestClient, chart_id: str) -> None:
    natal = client.get(f"/api/v1/charts/{chart_id}").json()
    h5 = client.get(f"/api/v1/charts/{chart_id}/harmonic", params={"n": 5}).json()
    assert h5["points"]["sun"]["lon"] == pytest.approx((natal["points"]["sun"]["lon"] * 5) % 360)
    assert h5["houses"] is None and h5["harmonic"] == 5
    # The chart screen asks for it as a derived chart, worked out each time.
    derived = client.get(f"/api/v1/charts/derived/harmonic-5-{chart_id}").json()
    assert derived["id"] == f"harmonic-5-{chart_id}" and derived["kind"] == "harmonic"
    assert derived["parent_id"] == chart_id and derived["harmonic"] == 5
    assert derived["points"]["sun"]["lon"] == pytest.approx(h5["points"]["sun"]["lon"])
    assert derived["name"].startswith("Harmonic 5")
    assert client.get(f"/api/v1/charts/derived/harmonic-0-{chart_id}").status_code == 422


def test_ephemeris_page(client: TestClient, ready: dict[str, str]) -> None:
    body = client.get("/api/v1/ephemeris", params={"year": 2026, "month": 3}).json()
    assert len(body["days"]) == 31
    assert body["lunations"][0]["phase"] == "full_moon"
    assert body["eclipses"][0]["eclipse_type"] == "total"
    assert all(e["date"] >= "2026-03-01" for e in body["events"])
