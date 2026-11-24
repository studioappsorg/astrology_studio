"""
AstrologyStudio ·
server/tests/e2e/test_smoke.py

The main paths through the app, in a real browser.

Copyright (c) 2026 Gavin Melhuish
MIT License; see LICENSE in the project root.
SPDX-License-Identifier: MIT
"""

from __future__ import annotations

import math
import re
from typing import Any

import pytest

from .conftest import Page

# Playwright's checks retry until they pass (up to 5 s), so they wait for the app to catch up
# instead of reading a value the moment before it changes. Skipped without Playwright.
expect = pytest.importorskip("playwright.sync_api").expect

pytestmark = pytest.mark.e2e


def report(p: Any, name: str) -> None:
    """Open one of the report tabs across the top of the chart screen."""
    p.get_by_role("tablist", name="Reports").get_by_role("tab", name=name, exact=True).click()


def test_chart_screen(page: Page) -> None:
    page.go(f"/charts/{page.chart_id()}")
    p = page.page
    p.locator("svg.wheel").first.wait_for()
    assert p.locator(".wheel__body").count() >= 10
    assert p.get_by_text("Chart 1 Positions", exact=False).count() >= 1
    # The panel holds the charts and positions only; aspects are a report tab.
    assert p.locator(".workspace__panel .aspect-grid, .workspace__panel .midpoint-panel").count() == 0
    report(p, "Aspects")
    p.locator(".workspace__report .aspect-grid").wait_for()
    assert p.locator(".aspect-list tbody tr").count() >= 5
    report(p, "Chart")
    p.locator("svg.wheel").first.wait_for()


def test_chart_types_and_the_dial_pointer(page: Page) -> None:
    page.api("PATCH", "/preferences/appearance", {"text_size": 115})
    page.go(f"/charts/{page.chart_id()}")
    p = page.page
    p.get_by_label("Chart type").select_option("hellenistic")
    p.locator(".wheel__body").first.wait_for()
    report(p, "Hellenistic")
    p.locator(".sect-line").wait_for()
    p.locator(".slot-positions__detail").first.wait_for()  # lords and dignities under each body
    assert p.locator(".slot-positions-block thead th").all_inner_texts() == ["BODY", "LONG.", "HOUSE"]
    # The two cards are the same width and fill the report.
    widths = p.locator(".report__columns--halves > .report__card").evaluate_all(
        "cards => cards.map(c => c.getBoundingClientRect().width)"
    )
    assert len(widths) == 2 and abs(widths[0] - widths[1]) < 1
    report(p, "Chart")
    p.get_by_label("Chart type").select_option("dial")
    dial = p.locator("svg.dial")
    dial.wait_for()
    box = dial.bounding_box()
    assert box is not None
    # Click at three o'clock: on a dial running anticlockwise from the top, that's 270° round.
    p.mouse.click(box["x"] + box["width"] * 0.93, box["y"] + box["height"] / 2)
    line = p.locator(".dial__pointer line")
    x2, y2 = float(line.get_attribute("x2") or 0), float(line.get_attribute("y2") or 0)
    angle = math.degrees(math.atan2(-(x2 - 300), -(y2 - 300))) % 360
    assert abs(angle - 270) < 2, angle  # pointer lands where clicked, even with larger text
    # Dragging the pointer redraws only the dial, nothing around it (that made the screen flicker),
    # and the pointer stays where it was let go.
    outside = p.evaluate("""async () => {
        const svg = document.querySelector('svg.dial'); const r = svg.getBoundingClientRect();
        const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        let outside = 0;
        new MutationObserver(ms => { for (const m of ms) if (!svg.contains(m.target)) outside++; })
            .observe(document.body, {subtree: true, childList: true, attributes: true, characterData: true});
        const ev = (type, a) => svg.dispatchEvent(new PointerEvent(type, {bubbles: true, pointerId: 1,
            clientX: cx + 200 * Math.cos(a), clientY: cy - 200 * Math.sin(a), button: 0}));
        ev('pointerdown', 0);
        for (let i = 1; i < 20; i++) {
            ev('pointermove', i * 0.05);
            await new Promise(f => requestAnimationFrame(f));
        }
        return outside;
    }""")
    assert outside == 0, outside


def test_theme_editor(page: Page) -> None:
    page.go("/view")
    p = page.page
    p.get_by_role("tab", name="Appearance").click()
    p.locator(".theme-card", has_text="Parchment").get_by_role("button", name="Duplicate").click()
    p.wait_for_url(re.compile(r"/view/themes/"))
    p.get_by_label("Canvas background (hex)").fill("#2d3b2f")
    p.get_by_role("button", name="Save").click()
    p.wait_for_url("**/view")
    p.locator(".theme-card", has_text="Parchment copy").get_by_role("button", name="Use").click()
    p.locator(".theme-card.is-active", has_text="Parchment copy").wait_for()
    page.go(f"/charts/{page.chart_id()}")
    stage = p.locator(".workspace__stage")
    stage.wait_for()
    # As drawn: the canvas colour (color-mix() reports it in its own notation, so read a pixel's worth).
    drawn = stage.evaluate("""e => { const c = document.createElement('canvas').getContext('2d');
        c.fillStyle = getComputedStyle(e).backgroundColor; c.fillRect(0, 0, 1, 1);
        return [...c.getImageData(0, 0, 1, 1).data].slice(0, 3); }""")
    assert drawn == [45, 59, 47]


