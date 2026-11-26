"""
AstrologyStudio ·
server/astrologystudio/api/account.py

/api/v1/account:

your own ephemeralREST API key, a copy of your data, and deleting your account.

Copyright (c) 2026 Gavin Melhuish
MIT License; see LICENSE in the project root.
SPDX-License-Identifier: MIT
"""

from __future__ import annotations

import json
import sqlite3
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Cookie, Request, Response
from pydantic import BaseModel, ConfigDict, EmailStr, Field

from .. import __version__, accounts, audit, charts, limits, secretbox, signup
from ..config import Settings
from ..db import now, transaction
from ..deps import Db, UserPrincipal, stored_key, transport
from ..ephemeral import Ephemeral, configured_url
from ..errors import ProblemError
from ..schemas import Strict, normalise_email

router = APIRouter(prefix="/account", tags=["Account"])


Choice = Literal["add", "leave"]


class KeyUpdate(Strict):
    api_key: Annotated[str, Field(min_length=8, max_length=200)]
    charts: Choice | None = None
    """If it replaces a key whose list has charts this one's doesn't: "add" them to it, or
    "leave" them. Left out, the answer says how many (`status` "choose") and the key waits."""


def _public(row: Any) -> dict[str, Any]:
    if row is None:
        return {"configured": False}
    identity = json.loads(row["identity"]) if row["identity"] else None
    return {
        "configured": True,
        "prefix": row["prefix"],
        "identity": identity,
        "checked_at": row["checked_at"],
        "updated_at": row["updated_at"],
    }


@router.get("/ephemeral-key", summary="Your ephemeralREST key (never the key itself)")
def get_key(conn: Db, person: UserPrincipal) -> dict[str, Any]:
    row = conn.execute("SELECT * FROM ephemeral_keys WHERE user_id = ?", (person.id,)).fetchone()
    return _public(row)


@router.put("/ephemeral-key", summary="Save your ephemeralREST key")
def set_key(body: KeyUpdate, request: Request, conn: Db, person: UserPrincipal) -> dict[str, Any]:
    """Checked with ephemeralREST's /me before it's saved, so a typo is caught straight away. If
    it would hide charts you have here, the answer is `{"status": "choose", "missing": n}`: send it
    again with `charts`, or answer at /account/ephemeral-key/pending."""
    settings: Settings = request.app.state.settings
    key = body.api_key.strip()
    try:
        with Ephemeral(configured_url(conn, settings), key, transport(request)) as client:
            me = client.get("/me")
    except ProblemError as problem:
        if problem.slug == "ephemeral-key-rejected":
            raise ProblemError(
                424, problem.slug, problem.title, signup.other_service(conn, settings, person.is_owner)
            ) from None
        raise
    identity = {k: me.get(k) for k in ("name", "identifier", "rate_limits")} if isinstance(me, dict) else None
    return _adopted(request, conn, person.id, key, identity, body.charts)


def _adopted(
    request: Request, conn: Db, user_id: str, key: str, identity: dict[str, Any] | None, choice: str | None
) -> dict[str, Any]:
    outcome = signup.adopt(request, conn, user_id, key, identity, choice)
    row = conn.execute("SELECT * FROM ephemeral_keys WHERE user_id = ?", (user_id,)).fetchone()
    return {**_public(row), **outcome}


class PendingChoice(Strict):
    choice: Literal["add", "leave", "cancel"]


@router.post("/ephemeral-key/pending", summary="Say what happens to your charts, and switch keys")
def answer_pending(body: PendingChoice, request: Request, conn: Db, person: UserPrincipal) -> dict[str, Any]:
    """For a key waiting because it would hide charts (`status` "choose"): "add" them to its
    list, "leave" them in the old key's list, or "cancel" and keep the current key."""
    settings: Settings = request.app.state.settings
    found = signup.pending_key(conn, settings, person.id)
    if found is None:
        raise ProblemError(404, "nothing-pending", "There's no key waiting", "Enter or fetch it again.")
    if body.choice == "cancel":
        with transaction(conn):
            conn.execute("DELETE FROM pending_keys WHERE user_id = ?", (person.id,))
        row = conn.execute("SELECT * FROM ephemeral_keys WHERE user_id = ?", (person.id,)).fetchone()
        return {**_public(row), "status": "cancelled"}
    key, identity = found
    return _adopted(request, conn, person.id, key, identity, body.choice)


