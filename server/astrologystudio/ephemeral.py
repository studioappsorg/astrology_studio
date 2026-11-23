"""
AstrologyStudio ·
server/astrologystudio/ephemeral.py

Talking to ephemeralREST, which does every calculation and stores every chart.

Each person uses their own ephemeralREST API key (sent as `X-API-Key`). The browser
never sees it: the web app asks AstrologyStudio, and AstrologyStudio asks ephemeralREST.
ephemeralREST's errors (`{"error": ..., "status": ...}`) become problem details here,
worded for the person reading them.

Copyright (c) 2026 Gavin Melhuish
MIT License; see LICENSE in the project root.
SPDX-License-Identifier: MIT
"""

from __future__ import annotations

import copy
import hashlib
import json
import re
import sqlite3
import threading
import time
from typing import Any

import httpx

from .config import Settings
from .errors import ProblemError

TIMEOUT = httpx.Timeout(30.0, connect=5.0)
SETTING_KEY = "ephemeral_url"


def configured_url(conn: sqlite3.Connection, settings: Settings) -> str:
    """The ephemeralREST address: set in Settings, else from the environment, else empty."""
    row = conn.execute("SELECT value FROM settings WHERE key = ?", (SETTING_KEY,)).fetchone()
    if row is not None:
        value = json.loads(row["value"])
        if isinstance(value, str) and value:
            return value
    return settings.ephemeral_url


# What's kept, and for how long (seconds). A saved chart only changes when it's edited here (which
# clears the cache), so it's kept for longer; the chart list can also change in other apps that use
# ephemeralREST (MindForce, say), so it's kept briefly.
CACHED: tuple[tuple[re.Pattern[str], float], ...] = (
    (re.compile(r"^/chart/[^/]+$"), 600.0),
    (re.compile(r"^/derived/[^/]+$"), 600.0),
    (re.compile(r"^/account/charts$"), 60.0),
)
MAX_CACHED = 5000
# POSTs that only calculate: they change nothing that's cached, so they don't clear it. (Every
# other POST, PUT, PATCH or DELETE might change a chart or the chart list.)
CALCULATIONS = frozenset({"/calculate", "/ephemeris", "/lunations", "/eclipses"})


class Cache:
    """Answers to ephemeralREST's chart reads, per key, for a short time. Every chart screen asks
    for its charts and the chart list again and again (switching chart type, changing profile,
    adding a ring); each ask is a paid, authenticated round trip on a hosted service. Any change
    made with a key (a new chart, an edit, a derived chart) forgets everything cached for it."""

    def __init__(self, clock: Any = time.monotonic) -> None:
        self._items: dict[tuple[str, str], tuple[float, Any]] = {}
        self._lock = threading.Lock()
        self._clock = clock
        self.hits = 0
        self.misses = 0

    @staticmethod
    def lifetime(path: str) -> float | None:
        return next((ttl for pattern, ttl in CACHED if pattern.match(path)), None)

    def get(self, owner: str, path: str) -> Any:
        with self._lock:
            item = self._items.get((owner, path))
            if item is None or item[0] < self._clock():
                self.misses += 1
                return None
            self.hits += 1
            return copy.deepcopy(item[1])

    def put(self, owner: str, path: str, data: Any, ttl: float) -> None:
        with self._lock:
            if len(self._items) >= MAX_CACHED:
                now = self._clock()
                self._items = {k: v for k, v in self._items.items() if v[0] >= now}
                while len(self._items) >= MAX_CACHED:  # still full: drop the oldest
                    self._items.pop(next(iter(self._items)))
            self._items[(owner, path)] = (self._clock() + ttl, copy.deepcopy(data))

    def forget(self, owner: str) -> None:
        with self._lock:
            self._items = {k: v for k, v in self._items.items() if k[0] != owner}