def test_presets(page: Page) -> None:
    page.go(f"/charts/{page.chart_id()}")
    p = page.page
    p.get_by_label("Chart type").select_option("dial")
    p.locator("svg.dial").wait_for()
    preset = p.get_by_label("Preset", exact=True)
    preset.select_option("__new")
    p.get_by_label("Name").fill("Dial work")
    p.get_by_role("button", name="Save preset").click()
    p.locator(".preset-notice").wait_for()
    p.get_by_label("Chart type").select_option("wheel")
    p.locator("svg.wheel:not(.dial)").wait_for()
    assert "(changed)" in preset.evaluate("s => s.options[s.selectedIndex].text")
    chosen = preset.evaluate("s => [...s.options].find(o => o.text.startsWith('Dial work')).value")
    preset.select_option(chosen)
    p.locator("svg.dial").wait_for()
    expect(p.get_by_label("Chart type")).to_have_value("dial")


def test_harmonic_chart(page: Page) -> None:
    page.go(f"/charts/{page.chart_id()}")
    p = page.page
    p.get_by_role("button", name="Add chart 2").click()
    p.get_by_role("tab", name="Derived chart").click()
    p.locator("select[id$=-kind]").select_option("harmonic")
    p.get_by_role("button", name="H7").click()
    p.get_by_role("button", name="Show").click()
    p.get_by_text("Harmonic 7: Jane Doe").first.wait_for()
    assert p.locator(".wheel__bodies--ring-1 .wheel__body").count() >= 10


def test_export_png(page: Page) -> None:
    page.go(f"/charts/{page.chart_id()}")
    p = page.page
    p.locator("svg.wheel").first.wait_for()
    with p.expect_download() as download:
        p.get_by_role("button", name="PNG").click()
    assert download.value.suggested_filename.endswith(".png")


def test_downloading_data_and_deleting_an_account(page: Page, browser: object) -> None:
    from .conftest import PASSWORD

    page.api("POST", "/users", {"name": "Bea", "email": "bea@example.com", "password": PASSWORD})
    context = browser.new_context(viewport={"width": 1280, "height": 860}, accept_downloads=True)  # type: ignore[attr-defined]
    p = context.new_page()
    p.goto(page.base + "/")
    p.get_by_label("Email").fill("bea@example.com")
    p.get_by_label("Password").fill(PASSWORD)
    p.get_by_role("button", name="Log in").click()
    p.wait_for_url("**/charts")
    bea = Page(p, page.base)
    bea.api("PUT", "/account/ephemeral-key", {"api_key": "eph_test_key_123456"})
    # (The stand-in ephemeralREST has one chart list for every key, so Bea sees Jane: no welcome here.)
    bea.go("/account")
    with p.expect_download() as download:
        p.get_by_role("link", name="Download my data").click()
    assert download.value.suggested_filename.endswith(".json")
    p.on("dialog", lambda d: d.accept())
    p.get_by_label("Your password, to confirm").fill(PASSWORD)
    p.get_by_role("button", name="Delete my account").click()
    p.get_by_text("Your account has been deleted.").wait_for()
    context.close()


def test_phone_width(page: Page) -> None:
    """At phone width nothing runs off the side, and the chart comes first."""
    p = page.page
    p.set_viewport_size({"width": 390, "height": 844})
    page.go(f"/charts/{page.chart_id()}")
    wheel = p.locator("svg.wheel").first
    wheel.wait_for()
    box = wheel.bounding_box()
    tabs = p.get_by_role("tablist", name="Reports").bounding_box()
    assert box is not None and tabs is not None
    assert box["width"] > 300 and box["y"] > tabs["y"]  # wheel full width, under the report tabs
    assert p.evaluate("document.documentElement.scrollWidth") <= 390
    report(p, "Aspects")
    p.locator(".aspect-grid").wait_for()
    assert p.evaluate("document.documentElement.scrollWidth") <= 390
    for path in ("/view", "/account", "/charts"):
        page.go(path)
        assert p.evaluate("document.documentElement.scrollWidth") <= 390, path


