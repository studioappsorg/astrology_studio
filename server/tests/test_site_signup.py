"""
AstrologyStudio ·
server/tests/test_site_signup.py

Signing up on this site's own pages with a site key, "I don't have a key", bringing a key (and
charts, and their notes) from another site, and the portal flow when none of that's available.

Copyright (c) 2026 Gavin Melhuish
MIT License; see LICENSE in the project root.
SPDX-License-Identifier: MIT
"""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

import pytest
from fastapi.testclient import TestClient

from astrologystudio.app import create_app
from astrologystudio.config import Settings

from .conftest import PASSWORD, sign_up
from .fake_ephemeral import GOOD_KEY, SITE_KEY, FakeEphemeral

NEW = "new@example.com"
SECRET = "a good long password"
BIRTH = {"name": "Jane", "date": "1985-06-12", "time": "14:30", "place": "Perth"}


def _token(link: str) -> str:
    return parse_qs(urlsplit(link).query)["t"][0]


def _site_key(client: TestClient, owner: dict[str, str]) -> dict:
    response = client.put("/api/v1/connection/site-key", json={"api_key": SITE_KEY}, headers=owner)
    assert response.status_code == 200, response.text
    return response.json()


def _open(client: TestClient, owner: dict[str, str]) -> None:
    assert client.put("/api/v1/auth/registration", json={"open": True}, headers=owner).status_code == 200


# ---------------------------------------------------------------------------
# The site key


def test_the_site_key_registers_this_sites_address(
    client: TestClient, owner: dict[str, str], fake: FakeEphemeral
) -> None:
    assert client.get("/api/v1/connection/site-key", headers=owner).json()["links_here"] is False
    saved = _site_key(client, owner)
    assert saved["configured"] and saved["prefix"] == SITE_KEY[:8] and saved["domain"] == "example.com"
    assert saved["links_here"] is True and saved["reason"] is None
    assert fake.domain_keys[SITE_KEY]["origins"] == ["http://localhost:8080"]
    _site_key(client, owner)
    assert fake.domain_keys[SITE_KEY]["origins"] == ["http://localhost:8080"], "not added twice"
    assert client.delete("/api/v1/connection/site-key", headers=owner).status_code == 204
    gone = client.get("/api/v1/connection/site-key", headers=owner).json()
    assert gone["configured"] is False and gone["links_here"] is False


def test_a_personal_key_or_an_older_ephemeralrest_is_refused(
    client: TestClient, owner: dict[str, str], fake: FakeEphemeral
) -> None:
    personal = client.put("/api/v1/connection/site-key", json={"api_key": GOOD_KEY}, headers=owner)
    assert personal.status_code == 422 and personal.json()["type"].endswith("/not-a-site-key")
    fake.app_links = False
    older = client.put("/api/v1/connection/site-key", json={"api_key": SITE_KEY}, headers=owner)
    assert older.status_code == 422 and older.json()["type"].endswith("/site-keys-unsupported")


@pytest.fixture
def elsewhere(tmp_path: Path, fake: FakeEphemeral) -> Iterator[TestClient]:
    settings = Settings(
        data_dir=tmp_path / "other", ephemeral_url="http://ephemeral.test", base_url="https://astro.other.org"
    )
    app = create_app(settings)
    app.state.ephemeral_transport = fake.transport
    with TestClient(app, base_url="https://astro.other.org") as test_client:
        yield test_client


def test_a_site_key_for_another_domain_is_refused(elsewhere: TestClient) -> None:
    owner = sign_up(elsewhere)
    response = elsewhere.put("/api/v1/connection/site-key", json={"api_key": SITE_KEY}, headers=owner)
    assert response.status_code == 422
    assert response.json()["detail"] == "This key is for example.com; this site is at astro.other.org."


def test_only_the_owner_sees_or_sets_it(client: TestClient, owner: dict[str, str]) -> None:
    client.post(
        "/api/v1/users", json={"name": "U", "email": "u@example.com", "password": PASSWORD}, headers=owner
    )
    client.post("/api/v1/auth/logout", headers=owner)
    user = client.post("/api/v1/auth/login", json={"email": "u@example.com", "password": PASSWORD}).json()
    headers = {"X-CSRF-Token": user["csrf_token"]}
    assert client.get("/api/v1/connection/site-key", headers=headers).status_code == 403
    assert (
        client.put("/api/v1/connection/site-key", json={"api_key": SITE_KEY}, headers=headers).status_code
        == 403
    )


