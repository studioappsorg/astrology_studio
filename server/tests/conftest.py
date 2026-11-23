"""
AstrologyStudio ·
server/tests/conftest.py

Test fixtures:

settings with a temporary database, a stand-in ephemeralREST, a test client, and signed-in
owners and users.

Copyright (c) 2026 Gavin Melhuish
MIT License; see LICENSE in the project root.
SPDX-License-Identifier: MIT
"""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from astrologystudio.app import create_app
from astrologystudio.config import Settings

from .fake_ephemeral import GOOD_KEY, FakeEphemeral

PASSWORD = "correct horse battery"


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    return Settings(data_dir=tmp_path / "data", ephemeral_url="http://ephemeral.test")


@pytest.fixture
def fake() -> FakeEphemeral:
    return FakeEphemeral()


@pytest.fixture
def client(settings: Settings, fake: FakeEphemeral) -> Iterator[TestClient]:
    app = create_app(settings)
    app.state.ephemeral_transport = fake.transport
    with TestClient(app) as test_client:  # runs startup (migrations)
        yield test_client


def sign_up(client: TestClient, email: str = "owner@example.com") -> dict[str, str]:
    """Create the owner account; returns headers carrying the CSRF token."""
    response = client.post("/api/v1/auth/setup", json={"name": "Owner", "email": email, "password": PASSWORD})
    assert response.status_code == 200, response.text
    return {"X-CSRF-Token": response.json()["csrf_token"]}


@pytest.fixture
def owner(client: TestClient) -> dict[str, str]:
    return sign_up(client)


@pytest.fixture
def ready(client: TestClient, owner: dict[str, str]) -> dict[str, str]:
    """Signed in as the owner, with a working ephemeralREST key saved."""
    response = client.put("/api/v1/account/ephemeral-key", json={"api_key": GOOD_KEY}, headers=owner)
    assert response.status_code == 200, response.text
    return owner
