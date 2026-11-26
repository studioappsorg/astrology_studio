"""
AstrologyStudio ·
server/tests/e2e/test_email_design.py

Settings → Email: editing an email design, previewing it, and sending a test.

Copyright (c) 2026 Gavin Melhuish
MIT License; see LICENSE in the project root.
SPDX-License-Identifier: MIT
"""

from __future__ import annotations

import pytest

from .conftest import Page

expect = pytest.importorskip("playwright.sync_api").expect

pytestmark = pytest.mark.e2e


def test_editing_previewing_and_testing_an_email(page: Page, monkeypatch: pytest.MonkeyPatch) -> None:
    from astrologystudio import mail

    from ..test_email import GOOD, FakeSMTP

    FakeSMTP.sent, FakeSMTP.calls, FakeSMTP.refuse_login = [], [], False
    monkeypatch.setattr(mail, "SMTP", FakeSMTP)
    monkeypatch.setattr(mail, "SMTP_SSL", FakeSMTP)
    page.api("PUT", "/email", GOOD)
    p = page.page
    try:
        page.go("/settings?section=email")
        expect(p.get_by_text("Send a test message, so we know email works.")).to_be_visible()
        p.get_by_role("button", name="Welcome: your account is ready").click()
        body = p.locator("#body-welcome")
        body.fill("Hello {name}, welcome to **{site}**.\n\n[[Start|{login_link}]]")
        frame = p.frame_locator("iframe[title='Preview of Welcome: your account is ready']")
        expect(frame.locator("strong")).to_have_text("AstrologyStudio")
        expect(frame.get_by_role("link", name="Start")).to_be_visible()
        p.get_by_role("button", name="Plain text").click()
        expect(p.locator(".email-preview__text")).to_contain_text("Start: https://example.com/")
        body.fill("Hello {nobody}")
        expect(p.get_by_text("Unknown: {nobody}.")).to_be_visible()
        body.fill("Hello {name}!")
        p.get_by_role("button", name="Save", exact=True).click()
        expect(p.get_by_text("Saved.", exact=True)).to_be_visible()
        p.get_by_role("button", name="Send me a test").click()
        expect(p.get_by_text("Sent to owner@example.com.")).to_be_visible()
        assert FakeSMTP.sent[-1]["Subject"] == "Welcome to AstrologyStudio"
        assert "Hello Ann Example!" in FakeSMTP.sent[-1].get_body(("plain",)).get_content()
    finally:
        page.api("DELETE", "/email/templates/welcome")
    page.errors[:] = [e for e in page.errors if "422" not in e]  # the {nobody} preview, on purpose
    assert not page.errors, page.errors