# ---------------------------------------------------------------------------
# Signing up from the login page


def test_sign_up_here_ends_signed_in(client: TestClient, owner: dict[str, str], fake: FakeEphemeral) -> None:
    _site_key(client, owner)
    _open(client, owner)
    client.post("/api/v1/auth/logout", headers=owner)
    assert client.get("/api/v1/auth/status").json()["signup_flow"] == "here"
    response = client.post("/api/v1/auth/register", json={"name": "New Person", "email": NEW})
    assert response.status_code == 202 and response.json() == {"email": NEW, "flow": "here"}
    sent = fake.outbox[-1]
    assert sent["kind"] == "verify" and sent["link"].startswith("http://localhost:8080/auth/verify?t=")
    short = client.post("/api/v1/auth/verify", json={"token": _token(sent["link"]), "password": "short"})
    assert short.status_code == 422
    done = client.post("/api/v1/auth/verify", json={"token": _token(sent["link"]), "password": SECRET})
    assert done.status_code == 200, done.text
    assert done.json()["result"] == "signed_in" and done.json()["user"]["signs_in_with"] == "ephemeral"
    key = client.get("/api/v1/account/ephemeral-key").json()
    assert key["configured"] and key["prefix"] == fake.registered[NEW]["key"][:8]
    again = client.post("/api/v1/auth/verify", json={"token": _token(sent["link"]), "password": SECRET})
    assert again.status_code == 410 and again.json()["type"].endswith("/link-expired")


def test_without_a_site_key_it_is_the_portal_flow(
    client: TestClient, owner: dict[str, str], fake: FakeEphemeral
) -> None:
    _open(client, owner)
    client.post("/api/v1/auth/logout", headers=owner)
    assert client.get("/api/v1/auth/status").json()["signup_flow"] == "portal"
    response = client.post("/api/v1/auth/register", json={"name": "New", "email": NEW})
    assert response.json()["flow"] == "portal"
    assert fake.outbox[-1]["link"].startswith("https://portal.example.org/verify.php?t=")
    assert "links" not in fake.bodies[-1]


def test_links_refused_after_all_falls_back_to_the_portal(
    client: TestClient, owner: dict[str, str], fake: FakeEphemeral
) -> None:
    _site_key(client, owner)
    _open(client, owner)
    fake.domain_keys[SITE_KEY]["origins"] = []  # the owner removed it in ephemeralREST
    client.post("/api/v1/auth/logout", headers=owner)
    response = client.post("/api/v1/auth/register", json={"name": "New", "email": NEW})
    assert response.status_code == 202 and response.json()["flow"] == "portal"
    assert fake.outbox[-1]["link"].startswith("https://portal.example.org/")


def test_an_older_ephemeralrest_gets_the_portal_flow(
    client: TestClient, owner: dict[str, str], fake: FakeEphemeral
) -> None:
    _site_key(client, owner)
    _open(client, owner)
    fake.app_links = False
    client.app.state.ephemeral_features.clear()
    client.post("/api/v1/auth/logout", headers=owner)
    assert client.post("/api/v1/auth/register", json={"name": "New", "email": NEW}).json()["flow"] == "portal"


def test_the_sign_up_form_hint_works_for_an_existing_account(
    client: TestClient, owner: dict[str, str], fake: FakeEphemeral
) -> None:
    """Someone from another site logs in with that site's account: their key and charts come too."""
    _open(client, owner)
    client.post("/api/v1/auth/logout", headers=owner)
    fake.registered[NEW] = {"name": "Moved", "verified": True, "password": SECRET, "key": GOOD_KEY}
    fake.account["c1"] = {
        "uuid": "c1",
        "type": "main",
        "name": "Theirs",
        "updated_at": "2026-01-01T00:00:00Z",
    }
    assert client.post("/api/v1/auth/login", json={"email": NEW, "password": SECRET}).json()["two_factor"]
    done = client.post("/api/v1/auth/login/code", json={"email": NEW, "code": "123456"})
    assert done.status_code == 200
    listed = client.get("/api/v1/charts", headers={"X-CSRF-Token": done.json()["csrf_token"]}).json()
    assert [c["name"] for c in listed["data"]] == ["Theirs"]