def test_composite_and_davison(page: Page) -> None:
    page.go(f"/charts/{page.chart_id()}")
    p = page.page
    p.locator("svg.wheel").first.wait_for()
    for kind, name in (
        ("composite", "Jane Doe and John Smith: composite"),
        ("davison", "Jane Doe and John Smith: Davison"),
    ):
        p.get_by_role("button", name="Change", exact=True).first.click()
        p.get_by_role("tab", name="Derived chart").click()
        p.locator("select[id$=-kind]").select_option(kind)
        p.locator("select[id$=-other]").select_option(label="John Smith")
        p.get_by_role("button", name="Show").click()
        p.get_by_text(name).first.wait_for()
        assert p.locator(".wheel__body").count() >= 10
    # Both are kept under the From chart: they're in the Change dialog's list of saved charts.
    p.get_by_role("button", name="Change", exact=True).first.click()
    saved = p.get_by_role("dialog").locator(".slot-list__derived")
    for name in ("composite", "Davison"):
        saved.get_by_role("button", name=re.compile(name)).first.wait_for()
    p.keyboard.press("Escape")
    listed = page.api("GET", "/charts")["data"]
    jane = next(c for c in listed if c["id"] == page.chart_id())
    for d in jane["derived"]:
        if "~" in d["id"]:
            page.api("DELETE", f"/charts/{d['id']}")


def test_midpoint_sort_and_search(page: Page) -> None:
    page.go(f"/charts/{page.chart_id()}")
    p = page.page
    p.get_by_label("Chart type").select_option("dial")
    p.locator("svg.dial").wait_for()
    # The positions have headings, and no house column on a dial.
    heads = p.locator(".slot-positions-block thead th")
    assert heads.all_inner_texts() == ["BODY", "LONG."]
    report(p, "Midpoints")
    p.locator(".mp-tree").first.wait_for()
    assert p.get_by_role("tab", name="On the pointer").count() == 0
    p.get_by_role("tab", name="Midpoint sort").click()
    rows = p.locator(".midpoint-panel .sort-table tbody tr")
    assert rows.count() > 40
    dials = rows.locator("td:first-child").all_inner_texts()
    # In order round the dial
    assert dials == sorted(dials, key=lambda t: tuple(int(x) for x in re.findall(r"\d+", t)))
    rows.nth(10).click()
    p.wait_for_function(
        "document.querySelectorAll('.midpoint-panel .sort-table tbody tr')[10].classList.contains('is-focus')"
    )  # the pointer moved there
    # Closest to exact: midpoints on a factor, tightest first.
    p.get_by_role("button", name="Closest to exact").click()
    orbs = rows.locator("td.num").all_inner_texts()
    assert orbs and orbs == sorted(orbs, key=lambda t: tuple(int(x) for x in re.findall(r"\d+", t)))
    assert all("=" in r for r in rows.all_inner_texts())
    p.get_by_role("button", name="Round the dial").click()
    p.get_by_role("tab", name="Search").click()
    p.get_by_label("Degree to search").fill("12°30' Leo")
    p.get_by_role("button", name=re.compile("Put the pointer on")).wait_for()
    # The pointer stays where the report put it when you go back to the dial.
    report(p, "Chart")
    p.locator("svg.dial").wait_for()


def test_aspects_between_two_charts(page: Page) -> None:
    page.go(f"/charts/{page.chart_id()}")
    p = page.page
    p.locator("svg.wheel").first.wait_for()
    p.get_by_role("button", name="Add chart 2").click()
    p.locator(".slot-list button", has_text="John Smith").first.click()
    p.locator(".wheel__bodies--ring-1 .wheel__body").first.wait_for()
    lines = "[...document.querySelectorAll('svg.wheel .wheel__aspect title')].map(t => t.textContent).sort()"
    own = p.evaluate(lines)
    report(p, "Aspects")
    p.get_by_role("button", name="Between 1 and 2").click()
    p.get_by_text("Aspects between charts 1 and 2").first.wait_for()
    assert p.locator(".aspect-grid").count() == 1
    # The chart still draws only the selected chart's own aspects, never those between the charts.
    report(p, "Chart")
    p.locator(".wheel__aspect").first.wait_for()
    assert p.evaluate(lines) == own
    # Two charts at most: chart 1 left of the chart and chart 2 right, on the canvas; the panel
    # holds positions only.
    assert p.locator(".workspace__dock .slot").count() == 2
    assert p.locator(".workspace__panel .slot").count() == 0
    # Clearing chart 2 goes back to one chart, with the offer to add it again.
    p.get_by_role("button", name="Clear chart 2", exact=True).click()
    p.get_by_role("button", name="Add chart 2").wait_for()


def test_natal_inside_on_the_dial(page: Page) -> None:
    """Chart 1 (the natal chart) is the inner ring on the dial, as on the bi-wheel; chart 2 outside."""
    page.go(f"/charts/{page.chart_id()}")
    p = page.page
    p.locator("svg.wheel").first.wait_for()
    p.get_by_role("button", name="Add chart 2").click()
    p.locator(".slot-list button", has_text="John Smith").first.click()
    p.locator(".wheel__bodies--ring-1 .wheel__body").first.wait_for()
    p.get_by_label("Chart type").select_option("dial")
    p.locator("svg.dial").wait_for()

    def reach(ring: int) -> float:
        return float(
            p.locator(f"svg.dial .wheel__bodies--ring-{ring}").evaluate(
                """g => Math.max(...[...g.querySelectorAll('circle')].map(
                    c => Math.hypot(c.cx.baseVal.value - 300, c.cy.baseVal.value - 300)))"""
            )
        )

    assert reach(0) < reach(1)  # chart 1's dots sit inside chart 2's