# ---------------------------------------------------------------------------
# "I don't have a key", and keys from another site


class KeyRequest(Strict):
    name: Annotated[str, Field(min_length=1, max_length=100)]
    email: EmailStr


@router.post(
    "/ephemeral-key/request", status_code=202, summary="Create an ephemeralREST account for your key"
)
def request_key(body: KeyRequest, request: Request, conn: Db, person: UserPrincipal) -> dict[str, Any]:
    """ephemeralREST emails a link to confirm the address. With a site key (`flow` "here"), the
    link comes back to this site, and finishing it saves the new key to you, in whichever browser
    it's opened. Otherwise (`flow` "portal"), ephemeralREST's own pages finish it and email the
    key, to paste here. If the address already has an ephemeralREST account, nothing is sent: log
    in with it instead (/account/ephemeral-key/login)."""
    settings: Settings = request.app.state.settings
    if not configured_url(conn, settings):
        raise ProblemError(
            409, "no-ephemeral-url", "ephemeralREST isn't set up yet", "Save its address first."
        )
    from .auth import _count_registration, signup_deliver

    _count_registration(request, f"key-request:{person.id}")
    email = normalise_email(str(body.email))
    data, here = signup.post_with_links(
        request, conn, "/register", {"name": body.name.strip(), "email": email}, ("verify", "set_password")
    )
    if here:
        with transaction(conn):
            signup.save_key_request(conn, person.id, email)
    signup_deliver(request, conn, data, email, body.name.strip())
    return {"email": email, "flow": "here" if here else "portal"}


class KeyLogin(Strict):
    email: EmailStr
    password: Annotated[str, Field(min_length=1, max_length=200)]


class KeyLoginCode(Strict):
    email: EmailStr
    code: Annotated[str, Field(min_length=4, max_length=12)]
    charts: Choice | None = None


def _login_problem(conn: Db, settings: Settings, owner: bool) -> ProblemError:
    # 422, not 401: to the web app a 401 means the session has ended.
    return ProblemError(
        422,
        "bad-login",
        "Wrong email or password",
        f"Use the ephemeralREST account you signed up with on the other site. "
        f"{signup.other_service(conn, settings, owner)}",
    )


@router.post("/ephemeral-key/login", summary="Get your key by logging in to your ephemeralREST account")
def key_login(body: KeyLogin, request: Request, conn: Db, person: UserPrincipal) -> dict[str, Any]:
    """For an account made on another site, or here before: its email and password, then (at
    /account/ephemeral-key/login/code) the emailed code. A remembered browser is never used here."""
    settings: Settings = request.app.state.settings
    throttle: accounts.LoginThrottle = request.app.state.login_throttle
    email = normalise_email(str(body.email))
    keys = (f"key-login:{person.id}", f"email:{email}")
    if throttle.blocked(*keys):
        raise ProblemError(429, "too-many-attempts", "Too many attempts", "Wait 15 minutes and try again.")
    try:
        with signup.client(request, conn) as eph:
            data = eph.post("/login", {"email": email, "password": body.password})
    except ProblemError as problem:
        if problem.slug != "ephemeral-key-rejected":
            raise
        throttle.failed(*keys)
        raise _login_problem(conn, settings, person.is_owner) from None
    if data.get("must_change_password"):
        raise ProblemError(409, "password-not-set", "Set your password first", "Use the link in your email.")
    throttle.succeeded(keys[1])
    if data.get("2fa_required"):
        from .auth import signup_deliver

        signup_deliver(request, conn, data, email, str(data.get("name") or person.name))
        return {"two_factor": True, "email": email}
    return _from_login(request, conn, person.id, data, None)


