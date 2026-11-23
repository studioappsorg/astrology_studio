"""
AstrologyStudio ·
server/tests/test_remembered.py

Remembered screen choices are kept per person, so they follow them to any browser.

Copyright (c) 2026 Gavin Melhuish
MIT License; see LICENSE in the project root.
SPDX-License-Identifier: MIT
"""

from __future__ import annotations

from fastapi.testclient import TestClient

from .conftest import PASSWORD


def test_remembered_choices_are_per_person(client: TestClient, owner: dict[str, str]) -> None:
    assert client.get("/api/v1/preferences/remembered").json() == {"values": {}}
    saved = client.patch(
        "/api/v1/preferences/remembered",
        json={"values": {"theme": "dark", "wheel-slots": [{"kind": "saved", "id": "x"}, None, None]}},
        headers=owner,
    )
    assert saved.status_code == 200
    assert saved.json()["values"]["theme"] == "dark"
    forgot = client.patch("/api/v1/preferences/remembered", json={"values": {"theme": None}}, headers=owner)
    assert "theme" not in forgot.json()["values"]
    assert "wheel-slots" in forgot.json()["values"]

    client.post(
        "/api/v1/users", json={"name": "Ann", "email": "ann@example.com", "password": PASSWORD}, headers=owner
    )
    client.post("/api/v1/auth/logout", headers=owner)
    client.post("/api/v1/auth/login", json={"email": "ann@example.com", "password": PASSWORD})
    assert client.get("/api/v1/preferences/remembered").json() == {"values": {}}


def test_remembered_choices_are_checked(client: TestClient, owner: dict[str, str]) -> None:
    bad_key = client.patch("/api/v1/preferences/remembered", json={"values": {"No Spaces": 1}}, headers=owner)
    assert bad_key.status_code == 422
    too_big = client.patch(
        "/api/v1/preferences/remembered", json={"values": {"big": "x" * 5000}}, headers=owner
    )
    assert too_big.status_code == 422
