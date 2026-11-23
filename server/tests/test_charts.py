"""
AstrologyStudio ·
server/tests/test_charts.py

Tests:

making, listing, editing and removing charts, notes, folders and tags, and derived charts.

Copyright (c) 2026 Gavin Melhuish
MIT License; see LICENSE in the project root.
SPDX-License-Identifier: MIT
"""

from __future__ import annotations

from fastapi.testclient import TestClient

from astrologystudio import charts
from astrologystudio.ephemeral import Cache

from .fake_ephemeral import FakeEphemeral

NEW = {"name": "Jane Doe", "date": "1985-06-12", "time": "14:30", "place": "Perth"}


def make(client: TestClient, headers: dict[str, str], **extra: object) -> dict[str, object]:
    response = client.post("/api/v1/charts", json={**NEW, **extra}, headers=headers)
    assert response.status_code == 201, response.text
    body: dict[str, object] = response.json()
    return body


def test_needs_a_key(client: TestClient, owner: dict[str, str]) -> None:
    response = client.get("/api/v1/charts")
    assert response.status_code == 409
    assert response.json()["type"].endswith("no-api-key")


def test_create_lists_and_loads(client: TestClient, ready: dict[str, str], fake: FakeEphemeral) -> None:
    chart = make(client, ready, tags=["Family", "family"], rating="AA")
    assert chart["place"] == "Perth WA, Australia"
    assert chart["note"]["tags"] == ["family"]
    assert chart["house_system"] == "placidus"
    assert len(chart["houses"]) == 12
    assert "chiron" in chart["points"]
    sent = next(b for b in fake.bodies if b and "chart_name" in b)
    assert sent["output"]["bodies"]["part_of_fortune"] is True  # always calculated in full
    assert sent["datetime"] == "1985-06-12T14:30:00"

    listed = client.get("/api/v1/charts").json()
    assert [c["name"] for c in listed["data"]] == ["Jane Doe"]
    assert listed["tags"] == ["family"]
    assert client.get("/api/v1/charts", params={"q": "1985-06 perth"}).json()["data"]
    assert not client.get("/api/v1/charts", params={"q": "london"}).json()["data"]

    loaded = client.get(f"/api/v1/charts/{chart['id']}").json()
    assert loaded["points"]["sun"]["lon"] == chart["points"]["sun"]["lon"]


def test_unknown_time_and_offset(client: TestClient, ready: dict[str, str], fake: FakeEphemeral) -> None:
    chart = make(client, ready, time=None, utc_offset="+09:00")
    sent = next(b for b in fake.bodies if b and "chart_name" in b)
    assert sent["datetime"] == "1985-06-12T12:00:00+09:00"
    assert chart["note"]["time_unknown"] is True
    assert chart["note"]["utc_offset"] == "+09:00"
    bad = client.post("/api/v1/charts", json={**NEW, "utc_offset": "9"}, headers=ready)
    assert bad.status_code == 422


def test_correcting_birth_time_recalculates_same_id(
    client: TestClient, ready: dict[str, str], fake: FakeEphemeral
) -> None:
    chart = make(client, ready, time=None)
    fixed = client.patch(f"/api/v1/charts/{chart['id']}", json={"time": "06:15"}, headers=ready).json()
    assert fixed["id"] == chart["id"]
    assert fixed["time"] == "06:15"
    assert fixed["note"]["time_unknown"] is False
    recalc = [b for b in fake.bodies if b and b.get("recalc")]
    assert recalc and recalc[0]["chart_id"] == chart["id"]


def test_notes_only_change_does_not_recalculate(
    client: TestClient, ready: dict[str, str], fake: FakeEphemeral
) -> None:
    chart = make(client, ready)
    before = len([c for c in fake.calls if c[1] == "/calculate"])
    changed = client.patch(
        f"/api/v1/charts/{chart['id']}",
        json={"notes": "From the birth certificate", "rating": "AA"},
        headers=ready,
    ).json()
    assert changed["note"]["notes"] == "From the birth certificate"
    assert len([c for c in fake.calls if c[1] == "/calculate"]) == before


