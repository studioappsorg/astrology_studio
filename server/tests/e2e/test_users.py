"""
AstrologyStudio ·
server/tests/e2e/test_users.py

The owner's user window (switch off, limits, activity), and that the browser never talks to
anywhere but this site.

Copyright (c) 2026 Gavin Melhuish
MIT License; see LICENSE in the project root.
SPDX-License-Identifier: MIT
"""

from __future__ import annotations

from urllib.parse import urlsplit

import pytest

from .conftest import Page

expect = pytest.importorskip("playwright.sync_api").expect

pytestmark = pytest.mark.e2e


def test_the_user_window(page: Page) -> None:
    p = page.page
    bea = page.api(
        "POST", "/users", {"name": "Bea", "email": "bea@example.com", "password": "bea-password-1"}
    )
    try:
        page.go("/users")
        p.get_by_role("button", name="Bea").click()
        dialog = p.get_by_role("dialog", name="Bea")
        expect(dialog.get_by_text("With a password here")).to_be_visible()
        dialog.locator("#disable-reason").fill("testing")
        dialog.get_by_label("Allowed to log in").uncheck()
        expect(dialog.get_by_text("Reason: testing")).to_be_visible()
        expect(dialog.locator(".activity__table")).to_contain_text("Switched off")
        dialog.get_by_label("Use site defaults").uncheck()
        dialog.locator("#user-limit-day").fill("100")
        dialog.get_by_role("button", name="Save limits").click()
        expect(dialog.get_by_text("0 of 100 today")).to_be_visible()
        expect(dialog.locator(".activity__table")).to_contain_text("Limits changed")
        dialog.get_by_role("button", name="Failures only").click()
        expect(dialog.get_by_text("Nothing yet.")).to_be_visible()
        dialog.get_by_role("button", name="Close", exact=True).last.click()
        expect(p.locator("tr.is-disabled")).to_contain_text("Bea")
        assert page.api("GET", f"/users/{bea['id']}")["limits"]["day"] == 100
    finally:
        page.api("DELETE", f"/users/{bea['id']}")
    assert not page.errors, page.errors


def test_the_browser_only_talks_to_this_site(page: Page) -> None:
    """connect-src 'self': every call to ephemeralREST is made by the server."""
    p = page.page
    seen: list[str] = []
    p.on("request", lambda r: seen.append(r.url))
    for path in ("/charts", f"/charts/{page.chart_id()}", "/ephemeris", "/settings", "/account", "/users"):
        page.go(path)
    here = urlsplit(page.base).netloc
    elsewhere = [u for u in seen if urlsplit(u).scheme in ("http", "https") and urlsplit(u).netloc != here]
    assert elsewhere == []
    assert len(seen) > 10
    assert not page.errors, page.errors
