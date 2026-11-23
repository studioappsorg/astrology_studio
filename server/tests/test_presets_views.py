"""
AstrologyStudio ·
server/tests/test_presets_views.py

Presets as sets of views (1.12).

Copyright (c) 2026 Gavin Melhuish
MIT License; see LICENSE in the project root.
SPDX-License-Identifier: MIT
"""

from __future__ import annotations

from fastapi.testclient import TestClient

from astrologystudio import appearance as look

P = "/api/v1/preferences/presets"


def made(client: TestClient, owner: dict[str, str], body: dict[str, object]) -> dict[str, object]:
    response = client.post(P, json=body, headers=owner)
    assert response.status_code == 201, response.text
    data = response.json()
    return next(x for x in data["presets"] if x["id"] == data["created"])


def test_a_set_of_views(client: TestClient, owner: dict[str, str]) -> None:
    preset = made(
        client,
        owner,
        {
            "name": "Full reading",
            "views": [
                {"display": "wheel"},
                {"display": "dial", "dial_size": 45, "report": "midpoints"},
                {"display": "wheel", "partner": {"role": "transits_now"}, "report": "aspects", "between": 1},
                {"display": "wheel", "partner": {"role": "fixed", "chart": {"id": "c9"}, "chart_name": "E"}},
            ],
        },
    )
    views = preset["views"]
    assert isinstance(views, list) and len(views) == 4
    assert views[1]["dial_size"] == 45 and views[1]["report"] == "midpoints"
    assert views[2]["partner"] == {"role": "transits_now"} and views[2]["between"] is True
    assert views[3]["partner"]["chart"]["id"] == "c9" and views[3]["partner"]["chart_name"] == "E"
    # The first view is also given in the pre-1.12 shape.
    assert preset["display"] == "wheel"
    assert preset["panel"] == {"aspectarian": False, "trees": False, "timing": False}


def test_old_shape_still_works(client: TestClient, owner: dict[str, str]) -> None:
    preset = made(
        client, owner, {"name": "Dials", "display": "dial", "dial_size": 45, "panel": {"trees": True}}
    )
    assert preset["views"] == [
        {
            "name": None,
            "display": "dial",
            "dial_size": 45,
            "layout": None,
            "report": "midpoints",
            "between": False,
            "partner": {"role": "none"},
        }
    ]
    # Changing the old fields changes the first view only.
    pid = preset["id"]
    two = client.patch(
        f"{P}/{pid}", json={"views": [preset["views"][0], {"display": "wheel"}]}, headers=owner
    ).json()
    back = client.patch(f"{P}/{pid}", json={"display": "hellenistic"}, headers=owner).json()
    assert len(next(x for x in two["presets"] if x["id"] == pid)["views"]) == 2
    views = next(x for x in back["presets"] if x["id"] == pid)["views"]
    assert [v["display"] for v in views] == ["hellenistic", "wheel"]


def test_checks(client: TestClient, owner: dict[str, str]) -> None:
    def status(body: dict[str, object]) -> int:
        return client.post(P, json={"name": "x", **body}, headers=owner).status_code

    assert status({}) == 422  # needs views or a chart type
    assert status({"views": []}) == 422
    assert status({"views": [{"display": "wheel"}] * 7}) == 422  # at most 6
    assert status({"views": [{"display": "dial", "dial_size": 50}]}) == 422
    assert status({"views": [{"display": "wheel", "partner": {"role": "fixed"}}]}) == 422
    assert status({"views": [{"display": "wheel", "partner": {"role": "tarot"}}]}) == 422


def test_stored_presets_from_before() -> None:
    old = {"id": "p1", "name": "Old", "display": "wheel", "layout": "wheel:x", "panel": {"aspectarian": True}}
    clean = look.clean_preset(old)
    assert clean["views"][0]["report"] == "aspects" and clean["views"][0]["layout"] == "wheel:x"


def test_order(client: TestClient, owner: dict[str, str]) -> None:
    ids = [made(client, owner, {"name": n, "views": [{"display": "wheel"}]})["id"] for n in ("A", "B", "C")]
    ordered = client.put(
        "/api/v1/preferences/presets-order", json={"ids": [ids[2], ids[0], "gone"]}, headers=owner
    ).json()
    assert [p["name"] for p in ordered["presets"]] == ["C", "A", "B"]