def test_folders(client: TestClient, ready: dict[str, str]) -> None:
    folder = client.post("/api/v1/folders", json={"name": "Clients"}, headers=ready).json()
    assert client.post("/api/v1/folders", json={"name": "Clients"}, headers=ready).status_code == 409
    chart = make(client, ready, folder_id=folder["id"])
    make(client, ready, name="Loose")
    in_folder = client.get("/api/v1/charts", params={"folder": folder["id"]}).json()["data"]
    assert [c["id"] for c in in_folder] == [chart["id"]]
    assert [c["name"] for c in client.get("/api/v1/charts", params={"folder": "none"}).json()["data"]] == [
        "Loose"
    ]
    assert client.get("/api/v1/folders").json()["data"][0]["charts"] == 1
    assert client.delete(f"/api/v1/folders/{folder['id']}", headers=ready).status_code == 204
    assert client.get(f"/api/v1/charts/{chart['id']}").json()["note"]["folder_id"] is None
    bad = client.post("/api/v1/charts", json={**NEW, "folder_id": "fld_nope"}, headers=ready)
    assert bad.status_code == 422


def test_delete_and_import_shared(client: TestClient, ready: dict[str, str], fake: FakeEphemeral) -> None:
    chart = make(client, ready)
    assert client.delete(f"/api/v1/charts/{chart['id']}", headers=ready).status_code == 204
    assert client.get("/api/v1/charts").json()["data"] == []
    link = f"https://cosmobiology.online/dials?chart={chart['id']}"
    imported = client.post("/api/v1/charts/import", json={"chart": link}, headers=ready)
    assert imported.status_code == 201
    assert imported.json()["date"] == "1985-06-12"
    assert (
        client.post("/api/v1/charts/import", json={"chart": "not a chart id"}, headers=ready).status_code
        == 422
    )


def test_other_house_system_does_not_touch_saved_chart(
    client: TestClient, ready: dict[str, str], fake: FakeEphemeral
) -> None:
    chart = make(client, ready)
    client.patch("/api/v1/preferences/calculation", json={"house_system": "koch"}, headers=ready)
    loaded = client.get(f"/api/v1/charts/{chart['id']}").json()
    assert loaded["house_system"] == "koch"
    assert loaded["id"] == chart["id"]
    assert fake.charts[str(chart["id"])]["house_cusps"]["system"] == "placidus"


def test_other_house_system_with_cities_only_geocoding(
    client: TestClient, ready: dict[str, str], fake: FakeEphemeral
) -> None:
    """An ephemeralREST without Google geocoding doesn't take coordinates as a location, so the
    recalculation sends the place's name, and the moment in UTC."""
    chart = make(client, ready)
    fake.cities_only = True
    client.patch("/api/v1/preferences/calculation", json={"house_system": "koch"}, headers=ready)
    response = client.get(f"/api/v1/charts/{chart['id']}")
    assert response.status_code == 200, response.text
    assert response.json()["house_system"] == "koch"
    sent = [b for b in fake.bodies if isinstance(b, dict) and b.get("house_system") == "koch"]
    assert sent[-1]["location"] == "Perth WA, Australia" and sent[-1]["datetime"].endswith("+00:00")

    # A place it can't find by name either: the chart still opens, in its own houses.
    fake.charts[str(chart["id"])]["location"]["formatted_address"] = "Nowhere at all"
    client.app.state.ephemeral_cache = Cache()  # changed behind AstrologyStudio's back, so forget it
    fallback = client.get(f"/api/v1/charts/{chart['id']}")
    assert fallback.status_code == 200 and fallback.json()["house_system"] == "placidus"


