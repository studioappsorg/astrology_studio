"""
AstrologyStudio ·
server/tests/test_cache.py

ephemeralREST chart reads are cached per key, and any change made with that key clears them.

Copyright (c) 2026 Gavin Melhuish
MIT License; see LICENSE in the project root.
SPDX-License-Identifier: MIT
"""

from __future__ import annotations

from fastapi.testclient import TestClient

from astrologystudio.ephemeral import Cache

from .fake_ephemeral import FakeEphemeral

NEW = {"name": "Jane", "date": "1985-06-12", "time": "14:30", "place": "Perth"}


def reads(fake: FakeEphemeral) -> int:
    return sum(
        1
        for method, path in fake.calls
        if method == "GET" and (path.startswith("/chart/") or path == "/account/charts")
    )


def test_chart_views_are_cached(client: TestClient, ready: dict[str, str], fake: FakeEphemeral) -> None:
    chart = client.post("/api/v1/charts", json=NEW, headers=ready).json()
    url = f"/api/v1/charts/{chart['id']}"
    client.get(url)
    first = reads(fake)
    for _ in range(3):
        client.get(url)
        client.get(url, params={"mode": "hellenistic"})
        client.get(f"/api/v1/charts/derived/harmonic-5-{chart['id']}")
    assert reads(fake) == first  # nothing more asked of ephemeralREST


def test_changes_clear_the_cache(client: TestClient, ready: dict[str, str], fake: FakeEphemeral) -> None:
    chart = client.post("/api/v1/charts", json=NEW, headers=ready).json()
    url = f"/api/v1/charts/{chart['id']}"
    assert client.get(url).json()["name"] == "Jane"
    changed = client.patch(url, json={"name": "Jane Doe"}, headers=ready)
    assert changed.status_code == 200, changed.text
    assert client.get(url).json()["name"] == "Jane Doe"
    listed = client.get("/api/v1/charts").json()["data"]
    assert any(c["name"] == "Jane Doe" for c in listed)


def test_cache_expires_and_copies() -> None:
    now = [0.0]
    cache = Cache(clock=lambda: now[0])
    cache.put("k", "/chart/a", {"points": {"sun": 1}}, 10)
    got = cache.get("k", "/chart/a")
    got["points"]["sun"] = 99  # callers may change what they get; the cache keeps its own copy
    assert cache.get("k", "/chart/a") == {"points": {"sun": 1}}
    assert cache.get("other", "/chart/a") is None
    now[0] = 11
    assert cache.get("k", "/chart/a") is None
    cache.put("k", "/chart/a", 1, 10)
    cache.forget("k")
    assert cache.get("k", "/chart/a") is None
    assert Cache.lifetime("/chart/abc") == 600 and Cache.lifetime("/chart/abc/progressions") is None


def test_calculating_doesnt_clear_the_cache(
    client: TestClient, ready: dict[str, str], fake: FakeEphemeral
) -> None:
    """A calculation (a Davison chart, a chart in another house system) changes nothing cached."""
    chart = client.post("/api/v1/charts", json=NEW, headers=ready).json()
    url = f"/api/v1/charts/{chart['id']}"
    client.get(url)
    before = reads(fake)
    client.patch("/api/v1/preferences/calculation", json={"house_system": "whole_sign"}, headers=ready)
    client.get(url)  # recalculated in Whole Sign: a /calculate call, which mustn't clear the cache
    client.get(url)
    assert reads(fake) == before
