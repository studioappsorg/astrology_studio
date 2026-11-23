"""
AstrologyStudio ·
server/tests/test_relationships.py

Tests:

synastry, composite and Davison charts, and returns.

Copyright (c) 2026 Gavin Melhuish
MIT License; see LICENSE in the project root.
SPDX-License-Identifier: MIT
"""

from __future__ import annotations

from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient

from astrologystudio.astro import relationships as rel

from .fake_ephemeral import FakeEphemeral

JANE = {"name": "Jane", "date": "1985-06-12", "time": "14:30", "place": "Perth"}
JOHN = {"name": "John", "date": "1983-01-20", "time": "08:05", "place": "London"}


def test_composite_points_use_nearer_midpoint() -> None:
    a = {"sun": {"lon": 350.0, "speed": 1.0}, "moon": {"lon": 100.0, "speed": 13.0}}
    b = {"sun": {"lon": 20.0, "speed": 1.0}, "mars": {"lon": 5.0}}
    out = rel.composite_points(a, b)
    assert set(out) == {"sun"}
    assert out["sun"]["lon"] == pytest.approx(5.0)
    assert out["sun"]["speed"] == pytest.approx(1.0)


def test_composite_houses_stay_in_order() -> None:
    a = [10.0 + 30 * i for i in range(12)]
    b = [(200.0 + 30 * i) % 360 for i in range(12)]
    cusps = rel.composite_houses(a, b)
    assert cusps is not None
    assert (cusps[3] - cusps[0]) % 360 == pytest.approx(90.0)
    assert rel.composite_houses(a, None) is None


def test_davison_place_and_moment() -> None:
    lat, lon = rel.davison_place(10, 170, 20, -170)  # across the date line, not round the world
    assert lat == pytest.approx(15.0) and abs(lon) == pytest.approx(180.0)
    assert rel.davison_place(-31.95, 115.86, 51.51, -0.13) == pytest.approx((9.78, 57.865))
    a = datetime(2000, 1, 1, tzinfo=UTC)
    b = datetime(2000, 1, 3, tzinfo=UTC)
    assert rel.davison_moment(a, b) == datetime(2000, 1, 2, tzinfo=UTC)


@pytest.fixture
def two(client: TestClient, ready: dict[str, str]) -> tuple[str, str]:
    jane = client.post("/api/v1/charts", json=JANE, headers=ready).json()["id"]
    john = client.post("/api/v1/charts", json=JOHN, headers=ready).json()["id"]
    return jane, john


def test_synastry(client: TestClient, two: tuple[str, str]) -> None:
    body = client.get(f"/api/v1/charts/{two[0]}/synastry", params={"with": two[1]}).json()
    assert body["a"]["name"] == "Jane" and body["b"]["name"] == "John"
    assert body["aspects"]
    a_keys, b_keys = set(body["a"]["points"]), set(body["b"]["points"])
    assert all(x["a"] in a_keys and x["b"] in b_keys for x in body["aspects"])


def test_composite_and_davison(client: TestClient, two: tuple[str, str], fake: FakeEphemeral) -> None:
    comp = client.get(f"/api/v1/charts/{two[0]}/composite", params={"with": two[1]}).json()
    assert comp["name"] == "Jane and John: composite"
    assert len(comp["houses"]) == 12 and "aspects" in comp
    dav = client.get(f"/api/v1/charts/{two[0]}/davison", params={"with": two[1]}).json()
    sent = next(b for b in fake.bodies if b and str(b.get("chart_name", "")).endswith("Davison"))
    assert sent["datetime"].startswith("1984-04-01T07:17")
    assert dav["name"] == "Jane and John: Davison"


def test_returns_with_token(client: TestClient, ready: dict[str, str], two: tuple[str, str]) -> None:
    url = f"/api/v1/charts/{two[0]}/returns"
    solar = client.post(url, json={"kind": "solar", "year": 2026, "place": "London"}, headers=ready).json()
    assert solar["kind"] == "solar" and solar["return_utc"].startswith("2026-03-14")
    assert solar["location"]["name"] == "London, UK"
    assert client.post(url, json={"kind": "lunar", "year": 2026}, headers=ready).status_code == 422
    lunar = client.post(url, json={"kind": "lunar", "year": 2026, "month": 7}, headers=ready).json()
    assert lunar["return_utc"].startswith("2026-07")