def test_events_report(page: Page) -> None:
    p = page.page
    page.go(f"/charts/{page.chart_id()}/events")  # the old address opens the chart screen's Events tab
    p.get_by_role("button", name="List events").click()
    p.locator(".events-table tbody tr").first.wait_for()
    assert p.locator(".events-table .month-row").count() >= 1
    # Choose the bodies: Saturn alone, to the Sun alone.
    moving = p.get_by_role("group", name="Transiting")
    natal = p.get_by_role("group", name="To natal")
    expect(moving.get_by_role("button", name="Moon")).to_have_attribute("aria-pressed", "false")
    moving.get_by_role("button", name="None").click()
    assert p.get_by_role("button", name="List events").is_disabled()
    moving.get_by_role("button", name="Saturn").click()
    natal.get_by_role("button", name="None").click()
    natal.get_by_role("button", name="Sun").click()
    natal.get_by_role("button", name="Ascendant").click()
    p.get_by_role("textbox", name="To", exact=True).fill(
        f"{int(p.get_by_label('From').input_value()[:4]) + 2}-01-01"
    )
    p.get_by_role("button", name="List events").click()
    p.locator(".events-table tbody tr").first.wait_for()
    titles = p.locator(".events-table tbody tr:not(.month-row)").evaluate_all("rs => rs.map(r => r.title)")
    assert titles
    for t in titles:
        assert t.startswith("t Saturn") and (" natal Sun," in t or " natal Ascendant," in t)
    # Remembered when the page comes back.
    page.go(f"/charts/{page.chart_id()}/events")
    expect(moving.get_by_role("button", name="Saturn")).to_have_attribute("aria-pressed", "true")
    expect(moving.get_by_role("button", name="Jupiter")).to_have_attribute("aria-pressed", "false")
    moving.get_by_role("button", name="Usual").click()
    expect(moving.get_by_role("button", name="Jupiter")).to_have_attribute("aria-pressed", "true")
    report(p, "Aspects")
    p.locator(".aspect-grid").wait_for()


def test_app_frame(page: Page) -> None:
    """Tabs, menus and shortcuts: opening, switching and closing charts like documents."""
    p = page.page
    # Start with no tabs open, whatever earlier tests left.
    page.api("PATCH", "/preferences/remembered", {"values": {"open-tabs": []}})
    page.go("/charts")
    tabs = p.get_by_role("tablist", name="Open tabs")
    tabs.get_by_role("tab", name="Chart library").wait_for()
    assert p.locator(".library-pane").count() == 0  # no chart list down the side any more
    # A chart opens in its own tab; the page itself never scrolls.
    p.get_by_role("link", name="Jane Doe").click()
    p.locator("svg.wheel").first.wait_for()
    assert tabs.get_by_role("tab", name="Jane Doe").get_attribute("aria-selected") == "true"
    assert p.evaluate("document.documentElement.scrollHeight") <= p.evaluate("innerHeight")
    # The report tabs sit over the chart only: the panel runs up beside them.
    bar = p.locator(".workspace__bar").bounding_box()
    panel = p.locator(".workspace__panel").bounding_box()
    assert bar is not None and panel is not None
    assert panel["y"] <= bar["y"] + 1 and bar["x"] >= panel["x"] + panel["width"]
    # Ctrl+K goes to the chart library with the cursor in its search.
    p.keyboard.press("Control+k")
    p.wait_for_url("**/charts")
    p.keyboard.type("john")
    p.get_by_role("link", name="John Smith").click()
    tabs.get_by_role("tab", name="John Smith").wait_for()
    p.wait_for_url(re.compile(r"/charts/[^/]+$"))
    assert tabs.get_by_role("tab").count() == 3
    # Going back to a tab goes back to it.
    tabs.get_by_role("tab", name="Jane Doe").click()
    p.wait_for_url(f"**/charts/{page.chart_id()}")
    # Menus: View → Dial switches the chart type, as the picker does.
    p.get_by_role("menubar", name="Menu").get_by_role("button", name="View", exact=True).click()
    p.get_by_role("menuitemradio", name="Dial").click()
    p.locator("svg.dial").wait_for()
    expect(p.get_by_label("Chart type")).to_have_value("dial")
    # Alt+W closes the tab you're on and moves to its neighbour.
    p.keyboard.press("Alt+w")
    tabs.get_by_role("tab", name="Jane Doe").wait_for(state="detached")
    # Tabs can be dragged to a new place; the chart library stays first. (Reopen Jane from the
    # library rather than reloading the page: a reload straight after closing a tab can beat the
    # save of the open tabs to the server, and bring the closed tab back where it was.)
    tabs.get_by_role("tab", name="Chart library").click()
    p.get_by_role("link", name="Jane Doe").click()
    tabs.get_by_role("tab", name="Jane Doe").wait_for()

    def names() -> list[str]:
        return [n.replace("☉", "").strip() for n in tabs.get_by_role("tab").all_inner_texts()]

    def tabs_are(expected: list[str]) -> None:
        for _ in range(50):
            if names() == expected:
                return
            p.wait_for_timeout(100)
        assert names() == expected

    tabs_are(["Chart library", "John Smith", "Jane Doe"])
    jane = tabs.locator(".doc-tab", has_text="Jane Doe")
    jane.drag_to(tabs.locator(".doc-tab", has_text="John Smith"), target_position={"x": 5, "y": 5})
    tabs_are(["Chart library", "Jane Doe", "John Smith"])
    jane.drag_to(tabs.locator(".doc-tab", has_text="Chart library"), target_position={"x": 5, "y": 5})
    assert names()[0] == "Chart library"
    # The library can't be closed: closing every other tab leaves it, and Alt+W does nothing there.
    assert tabs.get_by_role("button", name="Close Chart library").count() == 0
    while tabs.get_by_role("button", name=re.compile("^Close ")).count():
        tabs.get_by_role("button", name=re.compile("^Close ")).first.click()
    p.wait_for_url(re.compile(r"/charts$"))
    p.keyboard.press("Alt+w")
    tabs_are(["Chart library"])
    # Opening the app's own address goes to the library.
    page.go("/")
    p.wait_for_url(re.compile(r"/charts$"))
    # The status bar says ephemeralREST is answering.
    p.locator(".status-bar__health.is-ok").wait_for()