@router.post("/ephemeral-key/login/code", summary="Finish getting your key with the emailed code")
def key_login_code(body: KeyLoginCode, request: Request, conn: Db, person: UserPrincipal) -> dict[str, Any]:
    throttle: accounts.LoginThrottle = request.app.state.login_throttle
    email = normalise_email(str(body.email))
    keys = (f"key-login:{person.id}", f"email:{email}")
    if throttle.blocked(*keys):
        raise ProblemError(429, "too-many-attempts", "Too many attempts", "Wait 15 minutes and try again.")
    try:
        with signup.client(request, conn, with_site_key=False) as eph:
            data = eph.post(
                "/login/2fa", {"email": email, "code": body.code.strip(), "remember_device": False}
            )
    except ProblemError as problem:
        if problem.slug != "ephemeral-key-rejected":
            raise
        throttle.failed(*keys)
        raise ProblemError(
            422, "bad-code", "That code didn't work", "Codes expire after a few minutes."
        ) from None
    throttle.succeeded(keys[1])
    return _from_login(request, conn, person.id, data, body.charts)


def _from_login(
    request: Request, conn: Db, user_id: str, data: dict[str, Any], choice: str | None
) -> dict[str, Any]:
    key = data.get("api_key")
    if not isinstance(key, str) or not key:
        raise ProblemError(502, "ephemeral-error", "ephemeralREST didn't return your key", None)
    identity = {k: data.get(k) for k in ("name", "identifier", "rate_limits")}
    return _adopted(request, conn, user_id, key, identity, choice)


# ---------------------------------------------------------------------------
# Folders, tags, ratings, sources and notes from another site (its export file)


class Organisation(BaseModel):
    """An account export file. Only these parts are read; everything else in it is ignored."""

    model_config = ConfigDict(extra="ignore")
    astrologystudio_export: int
    chart_notes: list[dict[str, Any]] = Field(default_factory=list)
    folders: list[dict[str, Any]] = Field(default_factory=list)
    kept_derived: list[dict[str, Any]] = Field(default_factory=list)


@router.post("/organisation", summary="Bring in folders, tags and notes from an export file")
def import_organisation(
    body: Organisation, request: Request, conn: Db, person: UserPrincipal
) -> dict[str, Any]:
    """From another site's (or this one's) account export: notes, tags, Rodden ratings, sources,
    folders and kept composite and Davison charts, for the charts in your list here. Charts that
    aren't in your list are skipped; running it again changes nothing more."""
    client = _your_ephemeral(request, conn, person.id)
    if client is None:
        raise ProblemError(409, "no-api-key", "Add your ephemeralREST key first", None)
    with client:
        listed = {str(c.get("uuid")) for c in charts.account_list(client, None)}
    folders_by_old = {str(f.get("id")): str(f.get("name") or "").strip() for f in body.folders}
    moment = now()
    imported = skipped = kept = 0
    with transaction(conn):
        existing = {
            r["name"]: r["id"]
            for r in conn.execute("SELECT id, name FROM folders WHERE user_id = ?", (person.id,))
        }

        def folder_for(old_id: Any) -> str | None:
            name = folders_by_old.get(str(old_id)) if old_id else None
            if not name:
                return None
            if name not in existing:
                from ..ids import new_id

                existing[name] = new_id("folder")
                conn.execute(
                    "INSERT INTO folders (id, user_id, name, created_at) VALUES (?, ?, ?, ?)",
                    (existing[name], person.id, name[:100], moment),
                )
            found: str = existing[name]
            return found

        for note in body.chart_notes:
            chart_id = str(note.get("chart_id") or "")
            if chart_id not in listed:
                skipped += 1
                continue
            values = {k: note.get(k) for k in charts.NOTE_FIELDS if k in note}
            values["folder_id"] = folder_for(note.get("folder_id"))
            if isinstance(values.get("tags"), str):
                values["tags"] = json.loads(values["tags"] or "[]")
            charts.save_note(conn, person.id, chart_id, values)
            imported += 1
        for item in body.kept_derived:
            if str(item.get("parent_id")) in listed and str(item.get("other_id")) in listed:
                kept += conn.execute(
                    "INSERT OR IGNORE INTO kept_derived"
                    " (user_id, id, parent_id, other_id, kind, name, created_at)"
                    " VALUES (?, ?, ?, ?, ?, ?, ?)",
                    (
                        person.id,
                        item.get("id"),
                        item.get("parent_id"),
                        item.get("other_id"),
                        item.get("kind"),
                        str(item.get("name") or "")[:200],
                        item.get("created_at") or moment,
                    ),
                ).rowcount
    return {"imported": imported, "skipped": skipped, "kept_derived": kept}


