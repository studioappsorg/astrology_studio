"""
AstrologyStudio ·
server/tests/test_views.py

Views kept per chart (1.11).

Copyright (c) 2026 Gavin Melhuish
MIT License; see LICENSE in the project root.
SPDX-License-Identifier: MIT
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from astrologystudio.api import preferences as api_prefs

URL = "/api/v1/preferences/chart-views"


def view(id_: str, **extra: object) -> dict[str, object]:
    return {"id": id_, "display": "wheel", "dial_size": 90, "report": "chart", **extra}


def test_none_until_kept(client: TestClient, owner: dict[str, str]) -> None:
    assert client.get(f"{URL}/c1").json() is None


def test_keep_and_read_back(client: TestClient, owner: dict[str, str]) -> None:
    body = {
        "views": [
            view("v1", name="Western"),
            view("v2", display="dial", dial_size=45, report="midpoints", pointer=12.5),
            view("v3", partner={"id": "c2", "derived": False}, between=True, selected=1),
        ],
        "active": "v2",
    }
    kept = client.put(f"{URL}/c1", json=body, headers=owner)
    assert kept.status_code == 200, kept.text
    back = client.get(f"{URL}/c1").json()
    assert back["active"] == "v2"
    assert [v["id"] for v in back["views"]] == ["v1", "v2", "v3"]
    assert back["views"][1]["dial_size"] == 45 and back["views"][1]["pointer"] == 12.5
    assert back["views"][2]["partner"] == {"id": "c2", "derived": False, "parent": None}
    # An unknown active view falls back to the first.
    assert client.put(f"{URL}/c1", json={**body, "active": "gone"}, headers=owner).json()["active"] == "v1"
    assert client.delete(f"{URL}/c1", headers=owner).status_code == 204
    assert client.get(f"{URL}/c1").json() is None


def test_checks(client: TestClient, owner: dict[str, str]) -> None:
    def put(body: object) -> int:
        return client.put(f"{URL}/c1", json=body, headers=owner).status_code

    assert put({"views": [], "active": "v1"}) == 422
    assert put({"views": [view(f"v{i}") for i in range(7)], "active": "v1"}) == 422  # at most 6
    assert put({"views": [view("v1"), view("v1")], "active": "v1"}) == 422  # ids unique
    assert put({"views": [view("v1", display="tarot")], "active": "v1"}) == 422
    assert put({"views": [view("v1", dial_size=7)], "active": "v1"}) == 422  # must divide 360
    assert put({"views": [view("v1", pointer=360)], "active": "v1"}) == 422
    assert put({"views": [view("v1", colour="red")], "active": "v1"}) == 422  # unknown field


def test_only_recent_charts_keep_views(
    client: TestClient, owner: dict[str, str], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(api_prefs, "CHART_VIEWS_KEPT", 3)
    for i in range(5):
        client.put(f"{URL}/c{i}", json={"views": [view("v1")], "active": "v1"}, headers=owner)
    kept = [client.get(f"{URL}/c{i}").json() is not None for i in range(5)]
    assert kept == [False, False, True, True, True]
