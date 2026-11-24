"""
AstrologyStudio ·
server/tests/test_email.py

Tests:

the owner's SMTP settings (the password is kept encrypted and never shown), sending a test
message, explained failures, and that nobody else can see or change them.

Copyright (c) 2026 Gavin Melhuish
MIT License; see LICENSE in the project root.
SPDX-License-Identifier: MIT
"""

from __future__ import annotations

import smtplib
from email.message import EmailMessage
from typing import Any, ClassVar

import pytest
from fastapi.testclient import TestClient

from astrologystudio import mail
from astrologystudio.config import Settings
from astrologystudio.db import connect

from .conftest import PASSWORD

URL = "/api/v1/email"
GOOD = {
    "host": "smtp.example.com",
    "port": 587,
    "security": "starttls",
    "username": "studio@example.com",
    "password": "s3cret-pass",
    "from_address": "studio@example.com",
    "from_name": "AstrologyStudio",
}


class FakeSMTP:
    """Stands in for smtplib.SMTP and SMTP_SSL, keeping what it was asked to do."""

    sent: ClassVar[list[EmailMessage]] = []
    calls: ClassVar[list[tuple[Any, ...]]] = []
    refuse_login = False

    def __init__(self, host: str, port: int, **_: Any) -> None:
        FakeSMTP.calls.append(("connect", host, port))

    def __enter__(self) -> FakeSMTP:
        return self

    def __exit__(self, *_: Any) -> None:
        FakeSMTP.calls.append(("quit",))

    def ehlo(self) -> None:
        FakeSMTP.calls.append(("ehlo",))

    def starttls(self, **_: Any) -> None:
        FakeSMTP.calls.append(("starttls",))

    def login(self, user: str, password: str) -> None:
        if FakeSMTP.refuse_login:
            raise smtplib.SMTPAuthenticationError(535, b"Authentication failed")
        FakeSMTP.calls.append(("login", user, password))

    def send_message(self, message: EmailMessage) -> None:
        FakeSMTP.sent.append(message)


@pytest.fixture(autouse=True)
def fake_smtp(monkeypatch: pytest.MonkeyPatch) -> None:
    FakeSMTP.sent, FakeSMTP.calls, FakeSMTP.refuse_login = [], [], False
    monkeypatch.setattr(mail, "SMTP", FakeSMTP)
    monkeypatch.setattr(mail, "SMTP_SSL", FakeSMTP)


def test_settings_are_saved_without_showing_the_password(
    client: TestClient, owner: dict[str, str], settings: Settings
) -> None:
    assert client.get(URL).json() == {"configured": False}
    saved = client.put(URL, json=GOOD, headers=owner).json()
    assert saved["configured"] and saved["has_password"] and "password" not in saved
    assert saved["host"] == "smtp.example.com" and saved["from_name"] == "AstrologyStudio"
    # Encrypted in the database.
    raw = connect(settings.database_path).execute("SELECT value FROM settings WHERE key = 'smtp'").fetchone()
    assert "s3cret-pass" not in raw["value"]
    # Saving without a password keeps it; "" removes it.
    kept = client.put(URL, json={**GOOD, "password": None, "port": 2525}, headers=owner).json()
    assert kept["has_password"] and kept["port"] == 2525
    assert not client.put(URL, json={**GOOD, "password": ""}, headers=owner).json()["has_password"]
    bad = client.put(URL, json={**GOOD, "host": "https://smtp.example.com"}, headers=owner)
    assert bad.status_code == 422
    assert client.put(URL, json={**GOOD, "from_address": "nobody"}, headers=owner).status_code == 422
    assert client.delete(URL, headers=owner).status_code == 204
    assert client.get(URL).json() == {"configured": False}


def test_a_test_message(client: TestClient, owner: dict[str, str]) -> None:
    refused = client.post(f"{URL}/test", json={}, headers=owner)
    assert refused.status_code == 409 and refused.json()["type"].endswith("/email-not-set-up")
    client.put(URL, json=GOOD, headers=owner)
    sent = client.post(f"{URL}/test", json={}, headers=owner)
    assert sent.status_code == 200, sent.text
    message = FakeSMTP.sent[-1]
    assert message["To"] == sent.json()["to"]  # the owner's own address
    assert message["From"] == "AstrologyStudio <studio@example.com>"
    assert "test message" in message["Subject"]
    assert ("starttls",) in FakeSMTP.calls
    assert ("login", "studio@example.com", "s3cret-pass") in FakeSMTP.calls
    other = client.post(f"{URL}/test", json={"to": "someone@example.org"}, headers=owner).json()
    assert other["to"] == "someone@example.org" and FakeSMTP.sent[-1]["To"] == "someone@example.org"
    # SSL/TLS from the start: no STARTTLS.
    client.put(URL, json={**GOOD, "security": "ssl", "port": 465}, headers=owner)
    FakeSMTP.calls.clear()
    client.post(f"{URL}/test", json={}, headers=owner)
    assert ("starttls",) not in FakeSMTP.calls and ("connect", "smtp.example.com", 465) in FakeSMTP.calls


def test_failures_are_explained(client: TestClient, owner: dict[str, str]) -> None:
    client.put(URL, json=GOOD, headers=owner)
    FakeSMTP.refuse_login = True
    failed = client.post(f"{URL}/test", json={}, headers=owner)
    assert failed.status_code == 502
    assert failed.json()["title"] == "The email server didn't accept the username or password"


def test_only_the_owner(client: TestClient, owner: dict[str, str]) -> None:
    client.put(URL, json=GOOD, headers=owner)
    client.post(
        "/api/v1/users", json={"name": "Ann", "email": "ann@example.com", "password": PASSWORD}, headers=owner
    )
    client.post("/api/v1/auth/logout", headers=owner)
    login = client.post("/api/v1/auth/login", json={"email": "ann@example.com", "password": PASSWORD})
    ann = {"X-CSRF-Token": login.json()["csrf_token"]}
    assert client.get(URL).status_code == 403
    assert client.put(URL, json=GOOD, headers=ann).status_code == 403
    assert client.post(f"{URL}/test", json={}, headers=ann).status_code == 403
    assert client.delete(URL, headers=ann).status_code == 403