def test_aspects_in_your_view(page: Page) -> None:
    """Your view → Aspects: an aspect switched off isn't drawn or listed; your colour is used on
    the chart; each line carries its aspect's symbol."""
    p = page.page
    page.go(f"/charts/{page.chart_id()}")
    p.locator(".wheel__aspect").first.wait_for()
    assert p.locator(".wheel__aspect-glyph").count() > 0  # a symbol in the middle of the lines
    page.go("/view")
    p.get_by_role("tab", name="Aspects", exact=True).click()
    p.get_by_label("Trine colour").evaluate(
        "el => { el.value = '#22cc55'; el.dispatchEvent(new Event('change', {bubbles: true})); }"
    )
    p.get_by_role("button", name="Theme colour").wait_for()
    p.get_by_label("Use Trine").uncheck()
    p.wait_for_function(
        "fetch('/api/v1/preferences/calculation').then(r => r.json())"
        ".then(c => !c.profiles.find(x => x.id === c.active).aspects.trine.on)"
    )
    page.go(f"/charts/{page.chart_id()}")
    p.locator(".wheel__aspect").first.wait_for()
    names = p.evaluate("[...document.querySelectorAll('.wheel__aspect title')].map(t => t.textContent)")
    assert not any(" Trine " in n for n in names)
    report(p, "Aspects")
    p.locator(".aspect-list").wait_for()
    assert p.locator(".aspect-list").get_by_text("Trine", exact=True).count() == 0
    colour = p.evaluate("getComputedStyle(document.documentElement).getPropertyValue('--t-aspect-trine')")
    assert colour.strip() == "#22cc55"
    # Back as they were, for the other tests.
    page.api("PATCH", "/preferences/calculation", {"aspects": {"trine": {"on": True}}})
    page.api("PATCH", "/preferences/view", {"aspect_colours": {"trine": None}})


