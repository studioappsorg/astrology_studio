"""
AstrologyStudio ·
server/tests/test_email_design.py

The email designer, and sending ephemeralREST's emails (sign-up links, login codes, resets, key
notices) from this site with the owner's designs.

Copyright (c) 2026 Gavin Melhuish
MIT License; see LICENSE in the project root.
SPDX-License-Identifier: MIT
"""

from __future__ import annotations

import base64
import re
from urllib.parse import parse_qs, urlsplit

import pytest
from fastapi.testclient import TestClient

from astrologystudio import email_design, mail
from astrologystudio.config import Settings

from .fake_ephemeral import SITE_KEY, FakeEphemeral
from .test_email import GOOD, FakeSMTP

NEW = "new@example.com"
SECRET = "a good long password"
PNG = "data:image/png;base64," + base64.b64encode(b"\x89PNG\r\n\x1a\nfake").decode()


@pytest.fixture(autouse=True)
def fake_smtp(monkeypatch: pytest.MonkeyPatch) -> None:
    FakeSMTP.sent, FakeSMTP.calls, FakeSMTP.refuse_login = [], [], False
    monkeypatch.setattr(mail, "SMTP", FakeSMTP)
    monkeypatch.setattr(mail, "SMTP_SSL", FakeSMTP)


def _plain(index: int = -1) -> str:
    return str(FakeSMTP.sent[index].get_body(("plain",)).get_content())


def _html(index: int = -1) -> str:
    return str(FakeSMTP.sent[index].get_body(("html",)).get_content())


def _ready(client: TestClient, owner: dict[str, str], fake: FakeEphemeral, allowed: bool = True) -> None:
    client.put("/api/v1/email", json=GOOD, headers=owner)
    client.post("/api/v1/email/test", json={}, headers=owner)
    client.put("/api/v1/connection/site-key", json={"api_key": SITE_KEY}, headers=owner)
    fake.domain_keys[SITE_KEY]["allowed"] = allowed


# ---------------------------------------------------------------------------
# Switching delivery on and off


def test_delivery_says_whats_missing(client: TestClient, owner: dict[str, str], fake: FakeEphemeral) -> None:
    state = client.get("/api/v1/email/delivery", headers=owner).json()
    assert state["on"] is False and state["ready"] is False
    assert state["missing"] == [
        "Set up email (SMTP) above.",
        "Save a site key first (Settings → ephemeralREST).",
    ]
    client.put("/api/v1/email", json=GOOD, headers=owner)
    assert (
        client.get("/api/v1/email/delivery", headers=owner)
        .json()["missing"][0]
        .startswith("Send a test message")
    )
    _ready(client, owner, fake, allowed=False)
    state = client.get("/api/v1/email/delivery", headers=owner).json()
    assert state["missing"] == [
        "Ask whoever runs your ephemeralREST to allow email delivery for example.com."
    ]
    refused = client.put("/api/v1/email/delivery", json={"on": True}, headers=owner)
    assert refused.status_code == 409
    fake.domain_keys[SITE_KEY]["allowed"] = True
    on = client.put("/api/v1/email/delivery", json={"on": True}, headers=owner).json()
    assert on["on"] is True and fake.domain_keys[SITE_KEY]["delivery"] == "self"
    off = client.put("/api/v1/email/delivery", json={"on": False}, headers=owner).json()
    assert off["on"] is False and fake.domain_keys[SITE_KEY]["delivery"] == "ephemeral"


def test_changing_smtp_needs_a_new_test(client: TestClient, owner: dict[str, str]) -> None:
    client.put("/api/v1/email", json=GOOD, headers=owner)
    client.post("/api/v1/email/test", json={}, headers=owner)
    assert client.get("/api/v1/email", headers=owner).json()["tested"] is True
    client.put("/api/v1/email", json={**GOOD, "port": 2525}, headers=owner)
    assert client.get("/api/v1/email", headers=owner).json()["tested"] is False