def store_key(
    conn: sqlite3.Connection, settings: Settings, user_id: str, key: str, identity: dict[str, Any] | None
) -> None:
    """Save (or replace) someone's ephemeralREST key, encrypted. Call inside a transaction."""
    moment = now()
    conn.execute(
        "INSERT INTO ephemeral_keys (user_id, encrypted, prefix, identity, checked_at, updated_at)"
        " VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (user_id) DO UPDATE SET encrypted = excluded.encrypted,"
        " prefix = excluded.prefix, identity = excluded.identity, checked_at = excluded.checked_at,"
        " updated_at = excluded.updated_at",
        (user_id, secretbox.encrypt(settings, key), key[:8], json.dumps(identity), moment, moment),
    )


@router.delete("/ephemeral-key", status_code=204, summary="Forget your ephemeralREST key")
def delete_key(request: Request, conn: Db, person: UserPrincipal) -> Response:
    with transaction(conn):
        row = conn.execute("SELECT prefix FROM ephemeral_keys WHERE user_id = ?", (person.id,)).fetchone()
        conn.execute("DELETE FROM ephemeral_keys WHERE user_id = ?", (person.id,))
    if row is not None:
        audit.record(conn, request, "key_forgotten", "done", user_id=person.id, detail=row["prefix"])
    return Response(status_code=204)


# ---------------------------------------------------------------------------
# Show my key, Replace my key: confirm who it is first

SessionCookie = Annotated[str | None, Cookie(alias=accounts.SESSION_COOKIE)]
LOCKED = "Wait 15 minutes and try again."


class Reauth(Strict):
    password: Annotated[str, Field(min_length=1, max_length=200)]


class ReauthCode(Strict):
    code: Annotated[str, Field(min_length=4, max_length=12)]


def _reauth_state(conn: Db, as_session: str | None) -> dict[str, Any]:
    until = accounts.reauth_until(conn, as_session)
    return {
        "confirmed": until is not None,
        "until": until.isoformat().replace("+00:00", "Z") if until else None,
    }


def _reauth_failed(request: Request, conn: Db, person: Any, why: str) -> ProblemError:
    throttle: accounts.LoginThrottle = request.app.state.reauth_throttle
    throttle.failed(f"reauth:{person.id}")
    audit.record(conn, request, "reauth", why, user_id=person.id)
    # 422, not 401: to the web app a 401 means the session has ended.
    if why == "bad-code":
        return ProblemError(422, "bad-code", "That code didn't work", "Codes expire after a few minutes.")
    return ProblemError(422, "bad-password", "That password isn't right", None)


def _check_lock(request: Request, person: Any) -> None:
    throttle: accounts.LoginThrottle = request.app.state.reauth_throttle
    if throttle.blocked(f"reauth:{person.id}"):
        raise ProblemError(429, "too-many-attempts", "Too many attempts", LOCKED)