def test_views_of_a_chart(page: Page) -> None:
    """Several views of one chart in its tab: each keeps its own chart type, report and chart 2,
    the title bar's pickers change only the view on screen, and they come back after a reload."""
    p = page.page
    page.go(f"/charts/{page.chart_id()}")
    p.locator("svg.wheel").first.wait_for()
    row = p.get_by_role("tablist", name=re.compile("^Views of"))
    assert row.count() == 0  # one view: nothing new on screen
    p.get_by_role("button", name="Add a view").click()
    p.get_by_role("menuitem", name="As a dial").click()
    p.locator("svg.dial").wait_for()
    chips = row.get_by_role("tab")
    assert chips.all_text_contents() == ["Western", "Dial 90°"]
    report(p, "Midpoints")
    p.locator(".mp-tree").first.wait_for()
    # Each view keeps its own report and chart type.
    chips.filter(has_text="Western").click()
    p.locator("svg.wheel").first.wait_for()
    chart_tab = p.get_by_role("tablist", name="Reports").get_by_role("tab", name="Chart", exact=True)
    assert chart_tab.get_attribute("aria-selected") == "true"
    # The chart type picker changes only the view on screen.
    p.get_by_label("Chart type").select_option("hellenistic")
    labels = "[...document.querySelectorAll('.view-chip')].map(c => c.textContent).join()"
    p.wait_for_function(f"{labels} === 'Hellenistic,Dial 90°'")
    chips.filter(has_text="Dial 90°").click()
    p.locator(".mp-tree").first.wait_for()
    # A view with another chart as chart 2.
    p.get_by_role("button", name="Add a view").click()
    p.get_by_role("menuitem", name="With another chart…").click()
    p.locator(".slot-list button", has_text="John Smith").first.click()
    p.wait_for_function("document.querySelectorAll('.view-chip').length === 3")
    p.locator(".view-chip.is-active", has_text="John Smith").wait_for()
    # Views come back after a reload, on the view last shown.
    p.wait_for_timeout(900)  # saved a moment after each change
    page.go(f"/charts/{page.chart_id()}")
    p.locator(".view-chip.is-active", has_text="John Smith").wait_for()
    # It was added from the dial view, so it's the dial with John Smith outside, on Midpoints.
    assert chips.all_text_contents() == ["Hellenistic", "Dial 90°", "Dial 90° + John Smith"]
    report(p, "Chart")
    p.locator("svg.dial .wheel__bodies--ring-1").first.wait_for()
    # Close a view from its right-click menu.
    chips.filter(has_text="Hellenistic").click(button="right")
    p.get_by_role("menuitem", name="Close view").click()
    p.wait_for_function("document.querySelectorAll('.view-chip').length === 2")
    # Or with its close button: with one view left the row goes away.
    p.get_by_role("button", name="Close view Dial 90° + John Smith").click()
    row.wait_for(state="detached")
    # Another chart keeps its own single view.
    john = next(c["id"] for c in page.api("GET", "/charts")["data"] if c["name"] == "John Smith")
    page.go(f"/charts/{john}")
    p.locator("svg.wheel").first.wait_for()
    assert row.count() == 0


def test_presets_as_sets_of_views(page: Page) -> None:
    """A preset holds a chart's views; new charts can open with it; a preset with several views
    asks whether to replace or add; "ask each time" opens the chart dialog for chart 2."""
    p = page.page
    page.go(f"/charts/{page.chart_id()}")
    p.locator("svg.wheel").first.wait_for()
    p.get_by_role("button", name="Add a view").click()
    p.get_by_role("menuitem", name="As a dial").click()
    p.locator("svg.dial").wait_for()
    p.get_by_role("button", name="Add a view").click()
    p.get_by_role("menuitem", name="With transits now").click()
    p.wait_for_function("document.querySelectorAll('.view-chip').length === 3")
    # The transits chart is worked out after the view appears: wait for it before saving.
    p.locator(".view-chip", has_text="Transits").wait_for()
    p.wait_for_timeout(300)
    # Save them; chart 2 stays "transits now", and new charts open with the preset.
    preset = p.get_by_label("Preset", exact=True)
    preset.select_option("__new")
    p.get_by_label("Name").fill("Full reading")
    p.get_by_role("button", name="Transits now").wait_for()
    p.get_by_label("Open new charts with this preset").check()
    p.get_by_role("button", name="Save preset").click()
    p.locator(".preset-notice").wait_for()
    presets = page.api("GET", "/preferences/appearance")["presets"]
    saved = next(x for x in presets if x["name"] == "Full reading")
    assert [v["display"] for v in saved["views"]] == ["wheel", "dial", "dial"]
    assert saved["views"][2]["partner"] == {"role": "transits_now"}
    expect(preset).to_have_value(saved["id"])  # the picker shows the chart's preset
    # A chart with no views yet opens with the default preset, transits worked out for now.
    john = next(c["id"] for c in page.api("GET", "/charts")["data"] if c["name"] == "John Smith")
    page.api("PATCH", "/preferences/remembered", {"values": {"preset-apply-mode": ""}})
    page.go(f"/charts/{john}")
    p.wait_for_function("document.querySelectorAll('.view-chip').length === 3")
    assert p.locator(".view-chip").last.text_content() == "Dial 90° + Transits"
    # A preset with several views on a chart with several asks first.
    preset.select_option(label="Full reading · 3 views")
    p.get_by_role("button", name="Add after them").click()
    p.wait_for_function("document.querySelectorAll('.view-chip').length === 6")
    # "Ask each time": the chart dialog opens for chart 2.
    page.api(
        "POST",
        "/preferences/presets",
        {"name": "Relationship", "views": [{"display": "wheel", "partner": {"role": "ask"}}]},
    )
    page.go(f"/charts/{page.chart_id()}")
    p.wait_for_function("document.querySelectorAll('.view-chip').length === 3")
    p.locator(".view-chip").first.click()
    preset.select_option(label="Relationship")
    p.locator(".slot-list button", has_text="John Smith").first.click()
    p.locator(".wheel__bodies--ring-1 .wheel__body").first.wait_for()
    assert p.locator(".view-chip").first.text_content() == "+ John Smith"