# ---------------------------------------------------------------------------
# "I don't have a key"


def test_i_dont_have_a_key_saves_the_new_key_wherever_the_link_is_opened(
    client: TestClient, owner: dict[str, str], fake: FakeEphemeral, settings: Settings
) -> None:
    _site_key(client, owner)
    response = client.post(
        "/api/v1/account/ephemeral-key/request",
        json={"name": "Owner", "email": "o@example.net"},
        headers=owner,
    )
    assert response.status_code == 202 and response.json()["flow"] == "here"
    link = fake.outbox[-1]["link"]
    # Opened in another browser, with no session at all.
    other = TestClient(client.app)
    done = other.post("/api/v1/auth/verify", json={"token": _token(link), "password": SECRET})
    assert done.status_code == 200 and done.json() == {"result": "key_saved", "email": "o@example.net"}
    key = client.get("/api/v1/account/ephemeral-key", headers=owner).json()
    assert key["configured"] and key["prefix"] == fake.registered["o@example.net"]["key"][:8]
    # The owner still logs in with their own password here.
    assert client.get("/api/v1/auth/me", headers=owner).json()["user"]["signs_in_with"] == "password"


def test_i_dont_have_a_key_without_a_site_key_is_the_portal_flow(
    client: TestClient, owner: dict[str, str], fake: FakeEphemeral
) -> None:
    response = client.post(
        "/api/v1/account/ephemeral-key/request",
        json={"name": "Owner", "email": "o@example.net"},
        headers=owner,
    )
    assert response.json()["flow"] == "portal"
    assert fake.outbox[-1]["link"].startswith("https://portal.example.org/")


# ---------------------------------------------------------------------------
# A key from another site


def _another_account(fake: FakeEphemeral, email: str = "me@example.net") -> str:
    fake.registered[email] = {"name": "Me", "verified": True, "password": SECRET}
    return fake.new_key_for(email)


def test_use_my_key_from_another_site(client: TestClient, owner: dict[str, str], fake: FakeEphemeral) -> None:
    key = _another_account(fake)
    wrong = client.post(
        "/api/v1/account/ephemeral-key/login",
        json={"email": "me@example.net", "password": "nope"},
        headers=owner,
    )
    assert wrong.status_code == 422 and "http://ephemeral.test" in wrong.json()["detail"], (
        "the owner sees the address"
    )
    first = client.post(
        "/api/v1/account/ephemeral-key/login",
        json={"email": "me@example.net", "password": SECRET},
        headers=owner,
    )
    assert first.json() == {"two_factor": True, "email": "me@example.net"}
    done = client.post(
        "/api/v1/account/ephemeral-key/login/code",
        json={"email": "me@example.net", "code": "123456"},
        headers=owner,
    )
    assert done.status_code == 200 and done.json()["status"] == "saved" and done.json()["prefix"] == key[:8]


@pytest.mark.parametrize("choice", ["add", "leave", "cancel"])
def test_switching_keys_asks_about_charts_that_would_drop_out_of_sight(
    client: TestClient, ready: dict[str, str], fake: FakeEphemeral, choice: str
) -> None:
    made = client.post("/api/v1/charts", json=BIRTH, headers=ready).json()
    new_key = _another_account(fake)
    client.post(
        "/api/v1/account/ephemeral-key/login",
        json={"email": "me@example.net", "password": SECRET},
        headers=ready,
    )
    asked = client.post(
        "/api/v1/account/ephemeral-key/login/code",
        json={"email": "me@example.net", "code": "123456"},
        headers=ready,
    )
    assert asked.json()["status"] == "choose" and asked.json()["missing"] == 1
    assert asked.json()["prefix"] == GOOD_KEY[:8], "not switched yet"
    answer = client.post(
        "/api/v1/account/ephemeral-key/pending", json={"choice": choice}, headers=ready
    ).json()
    prefix = client.get("/api/v1/account/ephemeral-key", headers=ready).json()["prefix"]
    if choice == "cancel":
        assert answer["status"] == "cancelled" and prefix == GOOD_KEY[:8]
        return
    assert answer["status"] == "saved" and prefix == new_key[:8]
    assert (made["id"] in fake.lists[new_key]) is (choice == "add")
    listed = client.get("/api/v1/charts", headers=ready).json()["data"]
    assert ([c["id"] for c in listed] == [made["id"]]) is (choice == "add")


