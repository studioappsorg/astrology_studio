"""
AstrologyStudio ·
server/tests/test_foundation.py

Tests:

health, the owner and users, the ephemeralREST connection, sign-in, and preferences.

Copyright (c) 2026 Gavin Melhuish
MIT License; see LICENSE in the project root.
SPDX-License-Identifier: MIT
"""

from __future__ import annotations

from fastapi.testclient import TestClient

from astrologystudio import catalog
from astrologystudio.config import Settings

from .conftest import PASSWORD
from .fake_ephemeral import GOOD_KEY


def test_health(client: TestClient) -> None:
    assert client.get("/api/v1/health").json()["status"] == "ok"


def test_first_account_is_owner(client: TestClient, owner: dict[str, str]) -> None:
    me = client.get("/api/v1/auth/me").json()
    assert me["user"]["is_owner"] is True
    assert client.get("/api/v1/auth/status").json()["setup_required"] is False


def test_only_owner_manages_users(client: TestClient, owner: dict[str, str]) -> None:
    added = client.post(
        "/api/v1/users", json={"name": "Ann", "email": "ann@example.com", "password": PASSWORD}, headers=owner
    )
    assert added.status_code == 201
    assert added.json()["is_owner"] is False
    client.post("/api/v1/auth/logout", headers=owner)
    login = client.post("/api/v1/auth/login", json={"email": "ann@example.com", "password": PASSWORD})
    ann = {"X-CSRF-Token": login.json()["csrf_token"]}
    refused = client.post(
        "/api/v1/users", json={"name": "Bob", "email": "bob@example.com", "password": PASSWORD}, headers=ann
    )
    assert refused.status_code == 403
    assert client.get("/api/v1/users", headers=ann).status_code == 403
    assert client.put("/api/v1/connection", json={"url": "http://x.test"}, headers=ann).status_code == 403


def test_connection_uses_environment_default(client: TestClient, owner: dict[str, str]) -> None:
    body = client.get("/api/v1/connection").json()
    assert body == {"url": "http://ephemeral.test", "reachable": True, "problem": None}


def test_set_connection_checks_address(client: TestClient, owner: dict[str, str]) -> None:
    bad = client.put("/api/v1/connection", json={"url": "ephemeral.test"}, headers=owner)
    assert bad.status_code == 422
    good = client.put("/api/v1/connection", json={"url": "https://api.example.test/"}, headers=owner)
    assert good.json()["url"] == "https://api.example.test"


def test_key_is_checked_and_stored_encrypted(
    client: TestClient, owner: dict[str, str], settings: Settings
) -> None:
    wrong = client.put("/api/v1/account/ephemeral-key", json={"api_key": "eph_wrong_key"}, headers=owner)
    assert wrong.status_code == 424
    assert wrong.json()["type"].endswith("ephemeral-key-rejected")
    saved = client.put("/api/v1/account/ephemeral-key", json={"api_key": GOOD_KEY}, headers=owner)
    assert saved.status_code == 200
    assert saved.json()["identity"]["name"] == "Test Person"
    assert GOOD_KEY.encode() not in settings.database_path.read_bytes()
    assert client.get("/api/v1/account/ephemeral-key").json()["prefix"] == GOOD_KEY[:8]
    assert client.delete("/api/v1/account/ephemeral-key", headers=owner).status_code == 204
    assert client.get("/api/v1/account/ephemeral-key").json() == {"configured": False}


def test_changes_need_csrf_token(client: TestClient, owner: dict[str, str]) -> None:
    response = client.patch("/api/v1/preferences/view", json={"features": {"harmonics": False}})
    assert response.status_code == 403


def test_switches_default_and_merge(client: TestClient, owner: dict[str, str]) -> None:
    view = client.get("/api/v1/preferences/view").json()
    assert view["features"] == catalog.default_features()
    assert view["bodies"]["true_node"] is False
    changed = client.patch(
        "/api/v1/preferences/view",
        json={"features": {"harmonics": True}, "bodies": {"true_node": True}},
        headers=owner,
    ).json()
    assert changed["features"]["harmonics"] is True
    assert changed["features"]["dials"] is False
    assert changed["bodies"]["true_node"] is True
    unknown = client.patch("/api/v1/preferences/view", json={"features": {"tarot": True}}, headers=owner)
    assert unknown.status_code == 422


def test_aspect_colours(client: TestClient, owner: dict[str, str]) -> None:
    assert client.get("/api/v1/preferences/view").json()["aspect_colours"] == {}
    url = "/api/v1/preferences/view"
    changed = client.patch(url, json={"aspect_colours": {"trine": "#00AA44"}}, headers=owner).json()
    assert changed["aspect_colours"] == {"trine": "#00aa44"}
    for bad in ({"tarot": "#000000"}, {"trine": "green"}, {"trine": "#12345"}):
        assert client.patch(url, json={"aspect_colours": bad}, headers=owner).status_code == 422
    back = client.patch(url, json={"aspect_colours": {"trine": None}}, headers=owner).json()
    assert back["aspect_colours"] == {}
    client.patch(url, json={"aspect_colours": {"square": "#ff0000"}}, headers=owner)
    assert client.patch(url, json={"reset": True}, headers=owner).json()["aspect_colours"] == {}


def test_catalog_lists_every_body(client: TestClient, owner: dict[str, str]) -> None:
    listed = client.get("/api/v1/preferences/catalog").json()
    assert {b["key"] for b in listed["bodies"]} == catalog.BODY_KEYS


def test_display_and_reset(client: TestClient, owner: dict[str, str]) -> None:
    view = client.get("/api/v1/preferences/view").json()
    assert view["display"] == {"glyphs": "symbols", "colours": "studio", "school": "self"}
    changed = client.patch(
        "/api/v1/preferences/view",
        json={"display": {"glyphs": "letters"}, "features": {"dials": True}},
        headers=owner,
    ).json()
    assert changed["display"]["glyphs"] == "letters" and changed["features"]["dials"] is True
    bad = client.patch("/api/v1/preferences/view", json={"display": {"glyphs": "runes"}}, headers=owner)
    assert bad.status_code == 422
    reset = client.patch("/api/v1/preferences/view", json={"reset": True}, headers=owner).json()
    assert reset["display"]["glyphs"] == "symbols" and reset["features"]["dials"] is False