def test_presets_tab(page: Page) -> None:
    """Your view → Presets: edit a preset's views, set the default, duplicate, reorder, delete."""
    p = page.page
    p.on("dialog", lambda d: d.accept())
    page.api("POST", "/preferences/presets", {"name": "Tab test", "views": [{"display": "wheel"}]})
    page.go(f"/charts/{page.chart_id()}")
    p.get_by_label("Preset", exact=True).select_option("__manage")
    p.get_by_role("tab", name="Presets").wait_for()
    assert p.get_by_role("tab", name="Presets").get_attribute("aria-selected") == "true"
    row = p.locator(".preset-row", has_text="Tab test")
    row.get_by_role("button", name="Edit").click()
    p.get_by_role("button", name="Add a view").click()
    view2 = p.locator(".preset-editor__view").nth(1)
    view2.get_by_label("Chart type").select_option("dial")
    view2.get_by_label("Report tab").select_option("midpoints")
    view2.get_by_label("Chart 2 of view 2").select_option("transits_now")
    p.get_by_role("button", name="Save preset").click()
    p.locator(".preset-editor").wait_for(state="detached")
    saved = next(x for x in page.api("GET", "/preferences/appearance")["presets"] if x["name"] == "Tab test")
    assert [v["display"] for v in saved["views"]] == ["wheel", "dial"]
    assert saved["views"][1]["report"] == "midpoints"
    assert saved["views"][1]["partner"]["role"] == "transits_now"
    row.locator(".chip").nth(1).wait_for()
    # The default for new charts, and replace-or-add.
    p.get_by_label("Default preset for new charts").select_option(saved["id"])
    row.get_by_text("Default for new charts").wait_for()
    p.get_by_label("Preset with several views on a chart with several").select_option("add")
    for _ in range(30):  # remembered choices are saved a moment after they change
        remembered = page.api("GET", "/preferences/remembered")["values"]
        if remembered.get("preset-apply-mode") == "add":
            break
        p.wait_for_timeout(200)
    assert remembered["default-preset"] == saved["id"] and remembered["preset-apply-mode"] == "add"
    # Duplicate, move up, delete.
    row.get_by_role("button", name="Duplicate").click()
    copy = p.locator(".preset-row", has_text="Tab test copy")
    copy.wait_for()
    copy.get_by_role("button", name="Move Tab test copy up").click()
    p.wait_for_function(
        "[...document.querySelectorAll('.preset-row strong')].map(s => s.textContent)"
        ".indexOf('Tab test copy') < [...document.querySelectorAll('.preset-row strong')]"
        ".map(s => s.textContent).indexOf('Tab test')"
    )
    copy.get_by_role("button", name="Delete").click()
    copy.wait_for(state="detached")


def test_self_selected_school(page: Page) -> None:
    """Self-selected comes first and is chosen to begin with; its button goes back to the most
    common techniques, and choosing another school changes no switches."""
    p = page.page
    page.go("/view?tab=features")
    schools = p.get_by_role("group", name="Default school").locator("label")
    schools.first.get_by_text("Self-selected").wait_for()
    expect(schools.first.locator("input")).to_be_checked()
    schools.first.get_by_text("Mix and match techniques from every school").wait_for()
    dials = p.get_by_role("checkbox", name="Cosmobiology dials")
    expect(dials).to_be_checked()
    p.on("dialog", lambda d: d.accept())
    p.get_by_role("button", name="Back to the most common techniques").click()
    expect(dials).not_to_be_checked()
    expect(p.get_by_role("checkbox", name="Transits")).to_be_checked()
    expect(p.get_by_role("checkbox", name="Midpoints")).to_be_checked()
    # Another school is a choice of where charts open; the switches stay as they are.
    schools.filter(has_text="Cosmobiology").locator("input").check()
    p.get_by_role("button", name="Show only what Cosmobiology uses").wait_for()
    expect(dials).not_to_be_checked()
    assert page.api("GET", "/preferences/view")["display"]["school"] == "cosmobiology"


