"""
AstrologyStudio ·
server/tests/test_branding.py

Tests:

the owner's business details and logo: setting, replacing and removing them, refusing files that
aren't images or are too big, and that everyone can see them but only the owner can change them.

Copyright (c) 2026 Gavin Melhuish
MIT License; see LICENSE in the project root.
SPDX-License-Identifier: MIT
"""

from __future__ import annotations

import base64

from fastapi.testclient import TestClient

from astrologystudio.api.branding import MAX_BYTES

from .conftest import PASSWORD

URL = "/api/v1/branding"
PNG = "data:image/png;base64," + base64.b64encode(b"\x89PNG\r\n\x1a\n" + b"\0" * 32).decode()
SVG = "data:image/svg+xml;base64," + base64.b64encode(b'<svg xmlns="http://www.w3.org/2000/svg"/>').decode()


def test_set_replace_and_remove(client: TestClient, owner: dict[str, str]) -> None:
    assert client.get(URL).json() == {"logo": None, "details": ""}
    assert client.put(f"{URL}/logo", json={"data_url": PNG}, headers=owner).json()["logo"] == PNG
    assert client.get(URL).json() == {"logo": PNG, "details": ""}
    client.put(f"{URL}/logo", json={"data_url": SVG}, headers=owner)
    assert client.get(URL).json()["logo"] == SVG
    assert client.delete(f"{URL}/logo", headers=owner).status_code == 204
    assert client.get(URL).json() == {"logo": None, "details": ""}


def test_refuses_what_isnt_a_logo(client: TestClient, owner: dict[str, str]) -> None:
    def put(data_url: str) -> int:
        return client.put(f"{URL}/logo", json={"data_url": data_url}, headers=owner).status_code

    assert put("data:text/html;base64,PGgxPg==") == 422
    assert put("data:image/png;base64,bm90IGEgcG5n") == 422  # says PNG, isn't
    assert put("data:image/svg+xml;base64," + base64.b64encode(b"<html></html>").decode()) == 422
    assert put("data:image/png;base64,***") == 422
    big = base64.b64encode(b"\x89PNG\r\n\x1a\n" + b"\0" * MAX_BYTES).decode()
    assert put("data:image/png;base64," + big) == 422
    assert client.get(URL).json()["logo"] is None


def test_business_details(client: TestClient, owner: dict[str, str]) -> None:
    text = "Starlight Astrology  \r\nJane Smith, consulting astrologer\n0400 000 000\n\n"
    saved = client.put(f"{URL}/details", json={"details": text}, headers=owner).json()
    expected = "Starlight Astrology\nJane Smith, consulting astrologer\n0400 000 000"
    assert saved == {"logo": None, "details": expected}
    # The logo and the details are kept and removed independently.
    client.put(f"{URL}/logo", json={"data_url": PNG}, headers=owner)
    client.delete(f"{URL}/logo", headers=owner)
    assert client.get(URL).json()["details"].startswith("Starlight Astrology")
    client.put(f"{URL}/logo", json={"data_url": PNG}, headers=owner)
    client.put(f"{URL}/details", json={"details": ""}, headers=owner)
    assert client.get(URL).json() == {"logo": PNG, "details": ""}
    assert client.put(f"{URL}/details", json={"details": "x" * 1001}, headers=owner).status_code == 422


def test_everyone_sees_it_only_the_owner_changes_it(client: TestClient, owner: dict[str, str]) -> None:
    client.put(f"{URL}/logo", json={"data_url": PNG}, headers=owner)
    client.post(
        "/api/v1/users", json={"name": "Ann", "email": "ann@example.com", "password": PASSWORD}, headers=owner
    )
    client.post("/api/v1/auth/logout", headers=owner)
    assert client.get(URL).status_code == 401
    login = client.post("/api/v1/auth/login", json={"email": "ann@example.com", "password": PASSWORD})
    ann = {"X-CSRF-Token": login.json()["csrf_token"]}
    assert client.get(URL).json()["logo"] == PNG
    assert client.put(f"{URL}/logo", json={"data_url": SVG}, headers=ann).status_code == 403
    assert client.put(f"{URL}/details", json={"details": "Ann's"}, headers=ann).status_code == 403
    assert client.delete(f"{URL}/logo", headers=ann).status_code == 403
    assert client.get(URL).json() == {"logo": PNG, "details": ""}