def test_composite_and_davison_as_derived_charts(
    client: TestClient, two: tuple[str, str], fake: FakeEphemeral
) -> None:
    jane, john = two
    comp = client.get(f"/api/v1/charts/derived/composite~{jane}~{john}").json()
    assert comp["id"] == f"composite~{jane}~{john}" and comp["kind"] == "composite"
    assert comp["parent_id"] == jane and comp["other_id"] == john
    assert comp["name"] == "Jane and John: composite" and len(comp["houses"]) == 12
    hellenistic = client.get(
        f"/api/v1/charts/derived/composite~{jane}~{john}", params={"mode": "hellenistic"}
    )
    assert hellenistic.json()["house_system"] == "whole_sign"

    dav = client.get(f"/api/v1/charts/derived/davison~{jane}~{john}").json()
    assert dav["kind"] == "davison" and dav["name"] == "Jane and John: Davison"
    assert dav["moment_utc"].startswith("1984-04-01T07:17")
    calculated = sum(1 for method, path in fake.calls if path == "/calculate")
    again = client.get(f"/api/v1/charts/derived/davison~{jane}~{john}").json()
    assert again["points"] == dav["points"]
    # ephemeralREST keeps every chart it calculates: the Davison chart is worked out once, not per view.
    assert sum(1 for method, path in fake.calls if path == "/calculate") == calculated
    assert client.get(f"/api/v1/charts/derived/davison~{jane}~").status_code != 200


def test_davison_where_places_are_found_by_name_only(
    client: TestClient, two: tuple[str, str], fake: FakeEphemeral
) -> None:
    jane, john = two
    fake.cities_only = True
    stuck = client.get(f"/api/v1/charts/derived/davison~{jane}~{john}")
    assert stuck.status_code == 422 and stuck.json()["type"].endswith("/midpoint-place")
    named = client.get(f"/api/v1/charts/derived/davison~{jane}~{john}~London")
    assert named.status_code == 200, named.text
    assert named.json()["location"]["name"] == "London, UK"


def test_composite_and_davison_are_kept_with_the_from_chart(
    client: TestClient, ready: dict[str, str], two: tuple[str, str]
) -> None:
    """Made as derived charts, they're listed under the chart they were made from."""
    jane, john = two
    url = f"/api/v1/charts/{jane}/derived"
    comp = client.post(url, json={"kind": "composite", "other": john}, headers=ready)
    assert comp.status_code == 201, comp.text
    assert comp.json()["id"] == f"composite~{jane}~{john}"
    dav = client.post(url, json={"kind": "davison", "other": john, "place": "London"}, headers=ready).json()
    assert dav["id"] == f"davison~{jane}~{john}~London"
    # Making the same one again doesn't list it twice.
    client.post(url, json={"kind": "composite", "other": john}, headers=ready)

    def under(chart: str) -> list[tuple[str, str]]:
        listed = client.get("/api/v1/charts").json()["data"]
        found = next(c for c in listed if c["id"] == chart)
        return sorted((d["id"], d["name"]) for d in found["derived"])

    assert under(jane) == [
        (f"composite~{jane}~{john}", "Jane and John: composite"),
        (f"davison~{jane}~{john}~London", "Jane and John: Davison"),
    ]
    assert under(john) == []  # only with the chart it was made from
    assert client.post(url, json={"kind": "composite"}, headers=ready).status_code == 422
    assert client.post(url, json={"kind": "composite", "other": jane}, headers=ready).status_code == 422

    # Removing one removes just it; removing the other chart removes the rest.
    assert client.delete(f"/api/v1/charts/composite~{jane}~{john}", headers=ready).status_code == 204
    assert [i for i, _ in under(jane)] == [f"davison~{jane}~{john}~London"]
    assert client.delete(f"/api/v1/charts/{john}", headers=ready).status_code == 204
    assert under(jane) == []