def test_pasting_a_key_asks_too_and_takes_the_answer_with_it(
    client: TestClient, ready: dict[str, str], fake: FakeEphemeral
) -> None:
    client.post("/api/v1/charts", json=BIRTH, headers=ready)
    new_key = _another_account(fake)
    asked = client.put("/api/v1/account/ephemeral-key", json={"api_key": new_key}, headers=ready).json()
    assert asked["status"] == "choose"
    done = client.put(
        "/api/v1/account/ephemeral-key", json={"api_key": new_key, "charts": "add"}, headers=ready
    ).json()
    assert done["status"] == "saved" and done["added"] == 1 and done["prefix"] == new_key[:8]


def test_a_key_from_another_ephemeralrest_says_why(client: TestClient, owner: dict[str, str]) -> None:
    response = client.put(
        "/api/v1/account/ephemeral-key", json={"api_key": "eph_from_elsewhere_9"}, headers=owner
    )
    assert (
        response.status_code == 424
        and "Keys and accounts only work between sites" in response.json()["detail"]
    )


# ---------------------------------------------------------------------------
# Forgot password, for people who sign in through ephemeralREST


def test_reset_links_come_back_here(client: TestClient, owner: dict[str, str], fake: FakeEphemeral) -> None:
    _site_key(client, owner)
    _open(client, owner)
    client.post("/api/v1/auth/logout", headers=owner)
    client.post("/api/v1/auth/register", json={"name": "New", "email": NEW})
    client.post("/api/v1/auth/verify", json={"token": _token(fake.outbox[-1]["link"]), "password": SECRET})
    client.post("/api/v1/auth/logout", headers={})
    assert client.get("/api/v1/auth/status").json()["password_reset"] is True, "no SMTP needed for this"
    assert client.post("/api/v1/auth/password-reset", json={"email": NEW}).status_code == 202
    sent = fake.outbox[-1]
    assert sent["kind"] == "reset" and sent["link"].startswith("http://localhost:8080/auth/set-password?t=")
    done = client.post(
        "/api/v1/auth/ephemeral-password",
        json={"token": _token(sent["link"]), "password": "another good one"},
    )
    assert done.status_code == 204 and fake.registered[NEW]["password"] == "another good one"
    used = client.post(
        "/api/v1/auth/ephemeral-password",
        json={"token": _token(sent["link"]), "password": "another good one"},
    )
    assert used.status_code == 410


# ---------------------------------------------------------------------------
# Folders, tags and notes from another site's export


def test_organisation_comes_across_from_an_export(client: TestClient, ready: dict[str, str]) -> None:
    folder = client.post("/api/v1/folders", json={"name": "Clients"}, headers=ready).json()
    chart = client.post(
        "/api/v1/charts",
        json={**BIRTH, "tags": ["family"], "rating": "AA", "folder_id": folder["id"]},
        headers=ready,
    ).json()
    exported = client.get("/api/v1/account/export", headers=ready).json()
    exported["chart_notes"].append({"chart_id": "not-in-my-list", "notes": "skip me"})
    # Another person here, with the same key (as after a move): nothing of theirs yet.
    client.post(
        "/api/v1/users", json={"name": "B", "email": "b@example.com", "password": PASSWORD}, headers=ready
    )
    other = TestClient(client.app)
    b = {
        "X-CSRF-Token": other.post(
            "/api/v1/auth/login", json={"email": "b@example.com", "password": PASSWORD}
        ).json()["csrf_token"]
    }
    other.put("/api/v1/account/ephemeral-key", json={"api_key": GOOD_KEY}, headers=b)
    result = other.post("/api/v1/account/organisation", json=exported, headers=b).json()
    assert result == {"imported": 1, "skipped": 1, "kept_derived": 0}
    again = other.post("/api/v1/account/organisation", json=exported, headers=b).json()
    assert again["imported"] == 1
    mine = other.get(f"/api/v1/charts/{chart['id']}", headers=b).json()["note"]
    assert mine["tags"] == ["family"] and mine["rating"] == "AA"
    folders = other.get("/api/v1/folders", headers=b).json()["data"]
    assert [f["name"] for f in folders] == ["Clients"] and mine["folder_id"] == folders[0]["id"], (
        "made once, by name"
    )
