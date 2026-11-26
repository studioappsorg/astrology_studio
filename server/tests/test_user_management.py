"""
AstrologyStudio ·
server/tests/test_user_management.py

The owner's user management: switching accounts off and on, limits on calls to ephemeralREST,
and the activity log.

Copyright (c) 2026 Gavin Melhuish
MIT License; see LICENSE in the project root.
SPDX-License-Identifier: MIT
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

import pytest
from fastapi.testclient import TestClient

from astrologystudio import audit, limits
from astrologystudio.config import Settings
from astrologystudio.db import connect

from .conftest import PASSWORD
from .fake_ephemeral import GOOD_KEY, FakeEphemeral

ANN = "ann@example.com"
EPH = "eph@example.com"
SECRET = "a good long password"
BIRTH = {"name": "Jane", "date": "1985-06-12", "time": "14:30", "place": "Perth"}


def _login(client: TestClient, email: str = ANN) -> dict[str, str]:
    response = client.post("/api/v1/auth/login", json={"email": email, "password": PASSWORD})
    assert response.status_code == 200, response.text
    return {"X-CSRF-Token": response.json()["csrf_token"]}


@pytest.fixture
def ann(client: TestClient, ready: dict[str, str]) -> tuple[str, TestClient, dict[str, str]]:
    """Ann, a password user with a key, logged in on a browser of her own."""
    made = client.post(
        "/api/v1/users", json={"name": "Ann", "email": ANN, "password": PASSWORD}, headers=ready
    )
    browser = TestClient(client.app)
    headers = _login(browser)
    assert (
        browser.put("/api/v1/account/ephemeral-key", json={"api_key": GOOD_KEY}, headers=headers).status_code
        == 200
    )
    return made.json()["id"], browser, headers


@pytest.fixture
def eph_user(client: TestClient, ready: dict[str, str], fake: FakeEphemeral) -> str:
    """Someone who signs in through ephemeralREST, with a trusted browser cookie."""
    client.put("/api/v1/auth/registration", json={"open": True}, headers=ready)
    fake.registered[EPH] = {"name": "Eph", "verified": True, "password": SECRET}
    browser = TestClient(client.app)
    browser.post("/api/v1/auth/login", json={"email": EPH, "password": SECRET})
    done = browser.post("/api/v1/auth/login/code", json={"email": EPH, "code": "123456", "remember": True})
    assert done.status_code == 200
    return str(done.json()["user"]["id"])


# ---------------------------------------------------------------------------
# Switching off and on


def test_switching_off_ends_sessions_and_stops_every_login(
    client: TestClient,
    ready: dict[str, str],
    ann: tuple[str, TestClient, dict[str, str]],
    fake: FakeEphemeral,
) -> None:
    user_id, browser, _headers = ann
    off = client.put(
        f"/api/v1/users/{user_id}/status", json={"enabled": False, "reason": "spam"}, headers=ready
    )
    assert off.status_code == 200 and off.json()["disabled"] and off.json()["disabled_reason"] == "spam"
    assert browser.get("/api/v1/auth/me").status_code == 401, "the session ended straight away"
    refused = browser.post("/api/v1/auth/login", json={"email": ANN, "password": PASSWORD})
    assert (
        refused.status_code == 403
        and refused.json()["detail"] == "This account is switched off. Contact the site's owner."
    )
    assert "spam" not in refused.text, "the reason is only for the owner"
    # Charts and key are untouched.
    assert client.get(f"/api/v1/users/{user_id}", headers=ready).json()["key_prefix"] == GOOD_KEY[:8]
    on = client.put(f"/api/v1/users/{user_id}/status", json={"enabled": True}, headers=ready)
    assert on.json()["disabled"] is False and on.json()["disabled_reason"] is None
    _login(browser)


def test_ephemeral_logins_are_refused_before_ephemeralrest_is_asked(
    client: TestClient, ready: dict[str, str], eph_user: str, fake: FakeEphemeral
) -> None:
    client.put(f"/api/v1/users/{eph_user}/status", json={"enabled": False}, headers=ready)
    browser = TestClient(client.app)
    before = len(fake.calls)
    assert browser.post("/api/v1/auth/login", json={"email": EPH, "password": SECRET}).status_code == 403
    assert browser.post("/api/v1/auth/login/code", json={"email": EPH, "code": "123456"}).status_code == 403
    assert fake.calls[before:] == [], "nothing sent to ephemeralREST"


def test_after_switching_back_on_the_trusted_browser_still_needs_a_code(
    client: TestClient, ready: dict[str, str], fake: FakeEphemeral
) -> None:
    client.put("/api/v1/auth/registration", json={"open": True}, headers=ready)
    fake.registered[EPH] = {"name": "Eph", "verified": True, "password": SECRET}
    browser = TestClient(client.app)
    browser.post("/api/v1/auth/login", json={"email": EPH, "password": SECRET})
    user_id = browser.post(
        "/api/v1/auth/login/code", json={"email": EPH, "code": "123456", "remember": True}
    ).json()["user"]["id"]
    browser.post(
        "/api/v1/auth/logout", headers={"X-CSRF-Token": browser.get("/api/v1/auth/me").json()["csrf_token"]}
    )
    trusted = browser.post("/api/v1/auth/login", json={"email": EPH, "password": SECRET})
    assert "two_factor" not in trusted.json(), "trusted: no code"
    client.put(f"/api/v1/users/{user_id}/status", json={"enabled": False}, headers=ready)
    client.put(f"/api/v1/users/{user_id}/status", json={"enabled": True}, headers=ready)
    again = browser.post("/api/v1/auth/login", json={"email": EPH, "password": SECRET})
    assert again.json() == {"two_factor": True, "email": EPH}
    browser.post("/api/v1/auth/login/code", json={"email": EPH, "code": "123456", "remember": True})
    browser.post(
        "/api/v1/auth/logout", headers={"X-CSRF-Token": browser.get("/api/v1/auth/me").json()["csrf_token"]}
    )
    assert (
        "two_factor" not in browser.post("/api/v1/auth/login", json={"email": EPH, "password": SECRET}).json()
    )


def test_the_owner_cant_be_switched_off(client: TestClient, ready: dict[str, str]) -> None:
    me = client.get("/api/v1/auth/me", headers=ready).json()["user"]["id"]
    response = client.put(f"/api/v1/users/{me}/status", json={"enabled": False}, headers=ready)
    assert response.status_code == 409


def test_only_the_owner_manages_people(
    client: TestClient, ann: tuple[str, TestClient, dict[str, str]]
) -> None:
    user_id, browser, headers = ann
    assert browser.get(f"/api/v1/users/{user_id}", headers=headers).status_code == 403
    assert browser.put(f"/api/v1/users/{user_id}/limits", json={}, headers=headers).status_code == 403
    assert browser.get("/api/v1/users/activity", headers=headers).status_code == 403


# ---------------------------------------------------------------------------
# Limits


def test_a_limit_stops_calls_but_not_cached_reads(
    client: TestClient,
    ready: dict[str, str],
    ann: tuple[str, TestClient, dict[str, str]],
    fake: FakeEphemeral,
) -> None:
    user_id, browser, headers = ann

    def used() -> int:
        return int(
            client.get(f"/api/v1/users/{user_id}", headers=ready).json()["usage"]["periods"]["day"]["used"]
        )

    made = browser.post("/api/v1/charts", json=BIRTH, headers=headers).json()
    browser.get(f"/api/v1/charts/{made['id']}", headers=headers)
    start = used()
    assert browser.post("/api/v1/charts", json={**BIRTH, "name": "Two"}, headers=headers).status_code == 201
    each = used() - start  # a new chart is a few calls (place, chart, positions)
    assert each >= 1
    browser.get(f"/api/v1/charts/{made['id']}", headers=headers)  # loaded again after the change
    limit = used() + each
    put = client.put(f"/api/v1/users/{user_id}/limits", json={"limits": {"day": limit}}, headers=ready)
    assert put.status_code == 200 and put.json()["limits"]["day"] == limit
    # Reading what's already loaded is free, however often.
    for _ in range(5):
        assert browser.get(f"/api/v1/charts/{made['id']}", headers=headers).status_code == 200
    assert used() == limit - each, "cache hits cost nothing"
    assert browser.post("/api/v1/charts", json={**BIRTH, "name": "Three"}, headers=headers).status_code == 201
    before = len(fake.calls)
    stopped = browser.post("/api/v1/charts", json={**BIRTH, "name": "Three"}, headers=headers)
    assert stopped.status_code == 429
    body = stopped.json()
    assert body["type"].endswith("/limit-reached") and body["title"] == "You've reached your limit for today"
    assert body["detail"] == f"{limit} calculations a day. It resets at midnight."
    assert body["period"] == "day" and body["resets_at"].endswith("Z")
    assert fake.calls[before:] == [], "the call wasn't made"
    mine = browser.get("/api/v1/account/usage", headers=headers).json()
    assert mine["source"] == "own" and mine["periods"]["day"]["used"] == limit
    events = client.get(f"/api/v1/users/{user_id}/activity?failures=true", headers=ready).json()["data"]
    assert [e["event"] for e in events].count("limit_reached") == 1
    browser.post("/api/v1/charts", json={**BIRTH, "name": "Four"}, headers=headers)
    events = client.get(f"/api/v1/users/{user_id}/activity?failures=true", headers=ready).json()["data"]
    assert [e["event"] for e in events].count("limit_reached") == 1, "once a period"


def test_site_defaults_apply_until_someone_has_their_own(
    client: TestClient, ready: dict[str, str], ann: tuple[str, TestClient, dict[str, str]]
) -> None:
    user_id, browser, headers = ann
    put = client.put(
        "/api/v1/settings/default-limits",
        json={"limits": {"hour": 0}, "time_zone": "Australia/Perth"},
        headers=ready,
    )
    assert put.json() == {
        "limits": {"hour": 0, "day": None, "week": None, "month": None},
        "time_zone": "Australia/Perth",
    }
    assert browser.post("/api/v1/charts", json=BIRTH, headers=headers).status_code == 429
    # The owner is never limited.
    assert client.post("/api/v1/charts", json=BIRTH, headers=ready).status_code == 201
    # Own limits (none) replace the defaults...
    client.put(f"/api/v1/users/{user_id}/limits", json={"limits": {}}, headers=ready)
    assert browser.post("/api/v1/charts", json=BIRTH, headers=headers).status_code == 201
    # ...until put back.
    back = client.put(
        f"/api/v1/users/{user_id}/limits", json={"use_site_defaults": True}, headers=ready
    ).json()
    assert back["use_site_defaults"] is True and back["usage"]["source"] == "site"
    assert browser.post("/api/v1/charts", json=BIRTH, headers=headers).status_code == 429
    bad = client.put("/api/v1/settings/default-limits", json={"time_zone": "Mars/Base"}, headers=ready)
    assert bad.status_code == 422


def test_ephemeralrests_own_limit_is_passed_on_in_the_same_shape(
    client: TestClient, ready: dict[str, str], fake: FakeEphemeral
) -> None:
    fake.rate_limited = True
    response = client.post("/api/v1/charts", json=BIRTH, headers=ready)
    assert response.status_code == 429 and response.json()["type"].endswith("/limit-reached")
    assert response.json()["period"] == "ephemeral"


@pytest.mark.parametrize(
    ("moment", "period", "start", "end"),
    [
        ("2026-03-10T05:30:00+00:00", "hour", "2026-03-10T05:00:00+00:00", "2026-03-10T06:00:00+00:00"),
        # 18:30 UTC is 02:30 on the 11th in Perth (UTC+8)
        ("2026-03-10T18:30:00+00:00", "day", "2026-03-10T16:00:00+00:00", "2026-03-11T16:00:00+00:00"),
        # Wednesday 11 March in Perth: the week began Monday the 9th
        ("2026-03-10T18:30:00+00:00", "week", "2026-03-08T16:00:00+00:00", "2026-03-15T16:00:00+00:00"),
        ("2026-03-10T18:30:00+00:00", "month", "2026-02-28T16:00:00+00:00", "2026-03-31T16:00:00+00:00"),
    ],
)
def test_each_periods_window(moment: str, period: str, start: str, end: str) -> None:
    got = limits.window(period, datetime.fromisoformat(moment), ZoneInfo("Australia/Perth"))
    assert got == (datetime.fromisoformat(start), datetime.fromisoformat(end))


def test_a_day_across_a_clock_change() -> None:
    zone = ZoneInfo("Australia/Sydney")  # clocks went back an hour on 5 April 2026
    start, end = limits.window("day", datetime(2026, 4, 5, 6, 0, tzinfo=UTC), zone)
    assert end - start == timedelta(hours=25)


# ---------------------------------------------------------------------------
# Activity


def test_activity_is_recorded_without_secrets(
    client: TestClient, ready: dict[str, str], ann: tuple[str, TestClient, dict[str, str]]
) -> None:
    user_id, browser, headers = ann
    browser.post("/api/v1/auth/logout", headers=headers)
    browser.post("/api/v1/auth/login", json={"email": ANN, "password": "wrong one"})
    headers = _login(browser)
    browser.delete("/api/v1/account/ephemeral-key", headers=headers)
    client.put(f"/api/v1/users/{user_id}/limits", json={"limits": {"day": 5}}, headers=ready)
    events = client.get(f"/api/v1/users/{user_id}/activity", headers=ready).json()["data"]
    seen = [(e["event"], e["outcome"]) for e in events]
    assert seen[:7] == [
        ("limits_changed", "by-owner"),
        ("key_forgotten", "done"),
        ("login", "success"),
        ("login", "bad-password"),
        ("logout", "by-person"),
        ("key_saved", "done"),
        ("login", "success"),
    ]
    assert events[1]["detail"] == GOOD_KEY[:8] and GOOD_KEY not in str(events)
    assert PASSWORD not in str(events) and "wrong one" not in str(events)
    failures = client.get(f"/api/v1/users/{user_id}/activity?failures=true", headers=ready).json()["data"]
    assert [e["outcome"] for e in failures] == ["bad-password"]
    # People see their own.
    mine = browser.get("/api/v1/account/activity", headers=headers).json()["data"]
    assert [e["event"] for e in mine] == [e for e, _ in seen]


def test_unknown_addresses_show_in_all_activity(client: TestClient, ready: dict[str, str]) -> None:
    TestClient(client.app).post("/api/v1/auth/login", json={"email": "nobody@example.com", "password": "x"})
    everyone = client.get("/api/v1/users/activity", headers=ready).json()["data"]
    assert everyone[0]["email"] == "nobody@example.com" and everyone[0]["user_id"] is None
    assert everyone[0]["failed"] is True


def test_activity_pages(client: TestClient, ready: dict[str, str], settings: Settings) -> None:
    me = client.get("/api/v1/auth/me", headers=ready).json()["user"]["id"]
    conn = connect(settings.database_path)
    for _ in range(60):
        audit.record(conn, None, "login", "success", user_id=me)
    first = client.get(f"/api/v1/users/{me}/activity", headers=ready).json()
    assert len(first["data"]) == 50 and first["next"]
    second = client.get(f"/api/v1/users/{me}/activity?before={first['next']}", headers=ready).json()
    assert second["next"] is None and len(first["data"]) + len(second["data"]) >= 60


def test_old_activity_is_pruned(client: TestClient, ready: dict[str, str], settings: Settings) -> None:
    conn = connect(settings.database_path)
    conn.execute(
        "INSERT INTO auth_events (email, at, event, outcome)"
        " VALUES ('old@example.com', '2020-01-01T00:00:00.000Z', 'login', 'success')"
    )
    assert client.put("/api/v1/settings/activity-retention", json={"months": 6}, headers=ready).json() == {
        "months": 6
    }
    assert conn.execute("SELECT COUNT(*) FROM auth_events WHERE email = 'old@example.com'").fetchone()[0] == 0


def test_activity_goes_with_the_account_and_comes_in_the_download(
    client: TestClient, ready: dict[str, str], ann: tuple[str, TestClient, dict[str, str]], settings: Settings
) -> None:
    user_id, browser, headers = ann
    exported = browser.get("/api/v1/account/export", headers=headers).json()
    assert [e["event"] for e in exported["activity"]][:2] == ["login", "key_saved"]
    browser.post("/api/v1/account/delete", json={"password": PASSWORD}, headers=headers)
    conn = connect(settings.database_path)
    assert conn.execute("SELECT COUNT(*) FROM auth_events WHERE user_id = ?", (user_id,)).fetchone()[0] == 0


def test_the_user_window_has_everything(
    client: TestClient, ready: dict[str, str], ann: tuple[str, TestClient, dict[str, str]]
) -> None:
    user_id, _, _ = ann
    found = client.get(f"/api/v1/users/{user_id}", headers=ready).json()
    assert found["email"] == ANN and found["disabled"] is False and found["key_prefix"] == GOOD_KEY[:8]
    assert found["uses_site_defaults"] is True and set(found["usage"]["periods"]) == {
        "hour",
        "day",
        "week",
        "month",
    }


def test_pages_carry_security_headers(client: TestClient) -> None:
    response = client.get("/")
    assert "connect-src 'self'" in response.headers["content-security-policy"]
    assert response.headers["x-content-type-options"] == "nosniff"
    assert "content-security-policy" not in client.get("/api/docs").headers