class Ephemeral:
    """A client for one person's key. `transport` lets tests stand in for the real server.
    With a `cache`, chart reads are answered from it when they can be (see Cache)."""

    def __init__(
        self,
        base_url: str,
        api_key: str | None,
        transport: httpx.BaseTransport | None = None,
        cache: Cache | None = None,
    ) -> None:
        if not base_url:
            raise ProblemError(
                409,
                "no-ephemeral-url",
                "ephemeralREST isn't set up yet",
                "The owner of this install needs to enter the ephemeralREST address in Settings.",
            )
        headers = {"Accept": "application/json"}
        if api_key:
            headers["X-API-Key"] = api_key
        self._client = httpx.Client(base_url=base_url, headers=headers, timeout=TIMEOUT, transport=transport)
        self._cache = cache if api_key else None
        # Whose answers these are: the key itself is never kept.
        self._owner = hashlib.sha256(f"{base_url}\n{api_key}".encode()).hexdigest()[:32]

    def close(self) -> None:
        self._client.close()

    def __enter__(self) -> Ephemeral:
        return self

    def __exit__(self, *_: object) -> None:
        self.close()

    def request(self, method: str, path: str, body: Any = None, params: dict[str, Any] | None = None) -> Any:
        ttl = Cache.lifetime(path) if self._cache and method == "GET" and not params else None
        if ttl is not None and self._cache is not None:
            cached = self._cache.get(self._owner, path)
            if cached is not None:
                return cached
        elif self._cache is not None and method != "GET" and path not in CALCULATIONS:
            self._cache.forget(self._owner)
        data = self._send(method, path, body, params)
        if ttl is not None and self._cache is not None:
            self._cache.put(self._owner, path, data, ttl)
        return data

    def memo(self, name: str, ttl: float, work: Any) -> Any:
        """`work()`, kept like a chart read under `name` (for results worked out from several
        calls, such as a Davison chart). Without a cache, just `work()`."""
        if self._cache is None:
            return work()
        kept = self._cache.get(self._owner, f"memo:{name}")
        if kept is not None:
            return kept
        result = work()
        self._cache.put(self._owner, f"memo:{name}", result, ttl)
        return result

    def _send(self, method: str, path: str, body: Any, params: dict[str, Any] | None) -> Any:
        try:
            response = self._client.request(method, path, json=body, params=params)
        except httpx.TimeoutException:
            raise ProblemError(
                504, "ephemeral-timeout", "ephemeralREST took too long to answer", "Try again in a moment."
            ) from None
        except httpx.HTTPError:
            raise ProblemError(
                502,
                "ephemeral-unreachable",
                "Couldn't reach ephemeralREST",
                "Check the ephemeralREST address in Settings, and that the server is running.",
            ) from None
        try:
            data = response.json()
        except ValueError:
            data = None
        if response.is_success:
            return data
        raise _problem(response.status_code, data)

    def get(self, path: str, params: dict[str, Any] | None = None) -> Any:
        return self.request("GET", path, params=params)

    def post(self, path: str, body: Any = None) -> Any:
        return self.request("POST", path, body)

    def put(self, path: str, body: Any = None) -> Any:
        return self.request("PUT", path, body)

    def delete(self, path: str) -> Any:
        return self.request("DELETE", path)


def _problem(status: int, data: Any) -> ProblemError:
    message = data.get("error") if isinstance(data, dict) else None
    detail = str(message) if message else None
    if status == 401:
        # 424, not 401: a 401 would mean "your AstrologyStudio session ended" to the web app.
        return ProblemError(
            424,
            "ephemeral-key-rejected",
            "ephemeralREST didn't accept your API key",
            "Check the key in Account. If it was rotated, enter the new one.",
        )
    if status == 403:
        return ProblemError(403, "ephemeral-forbidden", "ephemeralREST refused this request", detail)
    if status == 404:
        return ProblemError(404, "not-found", "Not found in ephemeralREST", detail)
    if status == 429:
        return ProblemError(
            429,
            "ephemeral-rate-limited",
            "Too many requests to ephemeralREST",
            "Wait a minute and try again.",
        )
    if status in (400, 409, 412, 413, 422):
        return ProblemError(422, "ephemeral-rejected", "ephemeralREST couldn't do that", detail)
    if status == 503:
        return ProblemError(503, "ephemeral-unavailable", "ephemeralREST is busy", "Try again shortly.")
    return ProblemError(502, "ephemeral-error", "ephemeralREST had a problem", detail)
