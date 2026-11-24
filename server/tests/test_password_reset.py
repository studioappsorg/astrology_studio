"""
AstrologyStudio ·
server/tests/test_password_reset.py

Tests:

"Forgot your password?": the emailed link sets a new password once, within the hour, and logs
the account out everywhere; the answer never shows whether an account exists; and it needs
email set up.

Copyright (c) 2026 Gavin Melhuish
MIT License; see LICENSE in the project root.
SPDX-License-Identifier: MIT
"""

from __future__ import annotations

import re

import pytest
from fastapi.testclient import TestClient

from astrologystudio import mail
from astrologystudio.config import Settings
from astrologystudio.db import connect

from .conftest import PASSWORD
from .test_email import GOOD, FakeSMTP

ANN = {"name": "Ann", "email": "ann@example.com", "password": PASSWORD}
NEW = "a-brand-new-password"


@pytest.fixture(autouse=True)
def fake_smtp(monkeypatch: pytest.MonkeyPatch) -> None:
    FakeSMTP.sent, FakeSMTP.calls, FakeSMTP.refuse_login = [], [], False
    monkeypatch.setattr(mail, "SMTP", FakeSMTP)
    monkeypatch.setattr(mail, "SMTP_SSL", FakeSMTP)


def token_from_last_email() -> str:
    body = FakeSMTP.sent[-1].get_content()
    found = re.search(r"/reset-password\?token=(\S+)", body)
    assert found, body
    return found.group(1)


def test_needs_email(client: TestClient, owner: dict[str, str]) -> None:
    assert client.get("/api/v1/auth/status").json()["password_reset"] is False
    refused = client.post("/api/v1/auth/password-reset", json={"email": "owner@example.com"})
    assert refused.status_code == 409


def test_reset_by_email(client: TestClient, owner: dict[str, str]) -> None:
    client.put("/api/v1/email", json=GOOD, headers=owner)
    client.post("/api/v1/users", json=ANN, headers=owner)
    # Ann is logged in somewhere.
    other = TestClient(client.app)
    login = {"email": ANN["email"], "password": PASSWORD}
    assert other.post("/api/v1/auth/login", json=login).status_code == 200
    assert client.get("/api/v1/auth/status").json()["password_reset"] is True

    asked = client.post("/api/v1/auth/password-reset", json={"email": "Ann@Example.com"})
    assert asked.status_code == 202 and len(FakeSMTP.sent) == 1
    assert FakeSMTP.sent[-1]["To"] == "ann@example.com"
    token = token_from_last_email()
    assert client.get(f"/api/v1/auth/password-reset/{token}").json() == {"email": "ann@example.com"}
    # Asking again straight away sends nothing more.
    client.post("/api/v1/auth/password-reset", json={"email": "ann@example.com"})
    assert len(FakeSMTP.sent) == 1

    weak = client.post("/api/v1/auth/password-reset/finish", json={"token": token, "new_password": "short"})
    assert weak.status_code == 422
    done = client.post("/api/v1/auth/password-reset/finish", json={"token": token, "new_password": NEW})
    assert done.status_code == 204
    # Used up, and Ann is logged out everywhere; the new password works, the old one doesn't.
    again = client.post("/api/v1/auth/password-reset/finish", json={"token": token, "new_password": NEW})
    assert again.status_code == 410
    assert other.get("/api/v1/auth/me").status_code == 401
    assert client.post("/api/v1/auth/login", json=login).status_code == 401
    assert client.post("/api/v1/auth/login", json={"email": ANN["email"], "password": NEW}).status_code == 200


def test_the_answer_never_shows_who_has_an_account(client: TestClient, owner: dict[str, str]) -> None:
    client.put("/api/v1/email", json=GOOD, headers=owner)
    nobody = client.post("/api/v1/auth/password-reset", json={"email": "nobody@example.com"})
    assert nobody.status_code == 202 and nobody.json() == {"sent": True} and not FakeSMTP.sent
    # Even when sending fails.
    client.post("/api/v1/users", json=ANN, headers=owner)
    FakeSMTP.refuse_login = True
    failing = client.post("/api/v1/auth/password-reset", json={"email": ANN["email"]})
    assert failing.status_code == 202 and failing.json() == {"sent": True}


def test_links_expire(client: TestClient, owner: dict[str, str], settings: Settings) -> None:
    client.put("/api/v1/email", json=GOOD, headers=owner)
    client.post("/api/v1/users", json=ANN, headers=owner)
    client.post("/api/v1/auth/password-reset", json={"email": ANN["email"]})
    token = token_from_last_email()
    db = connect(settings.database_path)
    db.execute("UPDATE password_resets SET expires_at = '2000-01-01T00:00:00.000Z'")
    db.commit()
    assert client.get(f"/api/v1/auth/password-reset/{token}").status_code == 410
    assert client.get("/api/v1/auth/password-reset/not-a-real-token-at-all").status_code == 410


def test_ephemeral_accounts_are_told_where(
    client: TestClient, owner: dict[str, str], settings: Settings
) -> None:
    client.put("/api/v1/email", json=GOOD, headers=owner)
    client.post("/api/v1/users", json=ANN, headers=owner)
    db = connect(settings.database_path)
    db.execute("UPDATE users SET signs_in_with = 'ephemeral' WHERE email = ?", (ANN["email"],))
    db.commit()
    client.post("/api/v1/auth/password-reset", json={"email": ANN["email"]})
    body = FakeSMTP.sent[-1].get_content()
    assert "ephemeralREST" in body and "reset-password?token=" not in body
