"""
AstrologyStudio ·
server/tests/test_register.py

Registering through ephemeralREST, and logging in with its email, password and emailed code.

Copyright (c) 2026 Gavin Melhuish
MIT License; see LICENSE in the project root.
SPDX-License-Identifier: MIT
"""

from __future__ import annotations

from fastapi.testclient import TestClient

from .conftest import PASSWORD
from .fake_ephemeral import GOOD_KEY, FakeEphemeral

NEW = "new.person@example.com"
SECRET = "a long new password"


def open_registration(client: TestClient, owner: dict[str, str], fake: FakeEphemeral) -> None:
    client.put("/api/v1/connection", json={"url": "http://ephemeral.test"}, headers=owner)
    assert client.put("/api/v1/auth/registration", json={"open": True}, headers=owner).status_code == 200
    client.post("/api/v1/auth/logout", headers=owner)


def test_closed_by_default(client: TestClient, owner: dict[str, str], fake: FakeEphemeral) -> None:
    client.put("/api/v1/connection", json={"url": "http://ephemeral.test"}, headers=owner)
    client.post("/api/v1/auth/logout", headers=owner)
    assert client.get("/api/v1/auth/status").json()["registration_open"] is False
    response = client.post("/api/v1/auth/register", json={"name": "New", "email": NEW})
    assert response.status_code == 403
    assert ("POST", "/register") not in fake.calls
    # Nor can an ephemeralREST account sign in to make one.
    fake.registered[NEW] = {"name": "New", "verified": True, "password": SECRET}
    assert client.post("/api/v1/auth/login", json={"email": NEW, "password": SECRET}).status_code == 401
    assert ("POST", "/login") not in fake.calls


def test_register_then_log_in_with_code(
    client: TestClient, owner: dict[str, str], fake: FakeEphemeral
) -> None:
    open_registration(client, owner, fake)
    assert client.get("/api/v1/auth/status").json()["registration_open"] is True
    response = client.post("/api/v1/auth/register", json={"name": "New Person", "email": NEW.upper()})
    assert response.status_code == 202 and response.json() == {"email": NEW, "flow": "portal"}
    assert fake.bodies[-1] == {"name": "New Person", "email": NEW}

    # Before the emailed links are followed, ephemeralREST refuses the login.
    early = client.post("/api/v1/auth/login", json={"email": NEW, "password": SECRET})
    assert early.status_code == 401 and "second email" in early.json()["detail"]

    fake.verify(NEW, SECRET)
    first = client.post("/api/v1/auth/login", json={"email": NEW, "password": SECRET})
    assert first.status_code == 200 and first.json() == {"two_factor": True, "email": NEW}
    assert client.get("/api/v1/auth/me").status_code == 401  # not logged in yet

    wrong = client.post("/api/v1/auth/login/code", json={"email": NEW, "code": "000000"})
    assert wrong.status_code == 401 and wrong.json()["type"].endswith("/bad-code")
    done = client.post("/api/v1/auth/login/code", json={"email": NEW, "code": "123456"})
    assert done.status_code == 200, done.text
    me = done.json()["user"]
    assert me["email"] == NEW and me["name"] == "New Person" and me["signs_in_with"] == "ephemeral"
    assert me["is_owner"] is False
    key = client.get("/api/v1/account/ephemeral-key").json()
    assert key["configured"] is True and key["prefix"] == GOOD_KEY[:8]
    # Their password lives in ephemeralREST, so it can't be changed here.
    headers = {"X-CSRF-Token": done.json()["csrf_token"]}
    change = client.post(
        "/api/v1/auth/password", json={"current_password": SECRET, "new_password": "x" * 20}, headers=headers
    )
    assert change.status_code == 409


def test_remembered_device_skips_the_code(
    client: TestClient, owner: dict[str, str], fake: FakeEphemeral
) -> None:
    open_registration(client, owner, fake)
    client.post("/api/v1/auth/register", json={"name": "New Person", "email": NEW})
    fake.verify(NEW, SECRET)
    client.post("/api/v1/auth/login", json={"email": NEW, "password": SECRET})
    done = client.post("/api/v1/auth/login/code", json={"email": NEW, "code": "123456", "remember": True})
    assert done.status_code == 200 and client.cookies.get("as_device") == "device-1"
    client.post("/api/v1/auth/logout", headers={"X-CSRF-Token": done.json()["csrf_token"]})
    again = client.post("/api/v1/auth/login", json={"email": NEW, "password": SECRET})
    assert again.status_code == 200 and again.json()["user"]["email"] == NEW  # straight in, no code

    # Existing ephemeralREST accounts keep working after the owner closes registration.
    client.post("/api/v1/auth/logout", headers={"X-CSRF-Token": again.json()["csrf_token"]})
    owner_again = client.post("/api/v1/auth/login", json={"email": "owner@example.com", "password": PASSWORD})
    assert owner_again.status_code == 200  # the owner still signs in with the password kept here
    csrf = {"X-CSRF-Token": owner_again.json()["csrf_token"]}
    client.put("/api/v1/auth/registration", json={"open": False}, headers=csrf)
    client.post("/api/v1/auth/logout", headers=csrf)
    assert client.post("/api/v1/auth/login", json={"email": NEW, "password": SECRET}).status_code == 200


def test_only_the_owner_opens_registration(client: TestClient, owner: dict[str, str]) -> None:
    client.post("/api/v1/auth/logout", headers=owner)
    assert client.put("/api/v1/auth/registration", json={"open": True}).status_code in (401, 403)


def test_hosted_flag(tmp_path, fake: FakeEphemeral) -> None:  # type: ignore[no-untyped-def]
    from astrologystudio.app import create_app
    from astrologystudio.config import Settings

    app = create_app(
        Settings(data_dir=tmp_path / "hosted", ephemeral_url="http://ephemeral.test", hosted=True)
    )
    app.state.ephemeral_transport = fake.transport
    with TestClient(app) as hosted:
        assert hosted.get("/api/v1/auth/status").json()["hosted"] is True


def test_not_hosted_by_default(client: TestClient) -> None:
    assert client.get("/api/v1/auth/status").json()["hosted"] is False