def test_every_email_comes_from_this_site_when_its_on(
    client: TestClient, owner: dict[str, str], fake: FakeEphemeral, settings: Settings
) -> None:
    _ready(client, owner, fake)
    client.put("/api/v1/email/delivery", json={"on": True}, headers=owner)
    client.put(
        "/api/v1/email/branding", json={"sender_name": "Star Charts", "accent": "#aa3300"}, headers=owner
    )
    client.put("/api/v1/auth/registration", json={"open": True}, headers=owner)
    client.post("/api/v1/auth/logout", headers=owner)
    sent_before = len(FakeSMTP.sent)
    outbox_before = len(fake.outbox)

    assert client.post("/api/v1/auth/register", json={"name": "New", "email": NEW}).status_code == 202
    assert len(fake.outbox) == outbox_before, "ephemeralREST sent nothing"
    verify = _plain()
    assert FakeSMTP.sent[-1]["Subject"] == "Confirm your email for Star Charts"
    assert "Star Charts" in FakeSMTP.sent[-1]["From"]
    link = re.search(r"(http://localhost:8080/auth/verify\?t=\S+)", verify)
    assert link and "#aa3300" in _html()
    token = parse_qs(urlsplit(link.group(1)).query)["t"][0]

    done = client.post("/api/v1/auth/verify", json={"token": token, "password": SECRET})
    assert done.status_code == 200
    assert FakeSMTP.sent[-1]["Subject"] == "Welcome to Star Charts"

    client.post("/api/v1/auth/logout", headers={"X-CSRF-Token": done.json()["csrf_token"]})
    client.post("/api/v1/auth/login", json={"email": NEW, "password": SECRET})
    assert FakeSMTP.sent[-1]["Subject"] == "Your Star Charts login code: 123456"
    assert "**" not in _plain() and "<strong>123456</strong>" in _html()

    client.post("/api/v1/auth/password-reset", json={"email": NEW})
    assert (
        "/auth/set-password?t=" in _plain()
        and FakeSMTP.sent[-1]["Subject"] == "Set a new password for Star Charts"
    )
    assert len(FakeSMTP.sent) - sent_before == 4
    # Codes and tokens aren't kept or logged.
    dump = "\n".join(connect_dump(settings))
    assert token not in dump and "123456" not in dump


def connect_dump(settings: Settings) -> list[str]:
    from astrologystudio.db import connect

    return list(connect(settings.database_path).iterdump())


def test_a_failed_send_is_reported_and_recorded(
    client: TestClient, owner: dict[str, str], fake: FakeEphemeral
) -> None:
    _ready(client, owner, fake)
    client.put("/api/v1/email/delivery", json={"on": True}, headers=owner)
    client.put("/api/v1/auth/registration", json={"open": True}, headers=owner)
    FakeSMTP.refuse_login = True
    other = TestClient(client.app)
    failed = other.post("/api/v1/auth/register", json={"name": "New", "email": NEW})
    assert failed.status_code == 502 and failed.json()["title"] == "We couldn't send the email"
    assert failed.json()["detail"] == "Try again shortly."
    state = client.get("/api/v1/email/delivery", headers=owner).json()
    assert state["last_failure"]["kind"] == "verify"
    events = client.get("/api/v1/users/activity?failures=true", headers=owner).json()["data"]
    assert events[0]["event"] == "email_failed" and events[0]["email"] == NEW


def test_accounts_made_elsewhere_keep_ephemeralrests_emails(
    client: TestClient, owner: dict[str, str], fake: FakeEphemeral
) -> None:
    _ready(client, owner, fake)
    client.put("/api/v1/email/delivery", json={"on": True}, headers=owner)
    client.put("/api/v1/auth/registration", json={"open": True}, headers=owner)
    fake.registered["moved@example.com"] = {
        "name": "Moved",
        "verified": True,
        "password": SECRET,
        "home": None,
    }
    sent = len(FakeSMTP.sent)
    TestClient(client.app).post("/api/v1/auth/login", json={"email": "moved@example.com", "password": SECRET})
    assert len(FakeSMTP.sent) == sent and fake.outbox[-1] == {
        "to": "moved@example.com",
        "kind": "code",
        "code": "123456",
    }


# ---------------------------------------------------------------------------
# The designer


def test_templates_check_their_placeholders(client: TestClient, owner: dict[str, str]) -> None:
    listed = client.get("/api/v1/email/templates", headers=owner).json()["data"]
    assert {t["key"] for t in listed} >= {"verify", "login_code", "password_reset", "welcome", "key_replaced"}
    missing = client.put(
        "/api/v1/email/templates/login_code", json={"subject": "Hi", "body": "No code here"}, headers=owner
    )
    assert missing.status_code == 422 and "It must include {code}." in missing.json()["problems"]
    unknown = client.put(
        "/api/v1/email/templates/login_code",
        json={"subject": "{code}", "body": "{code} {nope}"},
        headers=owner,
    )
    assert unknown.json()["problems"] == [
        "Unknown: {nope}. This email can use {name}, {code}, {expires}, {site}."
    ]
    tags = client.put(
        "/api/v1/email/templates/welcome", json={"subject": "Hi", "body": "<b>Hi</b>"}, headers=owner
    )
    assert tags.status_code == 422
    long = client.put(
        "/api/v1/email/templates/welcome", json={"subject": "x" * 151, "body": "Hi"}, headers=owner
    )
    assert long.status_code == 422


def test_saving_and_resetting(client: TestClient, owner: dict[str, str]) -> None:
    saved = client.put(
        "/api/v1/email/templates/welcome",
        json={"subject": "Hello from {site}", "body": "Hi {name}!"},
        headers=owner,
    ).json()
    assert saved["customised"] is True and saved["subject"] == "Hello from {site}"
    reset = client.delete("/api/v1/email/templates/welcome", headers=owner).json()
    assert reset["customised"] is False and reset["subject"] == email_design.TEMPLATES["welcome"].subject