def test_places(client: TestClient, ready: dict[str, str]) -> None:
    assert (
        client.get("/api/v1/places", params={"q": "per"}).json()["data"][0]["name"] == "Perth WA, Australia"
    )


def test_normalise_older_shape() -> None:
    chart = charts.normalise(
        {
            "chart_id": "x",
            "planetary_positions": {"sun": {"longitude": 354.1, "longitude_speed": 1.0}},
            "heliocentric": {"earth": {"longitude": 174.1}},
            "house_cusps": {
                "system": "placidus",
                "cusps": {str(i): i * 30.0 for i in range(1, 13)},
                "asc": 30.0,
            },
        }
    )
    assert chart.points["sun"]["lon"] == 354.1
    assert chart.points["asc"]["lon"] == 30.0
    assert chart.helio["earth"]["lon"] == 174.1
    assert chart.houses is not None and chart.houses[0] == 30.0


def test_derived_charts(client: TestClient, ready: dict[str, str], fake: FakeEphemeral) -> None:
    """Progressions, solar arc and returns are kept in ephemeralREST and listed under their parent."""
    natal = make(client, ready)
    url = f"/api/v1/charts/{natal['id']}/derived"
    progressed = client.post(url, json={"kind": "progressed", "date": "2026-11-19"}, headers=ready)
    assert progressed.status_code == 201, progressed.text
    p = progressed.json()
    assert p["kind"] == "progressed" and p["parent_id"] == natal["id"] and p["reference_date"] == "2026-11-19"
    assert p["name"].endswith("Progressions 2026-11-19") and p["points"]["sun"] and p["houses"]
    assert isinstance(p["aspects"], list)
    entry = fake.account[p["id"]]
    assert entry["type"] == "derived" and entry["parent_uuid"] == natal["id"]

    solar = client.post(
        url, json={"kind": "solar_return", "year": 2026, "place": "London"}, headers=ready
    ).json()
    assert solar["kind"] == "solar_return" and solar["location"]["name"] == "London, UK"
    for missing in ({"kind": "solar_arc"}, {"kind": "solar_return"}, {"kind": "lunar_return", "year": 2026}):
        assert client.post(url, json=missing, headers=ready).status_code == 422

    listed = client.get("/api/v1/charts").json()["data"]
    assert [c["id"] for c in listed] == [natal["id"]]  # derived charts aren't separate entries
    assert {d["id"] for d in listed[0]["derived"]} == {p["id"], solar["id"]}

    again = client.get(f"/api/v1/charts/derived/{p['id']}").json()
    assert again["id"] == p["id"] and again["kind"] == "progressed" and again["parent_id"] == natal["id"]
    assert client.get("/api/v1/charts/derived/nope").status_code == 404


def test_transits_chart(client: TestClient, ready: dict[str, str], fake: FakeEphemeral) -> None:
    """Transits are an ordinary chart for the moment, listed under the chart they're for."""
    natal = make(client, ready)
    url = f"/api/v1/charts/{natal['id']}/derived"
    made = client.post(url, json={"kind": "transits", "date": "2026-11-19", "time": "20:30"}, headers=ready)
    assert made.status_code == 201, made.text
    t = made.json()
    assert t["kind"] == "transits" and t["parent_id"] == natal["id"]
    assert t["reference_date"] == "2026-11-19 20:30" and t["points"]["sun"]
    assert t["name"].startswith("Transits 2026-11-19 20:30")
    entry = fake.account[t["id"]]
    assert entry["type"] == "derived" and entry["parent_uuid"] == natal["id"]
    again = client.get(f"/api/v1/charts/derived/{t['id']}").json()
    assert again["kind"] == "transits" and again["parent_id"] == natal["id"]
    listed = client.get("/api/v1/charts").json()["data"]
    assert [c["id"] for c in listed] == [natal["id"]]
    assert t["id"] in {d["id"] for d in listed[0]["derived"]}
    assert client.post(url, json={"kind": "transits"}, headers=ready).status_code == 422