@router.get("/reauth", summary="Whether you've confirmed it's you in the last 5 minutes")
def reauth_status(conn: Db, _: UserPrincipal, as_session: SessionCookie = None) -> dict[str, Any]:
    return _reauth_state(conn, as_session)


@router.post("/reauth", summary="Confirm it's you, before showing or replacing your key")
def reauth(
    body: Reauth, request: Request, conn: Db, person: UserPrincipal, as_session: SessionCookie = None
) -> dict[str, Any]:
    """With your password here; or, if you sign in through ephemeralREST, its password, and then
    the emailed code at /account/reauth/code (always asked for, even on a trusted browser). Good
    for 5 minutes, for this session. Five failures lock it for 15 minutes."""
    _check_lock(request, person)
    row = conn.execute(
        "SELECT email, name, password_hash, signs_in_with FROM users WHERE id = ?", (person.id,)
    ).fetchone()
    if row["signs_in_with"] == "ephemeral":
        try:
            # No device token: the code is always asked for.
            with signup.client(request, conn) as eph:
                data = eph.post("/login", {"email": row["email"], "password": body.password})
        except ProblemError as problem:
            if problem.slug != "ephemeral-key-rejected":
                raise
            raise _reauth_failed(request, conn, person, "bad-password") from None
        if data.get("2fa_required"):
            from .auth import signup_deliver

            signup_deliver(request, conn, data, row["email"], row["name"])
            return {"two_factor": True, **_reauth_state(conn, as_session)}
    elif not accounts.check_password(body.password, row["password_hash"]):
        raise _reauth_failed(request, conn, person, "bad-password")
    return _reauth_done(request, conn, person, as_session)


@router.post("/reauth/code", summary="Finish confirming it's you with the emailed code")
def reauth_code(
    body: ReauthCode, request: Request, conn: Db, person: UserPrincipal, as_session: SessionCookie = None
) -> dict[str, Any]:
    _check_lock(request, person)
    row = conn.execute("SELECT email FROM users WHERE id = ?", (person.id,)).fetchone()
    try:
        with signup.client(request, conn, with_site_key=False) as eph:
            eph.post(
                "/login/2fa", {"email": row["email"], "code": body.code.strip(), "remember_device": False}
            )
    except ProblemError as problem:
        if problem.slug != "ephemeral-key-rejected":
            raise
        raise _reauth_failed(request, conn, person, "bad-code") from None
    return _reauth_done(request, conn, person, as_session)


def _reauth_done(request: Request, conn: Db, person: Any, as_session: str | None) -> dict[str, Any]:
    if not as_session:
        raise ProblemError(401, "unauthorized", "Please log in", None)
    throttle: accounts.LoginThrottle = request.app.state.reauth_throttle
    throttle.succeeded(f"reauth:{person.id}")
    with transaction(conn):
        accounts.mark_reauth(conn, as_session)
    audit.record(conn, request, "reauth", "success", user_id=person.id)
    return _reauth_state(conn, as_session)


def _require_reauth(conn: Db, as_session: str | None) -> None:
    if accounts.reauth_until(conn, as_session) is None:
        raise ProblemError(
            403,
            "reauth-needed",
            "Confirm it's you first",
            "Enter your password again; it's good for 5 minutes.",
        )


NO_STORE = {"Cache-Control": "no-store", "Pragma": "no-cache"}


@router.post("/ephemeral-key/reveal", summary="Show your key (after confirming it's you)")
def reveal_key(
    request: Request, response: Response, conn: Db, person: UserPrincipal, as_session: SessionCookie = None
) -> dict[str, Any]:
    """Decrypted from the copy kept here; ephemeralREST isn't asked. There's no way for the owner
    (or anyone else) to see another person's key."""
    _require_reauth(conn, as_session)
    key = stored_key(conn, request.app.state.settings, person.id)
    if not key:
        raise ProblemError(404, "no-api-key", "No key saved", None)
    response.headers.update(NO_STORE)
    audit.record(conn, request, "key_shown", "done", user_id=person.id, detail=key[:8])
    return {"api_key": key}