def test_new_chart_dialog_and_defaults(page: Page) -> None:
    """Settings → Defaults sets the house system and place; New chart is a dialog in the middle of
    the screen that starts at the default place, with a house system of its own if chosen."""
    p = page.page
    page.go("/settings")
    p.get_by_label("Default house system").select_option("koch")
    p.get_by_label("Default location").fill("London, UK")
    p.get_by_role("button", name="Save defaults").click()
    p.get_by_text("Saved.", exact=True).wait_for()
    assert page.api("GET", "/preferences/defaults") == {"house_system": "koch", "place": "London, UK"}
    p.get_by_text("Koch houses (default)").first.wait_for()  # the profile follows the default

    page.go("/charts/new")
    dialog = p.get_by_role("dialog", name="New chart")
    dialog.wait_for()
    box = dialog.bounding_box()
    size = p.viewport_size
    assert box and size
    assert abs(box["x"] + box["width"] / 2 - size["width"] / 2) < 4
    assert abs(box["y"] + box["height"] / 2 - size["height"] / 2) < 4
    expect(dialog.locator("#field-place")).to_have_value("London, UK")
    houses = dialog.get_by_label("House system")
    assert houses.locator("option:checked").inner_text() == "Default (Koch)"
    houses.select_option("regiomontanus")
    dialog.locator("#field-name").fill("Dialog Test")
    dialog.locator("#field-date").fill("1990-01-02")
    dialog.locator("#field-time").fill("08:15")
    dialog.get_by_role("button", name="Calculate and save").click()
    p.wait_for_url(re.compile(r"/charts/[0-9a-f-]{36}$"))
    made = p.url.rsplit("/", 1)[1]
    chart = page.api("GET", f"/charts/{made}")
    assert chart["house_system"] == "regiomontanus" and chart["place"].startswith("London")
    page.api("DELETE", f"/charts/{made}")

    # Cancel closes the dialog and its tab.
    page.go("/charts/new")
    p.get_by_role("dialog", name="New chart").get_by_role("button", name="Cancel").click()
    p.wait_for_url(re.compile(r"/charts$"))
    assert p.get_by_role("dialog").count() == 0


def test_edit_chart_dialog(page: Page) -> None:
    """Edit opens as a dialog over the chart, in the middle of the screen."""
    p = page.page
    chart = page.chart_id()
    page.go(f"/charts/{chart}")
    p.locator("svg.wheel").first.wait_for()
    page.go(f"/charts/{chart}/edit")
    dialog = p.get_by_role("dialog", name=re.compile(r"^Edit "))
    dialog.wait_for()
    p.locator("svg.wheel").first.wait_for()  # the chart is behind it
    box = dialog.bounding_box()
    size = p.viewport_size
    assert box and size
    assert abs(box["x"] + box["width"] / 2 - size["width"] / 2) < 4
    assert abs(box["y"] + box["height"] / 2 - size["height"] / 2) < 4
    dialog.get_by_label("House system").select_option("koch")
    dialog.get_by_role("button", name="Save").click()
    dialog.wait_for(state="detached")
    p.wait_for_url(re.compile(rf"/charts/{chart}$"))
    assert page.api("GET", f"/charts/{chart}")["house_system"] == "koch"
    # Cancel (or Escape) goes back to the chart without changing anything.
    page.go(f"/charts/{chart}/edit")
    dialog.get_by_label("House system").select_option("")
    p.keyboard.press("Escape")
    p.wait_for_url(re.compile(rf"/charts/{chart}$"))
    assert page.api("GET", f"/charts/{chart}")["house_system"] == "koch"
    page.api("PATCH", f"/charts/{chart}", {"house_system": ""})


def test_tags_as_badges(page: Page) -> None:
    """Tags are badges: added with Enter or a comma, taken off with their button or Backspace."""
    p = page.page
    chart = page.chart_id()
    page.go(f"/charts/{chart}/edit")
    dialog = p.get_by_role("dialog", name=re.compile(r"^Edit "))
    box = dialog.locator("#field-tags")
    box.fill("Family")
    box.press("Enter")
    box.type("clients,")
    box.type("rectify")
    box.press("Enter")
    badges = dialog.locator(".tag-input .badge--tag")

    def shown() -> list[str]:
        return badges.evaluate_all("bs => bs.map(b => b.firstChild.textContent.trim())")

    assert shown() == ["family", "clients", "rectify"]
    dialog.get_by_role("button", name="Remove tag clients").click()
    box.press("Backspace")  # takes off "rectify"
    assert shown() == ["family"]
    dialog.get_by_role("button", name="Save").click()
    dialog.wait_for(state="detached")
    assert page.api("GET", f"/charts/{chart}")["note"]["tags"] == ["family"]
    page.go("/charts")
    p.locator(".table .badge", has_text="family").first.wait_for()
    page.api("PATCH", f"/charts/{chart}", {"tags": []})


def test_choices_survive_an_immediate_reload(page: Page) -> None:
    """A tab closed just before reloading stays closed (the change is kept in the tab until the
    server has it)."""
    p = page.page
    page.api("PATCH", "/preferences/remembered", {"values": {"open-tabs": []}})
    page.go(f"/charts/{page.chart_id()}")
    tabs = p.get_by_role("tablist", name="Open tabs")
    tabs.get_by_role("tab", name="Jane Doe").wait_for()
    p.wait_for_timeout(1500)  # the open tab is saved
    tabs.get_by_role("button", name="Close Jane Doe").click()
    p.wait_for_url(re.compile(r"/charts$"))
    p.reload()
    tabs.get_by_role("tab", name="Chart library").wait_for()
    p.wait_for_timeout(300)
    assert tabs.get_by_role("tab", name="Jane Doe").count() == 0
