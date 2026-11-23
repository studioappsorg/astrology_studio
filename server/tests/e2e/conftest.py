"""
AstrologyStudio ·
server/tests/e2e/conftest.py

Browser tests:

the real web app (web/dist) against this server, with the stand-in ephemeralREST.

Run with `pytest -m e2e` after `npm run build` in web/. They need Playwright and a Chromium:
`pip install playwright && playwright install chromium` (or point PLAYWRIGHT_CHROMIUM at an
installed Chrome). Skipped when either is missing, so the ordinary test run doesn't need them.

Copyright (c) 2026 Gavin Melhuish
MIT License; see LICENSE in the project root.
SPDX-License-Identifier: MIT
"""

from __future__ import annotations

import os
import socket
import threading
import time
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import httpx
import pytest

from astrologystudio import catalog
from astrologystudio.app import create_app
from astrologystudio.config import Settings

from ..conftest import PASSWORD
from ..fake_ephemeral import GOOD_KEY, FakeEphemeral

playwright_api = pytest.importorskip("playwright.sync_api")
uvicorn = pytest.importorskip("uvicorn")

WEB = Path(__file__).resolve().parents[3] / "web" / "dist"
OWNER = "owner@example.com"
JANE = {"name": "Jane Doe", "date": "1985-06-12", "time": "14:30", "place": "Perth"}
JOHN = {"name": "John Smith", "date": "1983-01-20", "time": "06:00", "place": "London"}


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return int(s.getsockname()[1])


@pytest.fixture(scope="session")
def server(tmp_path_factory: pytest.TempPathFactory) -> Iterator[str]:
    if not (WEB / "index.html").exists():
        pytest.skip("Build the web app first (npm run build in web/)")
    settings = Settings(
        data_dir=tmp_path_factory.mktemp("data"), ephemeral_url="http://ephemeral.test", web_dir=WEB
    )
    app = create_app(settings)
    app.state.ephemeral_transport = FakeEphemeral().transport
    port = _free_port()
    config = uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning")
    running = uvicorn.Server(config)
    thread = threading.Thread(target=running.run, daemon=True)
    thread.start()
    base = f"http://127.0.0.1:{port}"
    for _ in range(100):
        try:
            httpx.get(f"{base}/api/v1/health", timeout=1)
            break
        except httpx.HTTPError:
            time.sleep(0.1)
    # The owner, their ephemeralREST key and one chart.
    with httpx.Client(base_url=base) as api:
        token = api.post(
            "/api/v1/auth/setup", json={"name": "Owner", "email": OWNER, "password": PASSWORD}
        ).json()["csrf_token"]
        headers = {"X-CSRF-Token": token}
        api.put("/api/v1/account/ephemeral-key", json={"api_key": GOOD_KEY}, headers=headers)
        api.post("/api/v1/charts", json=JANE, headers=headers)
        api.post("/api/v1/charts", json=JOHN, headers=headers)
    yield base
    running.should_exit = True
    thread.join(timeout=5)


@pytest.fixture(scope="session")
def browser() -> Iterator[Any]:
    with playwright_api.sync_playwright() as p:
        chrome = os.environ.get("PLAYWRIGHT_CHROMIUM")
        try:
            launched = (
                p.chromium.launch(executable_path=chrome, args=["--no-sandbox"])
                if chrome
                else p.chromium.launch()
            )
        except Exception as error:  # any launch failure means "no browser here"
            pytest.skip(f"No Chromium for Playwright: {error}")
        yield launched
        launched.close()


class Page:
    """A logged-in page, with the errors the app logged."""

    def __init__(self, page: Any, base: str) -> None:
        self.page = page
        self.base = base
        self.errors: list[str] = []
        page.on("pageerror", lambda e: self.errors.append(str(e)))
        page.on("console", lambda m: m.type == "error" and self.errors.append(m.text))

    def go(self, path: str) -> None:
        self.page.goto(self.base + path)
        self.page.wait_for_load_state("networkidle")

    def api(self, method: str, path: str, body: Any = None) -> Any:
        """Call the API as the logged-in person (same cookies and security token)."""
        return self.page.evaluate(
            """async ([method, path, body]) => {
                const me = await (await fetch('/api/v1/auth/me')).json();
                const headers = { 'Content-Type': 'application/json', 'X-CSRF-Token': me.csrf_token };
                const sent = body === null ? undefined : JSON.stringify(body);
                const r = await fetch('/api/v1' + path, { method, headers, body: sent });
                return r.status === 204 ? null : r.json();
            }""",
            [method, path, body],
        )

    def chart_id(self) -> str:
        charts = self.api("GET", "/charts")["data"]
        return str(next(c["id"] for c in charts if c["name"] == JANE["name"]))


FEATURE_KEYS = tuple(catalog.FEATURES)


@pytest.fixture
def page(server: str, browser: Any) -> Iterator[Page]:
    context = browser.new_context(viewport={"width": 1400, "height": 900}, accept_downloads=True)
    raw = context.new_page()
    wrapped = Page(raw, server)
    wrapped.go("/")
    raw.get_by_label("Email").fill(OWNER)
    raw.get_by_label("Password").fill(PASSWORD)
    raw.get_by_role("button", name="Log in").click()
    raw.wait_for_url("**/charts")
    # Start each test from the same screen choices.
    wrapped.api(
        "PATCH",
        "/preferences/remembered",
        {
            "values": {
                "canvas-display": "wheel",
                "wheel-count": 1,
                "wheel-slots": [None, None, None],
                "preset": "",
                "chart-report": "chart",
                "wheel-aspectarian": False,
                "dial-trees": False,
                "dial-sizes": [90],
                "dial-modulus": 90,
                "default-preset": "",
                "events-movers-transits": None,
                "events-movers-progressions": None,
                "events-movers-solar-arc": None,
                "events-targets": None,
                "preset-apply-mode": "",
            }
        },
    )
    wrapped.api("PATCH", "/preferences/appearance", {"theme": "studio", "text_size": 100})
    wrapped.api("PUT", "/preferences/defaults", {"house_system": "placidus", "place": ""})
    # Every feature on, so each test can reach what it checks (new people start with fewer).
    wrapped.api(
        "PATCH",
        "/preferences/view",
        {"features": dict.fromkeys(FEATURE_KEYS, True), "display": {"school": "self"}},
    )
    # Every chart starts with one view made from those choices.
    for chart in wrapped.api("GET", "/charts")["data"]:
        wrapped.api("DELETE", f"/preferences/chart-views/{chart['id']}")
    yield wrapped
    context.close()
    assert not wrapped.errors, wrapped.errors