def test_preview_and_test_send(client: TestClient, owner: dict[str, str]) -> None:
    client.put("/api/v1/email", json=GOOD, headers=owner)
    preview = client.post(
        "/api/v1/email/templates/verify/preview", json={"body": "Hi {name}\n\n[[Go|{link}]]"}, headers=owner
    ).json()
    assert preview["subject"] == "Confirm your email for AstrologyStudio"
    assert "Go: https://example.com/auth/verify?t=sample-token" in preview["text"]
    assert 'href="https://example.com/auth/verify?t=sample-token"' in preview["html"]
    assert "#111318" in preview["html_dark"] and "#111318" not in preview["html"]
    sent = client.post("/api/v1/email/templates/login_code/test", json={}, headers=owner).json()
    assert sent == {"sent": True, "to": "owner@example.com"}
    assert FakeSMTP.sent[-1]["Subject"] == "Your AstrologyStudio login code: 123456"


def test_values_are_escaped_and_cant_add_markup() -> None:
    brand = {
        "accent": "#4f46e5",
        "sender_name": "",
        "reply_to": "",
        "footer": "Unit 1, Some St\n[Our site](https://example.com)",
    }
    rendered = email_design.render_parts(
        "Hi {name}",
        "Hello {name}.\n\n**Bold** and *italic*. [Home](https://example.com) [bad](javascript:alert(1))"
        "\n\n[[Open|{link}]]",
        {"name": "<b>Ann</b> [[x|https://evil.example]] **y**", "link": "https://example.com/x?a=1&b=2"},
        brand,
        None,
        "https://example.com",
    )
    assert "&lt;b&gt;Ann&lt;/b&gt;" in rendered.html and "<b>Ann" not in rendered.html
    assert not [h for h in re.findall(r'href="([^"]+)"', rendered.html) if "evil" in h]
    assert "**y**" in rendered.html, "markup in a value is just text"
    assert "<strong>Bold</strong>" in rendered.html and "<em>italic</em>" in rendered.html
    assert "javascript:" not in rendered.html
    assert 'href="https://example.com/x?a=1&amp;b=2"' in rendered.html
    assert "Open: https://example.com/x?a=1&b=2" in rendered.text
    assert "Unit 1, Some St" in rendered.text and 'href="https://example.com"' in rendered.html
    assert rendered.subject == "Hi <b>Ann</b> [[x|https://evil.example]] **y**", "a subject is plain text"


def test_the_optional_account_email_is_off_until_switched_on(
    client: TestClient, owner: dict[str, str]
) -> None:
    client.put("/api/v1/email", json=GOOD, headers=owner)
    made = client.post(
        "/api/v1/users",
        json={"name": "Ann", "email": "ann@example.com", "password": "correct horse battery"},
        headers=owner,
    ).json()
    sent = len(FakeSMTP.sent)
    client.put(f"/api/v1/users/{made['id']}/status", json={"enabled": False}, headers=owner)
    assert len(FakeSMTP.sent) == sent
    template = client.get("/api/v1/email/templates/account_status", headers=owner).json()
    assert template["enabled"] is False and template["optional"] is True
    client.put(
        "/api/v1/email/templates/account_status",
        json={"subject": template["subject"], "body": template["body"], "enabled": True},
        headers=owner,
    )
    client.put(f"/api/v1/users/{made['id']}/status", json={"enabled": True}, headers=owner)
    assert FakeSMTP.sent[-1]["Subject"] == "Your AstrologyStudio account was switched on"


def test_password_changes_are_emailed(client: TestClient, owner: dict[str, str]) -> None:
    client.put("/api/v1/email", json=GOOD, headers=owner)
    client.post(
        "/api/v1/auth/password",
        json={"current_password": "correct horse battery", "new_password": "another horse battery"},
        headers=owner,
    )
    assert FakeSMTP.sent[-1]["Subject"] == "Your AstrologyStudio password was changed"


def test_the_email_logo(client: TestClient, owner: dict[str, str]) -> None:
    assert client.get("/api/v1/email/logo").status_code == 404
    svg = client.put(
        "/api/v1/email/branding", json={"logo": "data:image/svg+xml;base64,PHN2Zz4="}, headers=owner
    )
    assert svg.status_code == 422
    client.put("/api/v1/email/branding", json={"logo": PNG}, headers=owner)
    served = TestClient(client.app).get("/api/v1/email/logo")
    assert served.status_code == 200 and served.headers["content-type"] == "image/png"
    assert served.content.startswith(b"\x89PNG")
    client.put("/api/v1/email", json=GOOD, headers=owner)
    client.post("/api/v1/email/test", json={}, headers=owner)
    assert 'src="http://localhost:8080/api/v1/email/logo"' in _html()
