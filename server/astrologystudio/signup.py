"""
AstrologyStudio ·
server/astrologystudio/signup.py

Signing up on this site's own pages, and bringing a key from somewhere else.

ephemeralREST keeps the accounts. Left to itself, its emails link to its own portal. With a
**site key** (a domain key for this site's address, set by the owner), AstrologyStudio sends
`links` with /register and /password/forgot, so the emails link back here: /auth/verify finishes
a sign-up (address confirmed and password chosen in one step, through /register/complete) and
/auth/set-password a reset. Without a site key, or with an ephemeralREST that can't do it, the
portal flow carries on as before.

What ephemeralREST can do is read from its /health (`registration`), kept for a few minutes.

A key arriving for someone who already has one (pasted, from logging in with an ephemeralREST
account, or from a finished sign-up) replaces it through `adopt`, which first checks whether
charts in the old key's list would drop out of sight, and asks.

Copyright (c) 2026 Gavin Melhuish
MIT License; see LICENSE in the project root.
SPDX-License-Identifier: MIT
"""

from __future__ import annotations

import json
import sqlite3
import time
from datetime import UTC, datetime, timedelta
from typing import Any
from urllib.parse import urlsplit

from fastapi import Request

from . import secretbox
from .charts import account_list
from .config import Settings
from .db import now
from .ephemeral import Ephemeral, configured_url
from .errors import ProblemError

SITE_KEY_SETTING = "site_key"
FEATURES_TTL = 300.0
KEY_REQUEST_LIFETIME = timedelta(hours=48)
LOCAL_HOSTS = ("localhost", "127.0.0.1")


# ---------------------------------------------------------------------------
# What ephemeralREST can do


def features(request: Request, conn: sqlite3.Connection) -> dict[str, Any]:
    """`registration` flags and ayanamsas from ephemeralREST's /health, kept for five minutes.
    Empty when there's no address or it doesn't answer (an older ephemeralREST has no flags)."""
    settings: Settings = request.app.state.settings
    url = configured_url(conn, settings)
    if not url:
        return {}
    kept: dict[str, tuple[float, dict[str, Any]]] = request.app.state.ephemeral_features
    found = kept.get(url)
    if found and found[0] > time.monotonic():
        return found[1]
    from .deps import transport

    try:
        with Ephemeral(url, None, transport(request)) as client:
            health = client.get("/health")
    except ProblemError:
        return {}
    data = {
        "registration": (health.get("registration") or {}) if isinstance(health, dict) else {},
        "ayanamsas": (health.get("ayanamsas") or []) if isinstance(health, dict) else [],
    }
    kept[url] = (time.monotonic() + FEATURES_TTL, data)
    return data


def forget_features(request: Request) -> None:
    request.app.state.ephemeral_features.clear()


# ---------------------------------------------------------------------------
# The site key


def site_origin(settings: Settings) -> str:
    """This install's address as an origin: https://astro.example.com (no path)."""
    parts = urlsplit(settings.base_url)
    default = 443 if parts.scheme == "https" else 80
    host = (parts.hostname or "").lower()
    return f"{parts.scheme}://{host}" + (f":{parts.port}" if parts.port and parts.port != default else "")


def links(settings: Settings) -> dict[str, str]:
    """The link templates ephemeralREST's emails use with a site key: back to this site's pages."""
    return {
        "verify": f"{settings.base_url}/auth/verify?t={{token}}",
        "set_password": f"{settings.base_url}/auth/set-password?t={{token}}",
    }


def stored_site(conn: sqlite3.Connection) -> dict[str, Any] | None:
    row = conn.execute("SELECT value FROM settings WHERE key = ?", (SITE_KEY_SETTING,)).fetchone()
    if row is None:
        return None
    value = json.loads(row["value"])
    return value if isinstance(value, dict) and value.get("encrypted") else None


def site_key(conn: sqlite3.Connection, settings: Settings) -> str | None:
    found = stored_site(conn)
    return secretbox.decrypt(settings, found["encrypted"]) if found else None


