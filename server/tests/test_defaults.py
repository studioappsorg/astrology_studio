"""
AstrologyStudio ·
server/tests/test_defaults.py

1.15: a default house system and place, profiles that follow the default, and charts with their
own house system.

Copyright (c) 2026 Gavin Melhuish
MIT License; see LICENSE in the project root.
SPDX-License-Identifier: MIT
"""

from fastapi.testclient import TestClient

from astrologystudio import preferences as prefs
from astrologystudio.config import Settings
from astrologystudio.db import connect

from .fake_ephemeral import FakeEphemeral
from .test_charts import make

URL = "/api/v1/preferences/defaults"


def test_defaults(client: TestClient, ready: dict[str, str]) -> None:
    assert client.get(URL).json() == {"house_system": "placidus", "place": ""}
    changed = client.put(URL, json={"house_system": "koch", "place": "London, UK"}, headers=ready).json()
    assert changed == {"house_system": "koch", "place": "London, UK"}
    assert client.put(URL, json={"place": ""}, headers=ready).json() == {"house_system": "koch", "place": ""}
    assert client.put(URL, json={"house_system": "nonsense"}, headers=ready).status_code == 422
    calc = client.get("/api/v1/preferences/calculation").json()
    assert calc["defaults"]["house_system"] == "koch"


def test_profiles_follow_the_default(client: TestClient, ready: dict[str, str]) -> None:
    calc = client.get("/api/v1/preferences/calculation").json()
    assert calc["profiles"][0]["house_system"] is None  # follows the default
    client.put(URL, json={"house_system": "koch"}, headers=ready)
    assert make(client, ready)["house_system"] == "koch"
    # A profile with its own house system keeps it; "" goes back to the default.
    client.patch("/api/v1/preferences/calculation", json={"house_system": "equal"}, headers=ready)
    assert make(client, ready)["house_system"] == "equal"
    back = client.patch("/api/v1/preferences/calculation", json={"house_system": ""}, headers=ready).json()
    assert back["profiles"][0]["house_system"] is None
    assert make(client, ready)["house_system"] == "koch"


def test_old_placidus_profiles_follow_the_default(
    client: TestClient, ready: dict[str, str], settings: Settings
) -> None:
    """Before 1.15 every profile had Placidus unless changed: those now follow the default."""
    conn = connect(settings.database_path)
    user = conn.execute("SELECT id FROM users").fetchone()["id"]
    old = {
        "active": "standard",
        "profiles": [
            {**prefs.default_profile(), "house_system": "placidus"},
            {**prefs.default_profile(), "id": "whole", "name": "Hellenistic", "house_system": "whole_sign"},
        ],
    }
    prefs.put(conn, user, "calculation", old)
    calc = prefs.calculation(conn, user)
    assert [p["house_system"] for p in calc["profiles"]] == [None, "whole_sign"]
    # Saved again, an explicit Placidus stays explicit.
    calc["profiles"][0]["house_system"] = "placidus"
    prefs.save_calculation(conn, user, calc)
    assert prefs.calculation(conn, user)["profiles"][0]["house_system"] == "placidus"


def test_a_chart_with_its_own_house_system(client: TestClient, ready: dict[str, str]) -> None:
    own = make(client, ready, house_system="regiomontanus")
    assert own["house_system"] == "regiomontanus" and own["note"]["house_system"] == "regiomontanus"
    assert client.get(f"/api/v1/charts/{own['id']}").json()["house_system"] == "regiomontanus"
    plain = make(client, ready)
    assert plain["house_system"] == "placidus" and plain["note"]["house_system"] == ""
    # Changing it recalculates the houses only.
    changed = client.patch(
        f"/api/v1/charts/{plain['id']}", json={"house_system": "koch"}, headers=ready
    ).json()
    assert changed["house_system"] == "koch" and changed["note"]["house_system"] == "koch"
    assert changed["points"]["sun"]["lon"] == plain["points"]["sun"]["lon"]
    reset = client.patch(f"/api/v1/charts/{plain['id']}", json={"house_system": ""}, headers=ready).json()
    assert reset["house_system"] == "placidus" and reset["note"]["house_system"] == ""
    assert client.post("/api/v1/charts", json={"house_system": "bogus"}, headers=ready).status_code == 422


def test_transits_and_returns_for_the_default_place(
    client: TestClient, ready: dict[str, str], fake: FakeEphemeral
) -> None:
    natal = make(client, ready)  # born in Perth
    url = f"/api/v1/charts/{natal['id']}/derived"
    before = client.post(url, json={"kind": "transits", "date": "2026-11-19"}, headers=ready).json()
    assert before["location"]["name"].startswith("Perth")
    client.put(URL, json={"place": "London, UK"}, headers=ready)
    after = client.post(url, json={"kind": "transits", "date": "2026-11-19"}, headers=ready).json()
    assert after["location"]["name"].startswith("London")
    sr = client.post(url, json={"kind": "solar_return", "year": 2026}, headers=ready).json()
    assert sr["location"]["name"].startswith("London")
    # Progressions stay where the person was born.
    prog = client.post(url, json={"kind": "progressed", "date": "2026-11-19"}, headers=ready).json()
    assert not prog["location"]["name"].startswith("London")
    # A place given beats the default.
    there = client.post(
        url, json={"kind": "transits", "date": "2026-11-19", "place": "Perth WA, Australia"}, headers=ready
    )
    assert there.json()["location"]["name"].startswith("Perth")
