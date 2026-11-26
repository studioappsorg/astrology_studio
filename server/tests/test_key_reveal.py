"""
AstrologyStudio ·
server/tests/test_key_reveal.py

Show my key and Replace my key, and confirming it's you before either.

Copyright (c) 2026 Gavin Melhuish
MIT License; see LICENSE in the project root.
SPDX-License-Identifier: MIT
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from astrologystudio.config import Settings
from astrologystudio.db import connect

from .conftest import PASSWORD
from .fake_ephemeral import GOOD_KEY, FakeEphemeral

EPH = "eph@example.com"
SECRET = "a good long password"


def _confirm(client: TestClient, headers: dict[str, str], password: str = PASSWORD) -> int:
    return client.post("/api/v1/account/reauth", json={"password": password}, headers=headers).status_code


def test_show_my_key_needs_a_fresh_check(
    client: TestClient, ready: dict[str, str], fake: FakeEphemeral
) -> None:
    refused = client.post("/api/v1/account/ephemeral-key/reveal", headers=ready)
    assert refused.status_code == 403 and refused.json()["type"].endswith("/reauth-needed")
    assert _confirm(client, ready, "wrong") == 422
    assert _confirm(client, ready) == 200
    assert client.get("/api/v1/account/reauth", headers=ready).json()["confirmed"] is True
    before = len(fake.calls)
    shown = client.post("/api/v1/account/ephemeral-key/reveal", headers=ready)
    assert shown.status_code == 200 and shown.json() == {"api_key": GOOD_KEY}
    assert shown.headers["cache-control"] == "no-store"
    assert fake.calls[before:] == [], "decrypted here, not fetched"
    events = client.get("/api/v1/account/activity", headers=ready).json()["data"]
    assert (events[0]["event"], events[0]["detail"]) == ("key_shown", GOOD_KEY[:8])
    assert [e["outcome"] for e in events if e["event"] == "reauth"] == ["success", "bad-password"]


def test_the_check_lasts_five_minutes(client: TestClient, ready: dict[str, str], settings: Settings) -> None:
    _confirm(client, ready)
    conn = connect(settings.database_path)
    old = (datetime.now(UTC) - timedelta(minutes=6)).isoformat().replace("+00:00", "Z")
    conn.execute("UPDATE sessions SET reauth_at = ?", (old,))
    assert client.post("/api/v1/account/ephemeral-key/reveal", headers=ready).status_code == 403


def test_five_failures_lock_it(client: TestClient, ready: dict[str, str]) -> None:
    for _ in range(5):
        assert _confirm(client, ready, "wrong") == 422
    assert _confirm(client, ready) == 429, "even the right password, for 15 minutes"


def test_the_check_is_for_this_session_only(client: TestClient, ready: dict[str, str]) -> None:
    _confirm(client, ready)
    other = TestClient(client.app)
    token = other.post(
        "/api/v1/auth/login", json={"email": "owner@example.com", "password": PASSWORD}
    ).json()["csrf_token"]
    assert (
        other.post("/api/v1/account/ephemeral-key/reveal", headers={"X-CSRF-Token": token}).status_code == 403
    )


def test_ephemeral_users_always_give_the_code(
    client: TestClient, ready: dict[str, str], fake: FakeEphemeral
) -> None:
    client.put("/api/v1/auth/registration", json={"open": True}, headers=ready)
    fake.registered[EPH] = {"name": "Eph", "verified": True, "password": SECRET}
    browser = TestClient(client.app)
    browser.post("/api/v1/auth/login", json={"email": EPH, "password": SECRET})
    me = browser.post("/api/v1/auth/login/code", json={"email": EPH, "code": "123456", "remember": True})
    headers = {"X-CSRF-Token": me.json()["csrf_token"]}
    asked = browser.post("/api/v1/account/reauth", json={"password": SECRET}, headers=headers)
    assert asked.json()["two_factor"] is True and asked.json()["confirmed"] is False
    assert "device_token" not in fake.bodies[-1], "a trusted browser still gives the code"
    bad = browser.post("/api/v1/account/reauth/code", json={"code": "999999"}, headers=headers)
    assert bad.status_code == 422
    good = browser.post("/api/v1/account/reauth/code", json={"code": "123456"}, headers=headers)
    assert good.json()["confirmed"] is True
    assert browser.post("/api/v1/account/ephemeral-key/reveal", headers=headers).json()["api_key"] == GOOD_KEY


def test_replace_my_key(client: TestClient, ready: dict[str, str], fake: FakeEphemeral) -> None:
    client.post(
        "/api/v1/charts",
        json={"name": "J", "date": "1985-06-12", "time": "14:30", "place": "Perth"},
        headers=ready,
    )
    client.get("/api/v1/charts", headers=ready)  # cached for the old key
    assert client.post("/api/v1/account/ephemeral-key/replace", headers=ready).status_code == 403
    _confirm(client, ready)
    replaced = client.post("/api/v1/account/ephemeral-key/replace", headers=ready)
    assert replaced.status_code == 200, replaced.text
    new = replaced.json()["api_key"]
    assert new != GOOD_KEY and replaced.json()["prefix"] == new[:8]
    assert replaced.headers["cache-control"] == "no-store"
    assert fake.bodies[-1] == {"email_key": False}
    assert fake.outbox[-1]["key"] is None, "the notice, without the key"
    # Saved: charts now come through the new key (the old cache isn't used).
    before = len(fake.calls)
    listed = client.get("/api/v1/charts", headers=ready)
    assert listed.status_code == 200 and len(fake.calls) > before
    events = client.get("/api/v1/account/activity", headers=ready).json()["data"]
    assert events[0]["event"] == "key_replaced" and events[0]["detail"] == f"{GOOD_KEY[:8]} → {new[:8]}"


def test_when_ephemeralrest_fails_nothing_changes(
    client: TestClient, ready: dict[str, str], fake: FakeEphemeral
) -> None:
    _confirm(client, ready)
    fake.rate_limited = True
    assert client.post("/api/v1/account/ephemeral-key/replace", headers=ready).status_code == 429
    fake.rate_limited = False
    assert client.get("/api/v1/account/ephemeral-key", headers=ready).json()["prefix"] == GOOD_KEY[:8]


def test_when_the_new_key_cant_be_saved(
    client: TestClient, ready: dict[str, str], monkeypatch: pytest.MonkeyPatch
) -> None:
    import sqlite3

    from astrologystudio.api import account

    def broken(*_: object) -> None:
        raise sqlite3.OperationalError("disk I/O error")

    _confirm(client, ready)
    monkeypatch.setattr(account, "store_key", broken)
    response = client.post("/api/v1/account/ephemeral-key/replace", headers=ready)
    assert (
        response.status_code == 500
        and response.json()["detail"] == 'Use "Use my key from another site" to fetch it.'
    )


def test_theres_no_way_to_see_someone_elses_key(client: TestClient) -> None:
    paths = set(client.get("/api/v1/openapi.json").json()["paths"])
    assert not [p for p in paths if p.startswith("/api/v1/users") and ("reveal" in p or "key" in p)]