def save_site(conn: sqlite3.Connection, settings: Settings, key: str, domain: str, origin: str) -> None:
    value = {
        "encrypted": secretbox.encrypt(settings, key),
        "prefix": key[:8],
        "domain": domain,
        "origin": origin,
        "saved_at": now(),
    }
    conn.execute(
        "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)"
        " ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
        (SITE_KEY_SETTING, json.dumps(value), now()),
    )


def forget_site(conn: sqlite3.Connection) -> None:
    conn.execute("DELETE FROM settings WHERE key = ?", (SITE_KEY_SETTING,))


def host_matches(origin: str, domain: str) -> bool:
    host = (urlsplit(origin).hostname or "").lower()
    domain = domain.lower().strip(".")
    return host in LOCAL_HOSTS or host == domain or host.endswith("." + domain)


def links_ready(request: Request, conn: sqlite3.Connection) -> bool:
    """Whether sign-up emails can link back here: a site key saved for this address, and an
    ephemeralREST that takes app links."""
    settings: Settings = request.app.state.settings
    found = stored_site(conn)
    if not found or found.get("origin") != site_origin(settings):
        return False
    return bool(features(request, conn).get("registration", {}).get("app_links"))


def links_state(request: Request, conn: sqlite3.Connection) -> tuple[bool, str]:
    """(links come here?, why not) for the owner's Settings card."""
    settings: Settings = request.app.state.settings
    found = stored_site(conn)
    if not configured_url(conn, settings):
        return False, "Set the ephemeralREST address first."
    if not found:
        return False, "No site key is saved."
    if found.get("origin") != site_origin(settings):
        return (
            False,
            f"The site key was saved for {found.get('origin')}; this site is now at {site_origin(settings)}.",
        )
    if not features(request, conn).get("registration", {}).get("app_links"):
        return False, "This ephemeralREST can't send links to other sites yet."
    return True, ""


def client(request: Request, conn: sqlite3.Connection, with_site_key: bool = True) -> Ephemeral:
    """ephemeralREST for signing up and logging in: with the site key when there is one (which is
    how ephemeralREST knows which site an account belongs to), else with no key."""
    from .deps import transport

    settings: Settings = request.app.state.settings
    key = site_key(conn, settings) if with_site_key else None
    return Ephemeral(configured_url(conn, settings), key, transport(request))


def post_with_links(
    request: Request, conn: sqlite3.Connection, path: str, body: dict[str, Any], kinds: tuple[str, ...]
) -> tuple[Any, bool]:
    """POST /register or /password/forgot with this site's links when they can be used. If
    ephemeralREST turns the links down (the origin isn't registered after all), it's sent again
    without them, so the portal flow still works. Returns (answer, links used?)."""
    settings: Settings = request.app.state.settings
    if links_ready(request, conn):
        everything = links(settings)
        try:
            with client(request, conn) as eph:
                return eph.post(path, {**body, "links": {k: everything[k] for k in kinds}}), True
        except ProblemError as problem:
            if problem.detail not in ("link-not-allowed", "link-needs-domain-key") and problem.status != 424:
                raise
    with client(request, conn, with_site_key=False) as eph:
        return eph.post(path, body), False


# ---------------------------------------------------------------------------
# Someone logged in asking for an account ("I don't have a key")


def _iso(moment: datetime) -> str:
    return moment.isoformat(timespec="milliseconds").replace("+00:00", "Z")


def save_key_request(conn: sqlite3.Connection, user_id: str, email: str) -> None:
    moment = datetime.now(UTC)
    conn.execute("DELETE FROM key_requests WHERE expires_at < ?", (_iso(moment),))
    conn.execute(
        "INSERT INTO key_requests (user_id, email, created_at, expires_at) VALUES (?, ?, ?, ?)"
        " ON CONFLICT (user_id) DO UPDATE SET email = excluded.email, created_at = excluded.created_at,"
        " expires_at = excluded.expires_at",
        (user_id, email, _iso(moment), _iso(moment + KEY_REQUEST_LIFETIME)),
    )


