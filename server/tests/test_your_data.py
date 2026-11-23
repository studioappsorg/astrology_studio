"""
AstrologyStudio ·
server/tests/test_your_data.py

A copy of your data, and deleting your own account.

Copyright (c) 2026 Gavin Melhuish
MIT License; see LICENSE in the project root.
SPDX-License-Identifier: MIT
"""

from __future__ import annotations

from fastapi.testclient import TestClient

from .conftest import PASSWORD
from .fake_ephemeral import GOOD_KEY, FakeEphemeral
from .test_register import NEW, SECRET, open_registration

API = "/api/v1"
JANE = {"name": "Jane", "date": "1985-06-12", "time": "14:30", "place": "Perth"}


def as_ann(client: TestClient, owner: dict[str, str]) -> dict[str, str]:
    client.post(
        f"{API}/users", json={"name": "Ann", "email": "ann@example.com", "password": PASSWORD}, headers=owner
    )
    client.post(f"{API}/auth/logout", headers=owner)
    login = client.post(f"{API}/auth/login", json={"email": "ann@example.com", "password": PASSWORD})
    headers = {"X-CSRF-Token": login.json()["csrf_token"]}
    client.put(f"{API}/account/ephemeral-key", json={"api_key": GOOD_KEY}, headers=headers)
    return headers


def test_export(client: TestClient, ready: dict[str, str]) -> None:
    chart = client.post(f"{API}/charts", json=JANE, headers=ready).json()
    client.patch(f"{API}/preferences/appearance", json={"text_size": 115}, headers=ready)
    response = client.get(f"{API}/account/export")
    assert response.status_code == 200
    assert "attachment" in response.headers["content-disposition"]
    data = response.json()
    assert data["account"]["email"] == "owner@example.com"
    assert any(c["uuid"] == chart["id"] for c in data["charts"])
    assert data["preferences"]["appearance"]["text_size"] == 115
    assert GOOD_KEY not in response.text


def test_owner_cant_delete_their_account(client: TestClient, owner: dict[str, str]) -> None:
    bad = client.post(f"{API}/account/delete", json={"password": PASSWORD}, headers=owner)
    assert bad.status_code == 409


def test_delete_with_password(client: TestClient, owner: dict[str, str], fake: FakeEphemeral) -> None:
    ann = as_ann(client, owner)
    chart = client.post(f"{API}/charts", json=JANE, headers=ann).json()
    client.patch(f"{API}/preferences/appearance", json={"text_size": 130}, headers=ann)
    wrong = client.post(f"{API}/account/delete", json={"password": "nope"}, headers=ann)
    assert wrong.status_code == 422
    done = client.post(
        f"{API}/account/delete", json={"password": PASSWORD, "remove_charts": True}, headers=ann
    )
    assert done.status_code == 204
    assert chart["id"] not in fake.account  # taken off their ephemeralREST list
    assert client.get(f"{API}/auth/me").status_code == 401
    gone = client.post(f"{API}/auth/login", json={"email": "ann@example.com", "password": PASSWORD})
    assert gone.status_code == 401


def test_delete_ephemeral_account_keeps_charts_unless_asked(
    client: TestClient, owner: dict[str, str], fake: FakeEphemeral
) -> None:
    open_registration(client, owner, fake)
    client.post(f"{API}/auth/register", json={"name": "New Person", "email": NEW})
    fake.verify(NEW, SECRET)
    client.post(f"{API}/auth/login", json={"email": NEW, "password": SECRET})
    done = client.post(f"{API}/auth/login/code", json={"email": NEW, "code": "123456"})
    headers = {"X-CSRF-Token": done.json()["csrf_token"]}
    chart = client.post(f"{API}/charts", json=JANE, headers=headers).json()
    assert (
        client.post(f"{API}/account/delete", json={"email": "someone@else"}, headers=headers).status_code
        == 422
    )
    gone = client.post(f"{API}/account/delete", json={"email": NEW.upper()}, headers=headers)
    assert gone.status_code == 204
    assert chart["id"] in fake.account  # charts stay in their ephemeralREST list
