"""
AstrologyStudio ·
server/tests/e2e/test_signup.py

Signing up on this site's own pages (with a site key), the Site key field, "I don't have a key"
and switching to a key from another site, in a real browser.

Copyright (c) 2026 Gavin Melhuish
MIT License; see LICENSE in the project root.
SPDX-License-Identifier: MIT
"""

from __future__ import annotations

from typing import Any

import pytest

from ..fake_ephemeral import GOOD_KEY, SITE_KEY, FakeEphemeral
from .conftest import Page

expect = pytest.importorskip("playwright.sync_api").expect

pytestmark = pytest.mark.e2e

SECRET = "a good long password"


def test_signing_up_here(page: Page, browser: Any, fake_ephemeral: FakeEphemeral) -> None:
    p = page.page
    page.go("/settings?section=ephemeral")
    p.locator("#field-site-key").fill(SITE_KEY)
    p.locator("form", has=p.locator("#field-site-key")).get_by_role("button", name="Check and save").click()
    expect(p.get_by_text("Come back to")).to_be_visible()
    page.api("PUT", "/auth/registration", {"open": True})
    try:
        stranger = browser.new_context().new_page()
        stranger.goto(page.base + "/")
        stranger.get_by_role("button", name="Create an account").click()
        stranger.get_by_label("Name").fill("Newcomer")
        stranger.get_by_label("Email").fill("newcomer@example.com")
        stranger.get_by_role("button", name="Create account").click()
        expect(stranger.get_by_text("Click it to confirm your address")).to_be_visible()
        link = fake_ephemeral.outbox[-1]["link"]
        assert link.startswith(page.base + "/auth/verify?t=")
        stranger.goto(link)
        stranger.locator("#verify-password").fill(SECRET)
        stranger.locator("#verify-again").fill(SECRET)
        stranger.get_by_role("button", name="Save and continue").click()
        stranger.wait_for_url("**/charts")
        # A used link says so.
        stranger.context.clear_cookies()
        stranger.goto(link)
        stranger.locator("#verify-password").fill(SECRET)
        stranger.locator("#verify-again").fill(SECRET)
        stranger.get_by_role("button", name="Save and continue").click()
        expect(stranger.get_by_role("heading", name="This link has expired or been used")).to_be_visible()
        stranger.context.close()
    finally:
        page.api("PUT", "/auth/registration", {"open": False})
        page.api("DELETE", "/connection/site-key")
    assert not page.errors, page.errors


def test_switching_to_a_key_from_another_site(page: Page, fake_ephemeral: FakeEphemeral) -> None:
    p = page.page
    fake_ephemeral.registered["elsewhere@example.net"] = {"name": "Me", "verified": True, "password": SECRET}
    fake_ephemeral.new_key_for("elsewhere@example.net")
    try:
        page.go("/account")
        p.get_by_text("Use my key from another site").click()
        p.locator("#elsewhere-email").fill("elsewhere@example.net")
        p.locator("#elsewhere-password").fill(SECRET)
        p.get_by_role("button", name="Log in").click()
        p.locator("#elsewhere-code").fill("123456")
        p.get_by_role("button", name="Get my key").click()
        dialog = p.get_by_role("dialog", name="Your charts")
        expect(dialog).to_contain_text("of your charts aren't on this key's chart list")
        dialog.get_by_role("button", name="Keep my current key").click()
        expect(p.get_by_text("Kept your current key.")).to_be_visible()
        assert page.api("GET", "/account/ephemeral-key")["prefix"] == GOOD_KEY[:8]
    finally:
        page.api("PUT", "/account/ephemeral-key", {"api_key": GOOD_KEY})
    assert not page.errors, page.errors


def test_i_dont_have_a_key(page: Page) -> None:
    p = page.page
    page.api("DELETE", "/account/ephemeral-key")
    try:
        page.go("/account")
        p.get_by_text("I don't have a key").click()
        p.get_by_role("button", name="Create my account").click()
        expect(p.get_by_text("ephemeralREST has emailed")).to_be_visible()
    finally:
        page.api("PUT", "/account/ephemeral-key", {"api_key": GOOD_KEY})
    # With no key, the app's own chart requests answer 409 "add your key first": expected here.
    assert not [e for e in page.errors if "409" not in e], page.errors
    page.errors.clear()


def test_show_and_replace_my_key(page: Page, fake_ephemeral: FakeEphemeral) -> None:
    p = page.page
    page.go("/account")
    p.get_by_role("button", name="Show my key").click()
    dialog = p.get_by_role("dialog", name="Your key")
    dialog.locator("#reauth-password").fill("wrong password")
    dialog.get_by_role("button", name="Continue").click()
    expect(dialog.get_by_text("That password isn't right")).to_be_visible()
    from .conftest import PASSWORD

    dialog.locator("#reauth-password").fill(PASSWORD)
    dialog.get_by_role("button", name="Continue").click()
    expect(dialog.locator(".key-shown code")).to_have_text(GOOD_KEY)
    dialog.get_by_role("button", name="Done").click()
    expect(p.get_by_role("dialog")).to_have_count(0)
    try:
        # Within 5 minutes: no second check.
        p.get_by_role("button", name="Replace my key").click()
        dialog = p.get_by_role("dialog", name="Replace your key")
        expect(dialog).to_contain_text("will stop working everywhere")
        dialog.get_by_role("button", name="Replace my key").click()
        expect(dialog.get_by_text("Your key has been replaced.")).to_be_visible()
        new = dialog.locator(".key-shown code").text_content()
        assert new and new != GOOD_KEY
        assert page.api("GET", "/account/ephemeral-key")["prefix"] == new[:8]
    finally:
        # Put the original key back for the other tests.
        replaced = page.api("GET", "/account/ephemeral-key")["prefix"]
        for key in list(fake_ephemeral.lists):
            if key.startswith(replaced) and key != GOOD_KEY:
                fake_ephemeral.lists[GOOD_KEY] = fake_ephemeral.lists.pop(key)
                fake_ephemeral.identities[GOOD_KEY] = fake_ephemeral.identities.pop(key)
        page.api("PUT", "/account/ephemeral-key", {"api_key": GOOD_KEY})
    page.errors[:] = [e for e in page.errors if "422" not in e]  # the wrong password, on purpose
    assert not page.errors, page.errors