def key_request_for(conn: sqlite3.Connection, email: str) -> str | None:
    """Whose open key request this ephemeralREST account finishes, if anyone's."""
    row = conn.execute(
        "SELECT user_id FROM key_requests WHERE email = ? AND expires_at > ? ORDER BY created_at DESC",
        (email, _iso(datetime.now(UTC))),
    ).fetchone()
    return row["user_id"] if row else None


# ---------------------------------------------------------------------------
# Taking on a key


def adopt(
    request: Request,
    conn: sqlite3.Connection,
    user_id: str,
    key: str,
    identity: dict[str, Any] | None,
    choice: str | None,
) -> dict[str, Any]:
    """Save `key` as this person's ephemeralREST key. If it replaces another, and charts in the
    old key's list aren't in the new one's, they'd drop out of sight here: without a `choice`, the
    new key waits (pending_keys) and the answer is `{"status": "choose", "missing": n}`. With
    "add", those charts are added to the new key's list first (ephemeralREST shares charts, so
    nothing is copied or duplicated, and notes here stay attached); with "leave", it just switches.
    Call outside a transaction: it talks to ephemeralREST."""
    from .api.account import store_key
    from .db import transaction
    from .deps import stored_key, transport

    settings: Settings = request.app.state.settings
    url = configured_url(conn, settings)
    current = stored_key(conn, settings, user_id)
    missing: list[dict[str, Any]] = []
    if current and current != key:
        try:
            with Ephemeral(url, current, transport(request)) as old:
                old_list = account_list(old, None)
            with Ephemeral(url, key, transport(request)) as new:
                new_ids = {str(c.get("uuid")) for c in account_list(new, None)}
            missing = [c for c in old_list if str(c.get("uuid")) not in new_ids]
        except ProblemError:
            missing = []  # the old key no longer works: nothing to keep in sight
    if missing and choice is None:
        with transaction(conn):
            conn.execute(
                "INSERT INTO pending_keys (user_id, encrypted, identity, created_at) VALUES (?, ?, ?, ?)"
                " ON CONFLICT (user_id) DO UPDATE SET encrypted = excluded.encrypted,"
                " identity = excluded.identity, created_at = excluded.created_at",
                (user_id, secretbox.encrypt(settings, key), json.dumps(identity), now()),
            )
        return {"status": "choose", "missing": len(missing)}
    if missing and choice == "add":
        with Ephemeral(url, key, transport(request), request.app.state.ephemeral_cache) as new:
            # Main charts first, then the derived ones that hang off them.
            for entry in sorted(missing, key=lambda c: c.get("type") == "derived"):
                new.put(
                    f"/account/charts/{entry.get('uuid')}",
                    {k: entry.get(k) for k in ("type", "parent_uuid", "name", "date", "time", "location")},
                )
    with transaction(conn):
        store_key(conn, settings, user_id, key, identity)
        conn.execute("DELETE FROM pending_keys WHERE user_id = ?", (user_id,))
    if current != key:
        from . import audit

        added = f", {len(missing)} charts added" if missing and choice == "add" else ""
        audit.record(
            conn,
            request,
            "key_switched" if current else "key_saved",
            "done",
            user_id=user_id,
            detail=key[:8] + added,
        )
    return {"status": "saved", "added": len(missing) if choice == "add" else 0}


def pending_key(conn: sqlite3.Connection, settings: Settings, user_id: str) -> tuple[str, Any] | None:
    row = conn.execute(
        "SELECT encrypted, identity FROM pending_keys WHERE user_id = ?", (user_id,)
    ).fetchone()
    if row is None:
        return None
    key = secretbox.decrypt(settings, row["encrypted"])
    return (key, json.loads(row["identity"]) if row["identity"] else None) if key else None


def other_service(conn: sqlite3.Connection, settings: Settings, owner: bool) -> str:
    """Why a key or account from elsewhere might not work here (the address only for the owner)."""
    if owner:
        return (
            f"This site's charts are kept at {configured_url(conn, settings)}. Keys and accounts only work"
            " between sites that use the same one."
        )
    return "Keys and accounts only work between sites that use the same chart service as this one."