@router.post("/ephemeral-key/replace", summary="Replace your key with a new one (after confirming it's you)")
def replace_key(
    request: Request, response: Response, conn: Db, person: UserPrincipal, as_session: SessionCookie = None
) -> dict[str, Any]:
    """ephemeralREST makes a new key (`/me/rotate`, without emailing it) and the old one stops
    working everywhere. The new key is saved here and shown once, to copy to other sites."""
    _require_reauth(conn, as_session)
    settings: Settings = request.app.state.settings
    old = stored_key(conn, settings, person.id)
    if not old:
        raise ProblemError(404, "no-api-key", "No key saved", None)
    url = configured_url(conn, settings)
    site = signup.site_key(conn, settings)
    with Ephemeral(
        url,
        old,
        transport(request),
        request.app.state.ephemeral_cache,
        headers={"X-Site-Key": site} if site else None,
    ) as eph:
        data = eph.post("/me/rotate", {"email_key": False})
        new = data.get("api_key") if isinstance(data, dict) else None
        if not isinstance(new, str) or not new:
            raise ProblemError(502, "ephemeral-error", "ephemeralREST didn't return the new key", None)
        eph.forget_cached()
    row = conn.execute(
        "SELECT identity, email, name FROM ephemeral_keys k JOIN users u ON u.id = k.user_id"
        " WHERE k.user_id = ?",
        (person.id,),
    ).fetchone()
    identity = json.loads(row["identity"]) if row and row["identity"] else None
    for attempt in range(2):
        try:
            with transaction(conn):
                store_key(conn, settings, person.id, new, identity)
            break
        except sqlite3.Error:
            if attempt:
                audit.record(conn, request, "key_replaced", "not-saved", user_id=person.id, detail=new[:8])
                raise ProblemError(
                    500,
                    "key-not-saved",
                    "Your key was replaced but couldn't be saved here",
                    'Use "Use my key from another site" to fetch it.',
                ) from None
    if row is not None:
        from .auth import signup_deliver

        signup_deliver(request, conn, data, row["email"], row["name"])
    audit.record(conn, request, "key_replaced", "done", user_id=person.id, detail=f"{old[:8]} → {new[:8]}")
    response.headers.update(NO_STORE)
    return {
        "api_key": new,
        **_public(conn.execute("SELECT * FROM ephemeral_keys WHERE user_id = ?", (person.id,)).fetchone()),
    }


# ---------------------------------------------------------------------------
# Your logins, and your use of the chart service


@router.get("/activity", summary="Your own logins and account changes, newest first")
def my_activity(
    conn: Db, person: UserPrincipal, before: int | None = None, failures: bool = False
) -> dict[str, Any]:
    return audit.page(conn, user_id=person.id, before=before, failures=failures)


@router.get("/usage", summary="How much of your limits you've used")
def my_usage(conn: Db, person: UserPrincipal) -> dict[str, Any]:
    return limits.usage(conn, person.id)


# ---------------------------------------------------------------------------
# Your data


def _your_ephemeral(request: Request, conn: Db, user_id: str) -> Ephemeral | None:
    settings: Settings = request.app.state.settings
    key = stored_key(conn, settings, user_id)
    url = configured_url(conn, settings)
    if not key or not url:
        return None
    return Ephemeral(url, key, transport(request), request.app.state.ephemeral_cache)


@router.get("/export", summary="A copy of everything AstrologyStudio keeps for you")
def export(request: Request, conn: Db, person: UserPrincipal) -> Response:
    """One JSON file: your account, your chart list (birth details, and what each derived chart was
    worked out from), your notes, folders, ratings and tags, and every preference, theme, layout
    and preset. Your ephemeralREST key isn't included."""
    user = conn.execute(
        "SELECT email, name, is_owner, signs_in_with, created_at FROM users WHERE id = ?", (person.id,)
    ).fetchone()
    stored = {
        row["key"]: json.loads(row["value"])
        for row in conn.execute("SELECT key, value FROM preferences WHERE user_id = ?", (person.id,))
    }
    folders = [dict(r) for r in conn.execute("SELECT * FROM folders WHERE user_id = ?", (person.id,))]
    notes = [dict(r) for r in conn.execute("SELECT * FROM chart_notes WHERE user_id = ?", (person.id,))]
    kept = [dict(r) for r in conn.execute("SELECT * FROM kept_derived WHERE user_id = ?", (person.id,))]
    for item in folders + notes + kept:
        item.pop("user_id", None)
    data: dict[str, Any] = {
        "astrologystudio_export": 1,
        "exported_at": now(),
        "app_version": __version__,
        "account": dict(user),
        "charts": None,
        "chart_notes": notes,
        "kept_derived": kept,
        "folders": folders,
        "preferences": stored,
        "activity": audit.for_export(conn, person.id),
    }
    client = _your_ephemeral(request, conn, person.id)
    if client is None:
        data["charts_problem"] = "No ephemeralREST key saved, so your chart list couldn't be included."
    else:
        with client:
            try:
                data["charts"] = charts.account_list(client, None)
            except ProblemError as problem:
                data["charts_problem"] = f"{problem.title}. {problem.detail or ''}".strip()
    body = json.dumps(data, indent=2, ensure_ascii=False)
    name = f"astrologystudio-{(user['email'] or 'export').split('@')[0]}-{now()[:10]}.json"
    return Response(
        body,
        media_type="application/json",
        headers={"Content-Disposition": f'attachment; filename="{name}"', "Cache-Control": "no-store"},
    )


class DeleteAccount(Strict):
    password: str | None = None
    """People who log in with a password here confirm with it."""
    email: str | None = None
    """People who log in through ephemeralREST confirm by typing their email address."""
    remove_charts: bool = False
    """Also take every chart off your ephemeralREST chart list."""


@router.post("/delete", status_code=204, summary="Delete your account")
def delete_account(body: DeleteAccount, request: Request, conn: Db, person: UserPrincipal) -> Response:
    """Removes your account and everything kept for you here: preferences, themes, layouts, presets,
    notes, folders, your saved key and every session. With `remove_charts`, your charts are also
    taken off your ephemeralREST chart list first (your ephemeralREST account itself stays). The
    owner's account runs the install, so it can't be deleted this way."""
    row = conn.execute(
        "SELECT email, password_hash, is_owner, signs_in_with FROM users WHERE id = ?", (person.id,)
    ).fetchone()
    if row["is_owner"]:
        raise ProblemError(
            409,
            "owner-cant-delete",
            "The owner's account can't be deleted",
            "It runs this install. Remove the install instead, or ask for help moving it.",
        )
    if row["signs_in_with"] == "ephemeral":
        if normalise_email(body.email or "") != row["email"]:
            raise ProblemError(422, "confirm-email", "Type your email address to confirm", None)
    elif not body.password or not accounts.check_password(body.password, row["password_hash"]):
        raise ProblemError(422, "bad-password", "That password isn't right", None)
    if body.remove_charts:
        client = _your_ephemeral(request, conn, person.id)
        if client is not None:
            with client:
                listed = charts.account_list(client, None)
                # Derived charts first, then the charts they came from.
                for entry in sorted(listed, key=lambda c: c.get("type") != "derived"):
                    client.delete(f"/account/charts/{entry.get('uuid')}")
    with transaction(conn):
        conn.execute("DELETE FROM users WHERE id = ?", (person.id,))  # everything else cascades
    response = Response(status_code=204)
    response.delete_cookie(accounts.SESSION_COOKIE, path="/")
    return response
