"""
AstrologyStudio ·
server/astrologystudio/api/auth.py

/api/v1/auth:

first-run setup, login, logout, and the current user.

Copyright (c) 2026 Gavin Melhuish
MIT License; see LICENSE in the project root.
SPDX-License-Identifier: MIT
"""

from __future__ import annotations

import json
import logging
from datetime import UTC, datetime
from typing import Annotated, Any

from fastapi import APIRouter, Cookie, Request, Response
from pydantic import EmailStr, Field

from .. import accounts, audit, email_design, mail, signup
from ..config import Settings
from ..db import now, transaction
from ..deps import Db, OwnerPrincipal, UserPrincipal, transport
from ..ephemeral import Ephemeral, configured_url
from ..errors import ProblemError
from ..schemas import Strict, normalise_email
from .account import store_key

log = logging.getLogger("astrologystudio")

router = APIRouter(prefix="/auth", tags=["Login"])
Password = Annotated[str, Field(min_length=1, max_length=200)]
SessionCookie = Annotated[str | None, Cookie(alias=accounts.SESSION_COOKIE)]
# ephemeralREST's "remember this device" token, so its emailed code isn't asked for every time.
DEVICE_COOKIE = "as_device"
DeviceCookie = Annotated[str | None, Cookie(alias=DEVICE_COOKIE)]


class Setup(Strict):
    name: Annotated[str, Field(min_length=1, max_length=200)]
    email: EmailStr
    password: Password


class Login(Strict):
    email: EmailStr
    password: Password


class Register(Strict):
    name: Annotated[str, Field(min_length=1, max_length=100)]
    email: EmailStr


class LoginCode(Strict):
    email: EmailStr
    code: Annotated[str, Field(min_length=4, max_length=12)]
    remember: bool = False


class RegistrationSetting(Strict):
    open: bool


class PasswordChange(Strict):
    current_password: Password
    new_password: Password


def _set_cookie(response: Response, request: Request, token: str) -> None:
    app: Settings = request.app.state.settings
    response.set_cookie(
        accounts.SESSION_COOKIE,
        token,
        max_age=int(accounts.SESSION_LIFETIME.total_seconds()),
        httponly=True,
        secure=app.secure_cookies,
        samesite="lax",
        path="/",
    )


def _me(conn: Db, user_id: str, csrf_token: str) -> dict[str, Any]:
    row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    return {"user": accounts.public_user(row), "csrf_token": csrf_token}


@router.get("/status", summary="Is setup needed, and who is logged in?")
def status(conn: Db, request: Request, as_session: SessionCookie = None) -> dict[str, Any]:
    """Public. The web app calls this first to choose between the setup, login and main screens."""
    session = accounts.load_session(conn, as_session) if as_session else None
    open_ = accounts.registration_open(conn)
    here = open_ and signup.links_ready(request, conn)
    return {
        "setup_required": accounts.user_count(conn) == 0,
        "registration_open": open_,
        # "here": the sign-up email links back to this site; "portal": to ephemeralREST's pages.
        "signup_flow": "here" if here else "portal",
        "hosted": request.app.state.settings.hosted,
        # "Forgot your password?" works when the owner has set up email (or ephemeralREST's
        # resets link back here).
        "password_reset": mail.configured(conn) or here,
        "user": _me(conn, session.user_id, session.csrf_token) if session else None,
    }


@router.post("/setup", summary="Create the first account")
def setup(body: Setup, request: Request, response: Response, conn: Db) -> dict[str, Any]:
    """Only works while the install has no accounts at all."""
    email = normalise_email(body.email)
    problem = accounts.password_problem(body.password, email)
    if problem:
        raise ProblemError(422, "weak-password", "Choose a stronger password", problem)
    with transaction(conn):
        if accounts.user_count(conn):
            raise ProblemError(
                409, "already-set-up", "Already set up", "This install already has an account."
            )
        user_id = accounts.create_user(conn, email=email, name=body.name, password=body.password, owner=True)
        token = accounts.start_session(conn, user_id)
    _set_cookie(response, request, token)
    session = accounts.load_session(conn, token)
    assert session is not None
    return _me(conn, user_id, session.csrf_token)


@router.post("/login", summary="Log in")
def login(
    body: Login, request: Request, response: Response, conn: Db, as_device: DeviceCookie = None
) -> dict[str, Any]:
    """With a password kept here, or, for people who registered through ephemeralREST, with
    their ephemeralREST email and password. Those usually answer `{"two_factor": true}`: a
    code has been emailed, so finish at /auth/login/code."""
    throttle: accounts.LoginThrottle = request.app.state.login_throttle
    email = normalise_email(body.email)
    keys = _throttle_keys(request, email)
    if throttle.blocked(*keys):
        audit.record(conn, request, "login", "throttled", email=email)
        raise ProblemError(429, "too-many-attempts", "Too many attempts", "Wait 15 minutes and try again.")
    row = conn.execute(
        "SELECT signs_in_with, disabled_at, ignore_device FROM users WHERE email = ?", (email,)
    ).fetchone()
    if row is not None and row["disabled_at"]:  # checked here, before ephemeralREST is asked
        audit.record(conn, request, "login", "disabled", email=email)
        raise accounts.disabled_problem()
    if (row is None and accounts.registration_open(conn)) or (
        row is not None and row["signs_in_with"] == "ephemeral"
    ):
        request_body: dict[str, Any] = {"email": email, "password": body.password}
        if as_device and not (row is not None and row["ignore_device"]):
            request_body["device_token"] = as_device
        try:
            with signup.client(request, conn) as eph:  # the site key says which site this is
                data = eph.post("/login", request_body)
        except ProblemError as problem:
            if problem.slug != "ephemeral-key-rejected":  # ephemeralREST's 401: wrong email or password
                raise
            throttle.failed(*keys)
            audit.record(conn, request, "login", "bad-password", email=email, detail="ephemeralREST")
            raise ProblemError(
                401,
                "bad-login",
                "Wrong email or password",
                "Just registered? Set your password with the link in your second email first.",
            ) from None
        if data.get("must_change_password"):
            audit.record(conn, request, "login", "password-not-set", email=email)
            raise ProblemError(
                409,
                "password-not-set",
                "Set your password first",
                "Use the link in your email from ephemeralREST.",
            )
        throttle.succeeded(keys[0])
        if data.get("2fa_required"):
            audit.record(conn, request, "login", "code-sent", email=email, detail="ephemeralREST")
            signup_deliver(request, conn, data, email, str(data.get("name") or email.split("@")[0]))
            return {"two_factor": True, "email": email}
        audit.record(conn, request, "trusted_device", "code-skipped", email=email)
        result = _signed_in_through_ephemeral(conn, request, response, email, data)
        audit.record(conn, request, "login", "success", email=email, detail="ephemeralREST")
        return result
    user = accounts.authenticate_password(conn, email, body.password)
    if user is None:
        throttle.failed(*keys)
        audit.record(conn, request, "login", "bad-password", email=email)
        raise ProblemError(401, "bad-login", "Wrong email or password", None)
    throttle.succeeded(keys[0])
    audit.record(conn, request, "login", "success", user_id=user["id"], detail="password")
    with transaction(conn):
        token = accounts.start_session(conn, user["id"])
    _set_cookie(response, request, token)
    session = accounts.load_session(conn, token)
    assert session is not None
    return _me(conn, user["id"], session.csrf_token)


@router.post("/login/code", summary="Finish logging in with the emailed code")
def login_code(body: LoginCode, request: Request, response: Response, conn: Db) -> dict[str, Any]:
    """For people who sign in through ephemeralREST. `remember` skips the code on this browser
    for as long as ephemeralREST allows (28 days unless it's set otherwise). The first time
    someone signs in, their AstrologyStudio account is made and their ephemeralREST key saved."""
    throttle: accounts.LoginThrottle = request.app.state.login_throttle
    email = normalise_email(body.email)
    keys = _throttle_keys(request, email)
    if throttle.blocked(*keys):
        audit.record(conn, request, "login_code", "throttled", email=email)
        raise ProblemError(429, "too-many-attempts", "Too many attempts", "Wait 15 minutes and try again.")
    row = conn.execute("SELECT signs_in_with, disabled_at FROM users WHERE email = ?", (email,)).fetchone()
    if row is not None and row["disabled_at"]:
        audit.record(conn, request, "login_code", "disabled", email=email)
        raise accounts.disabled_problem()
    allowed = (row is None and accounts.registration_open(conn)) or (
        row is not None and row["signs_in_with"] == "ephemeral"
    )
    if not allowed:
        raise ProblemError(401, "bad-code", "That code didn't work", None)
    try:
        data = _ephemeral(conn, request).post(
            "/login/2fa", {"email": email, "code": body.code.strip(), "remember_device": body.remember}
        )
    except ProblemError as problem:
        if problem.slug != "ephemeral-key-rejected":
            raise
        throttle.failed(*keys)
        audit.record(conn, request, "login_code", "bad-code", email=email)
        raise ProblemError(
            401,
            "bad-code",
            "That code didn't work",
            "Codes expire after a few minutes. Log in again for a new one.",
        ) from None
    throttle.succeeded(keys[0])
    result = _signed_in_through_ephemeral(conn, request, response, email, data)
    audit.record(conn, request, "login_code", "success", email=email)
    with transaction(conn):
        conn.execute("UPDATE users SET ignore_device = 0 WHERE email = ?", (email,))
    if data.get("device_token"):
        app: Settings = request.app.state.settings
        response.set_cookie(
            DEVICE_COOKIE,
            str(data["device_token"]),
            max_age=int(data.get("device_token_expires_days") or 28) * 86400,
            httponly=True,
            secure=app.secure_cookies,
            samesite="lax",
            path="/api/v1/auth",
        )
    return result


@router.post("/register", status_code=202, summary="Create an account through ephemeralREST")
def register(body: Register, request: Request, conn: Db) -> dict[str, Any]:
    """Only when the owner allows it. ephemeralREST emails a link to confirm the address. With a
    site key (`flow` "here"), the link comes back to /auth/verify here, where they choose a
    password and are signed in. Otherwise (`flow` "portal") it goes to ephemeralREST's pages,
    which then email a link to set a password; after that, they log in here."""
    if not accounts.registration_open(conn):
        raise ProblemError(403, "registration-closed", "This install isn't taking new accounts", None)
    _count_registration(request)
    email = normalise_email(body.email)
    data, here = signup.post_with_links(
        request, conn, "/register", {"name": body.name.strip(), "email": email}, ("verify", "set_password")
    )
    signup_deliver(request, conn, data, email, body.name.strip())
    audit.record(conn, request, "registration", "requested", email=email, detail="here" if here else "portal")
    return {"email": email, "flow": "here" if here else "portal"}


def _count_registration(request: Request, key: str = "register") -> None:
    """Every registration from an address counts, so it can't be used to send floods of email."""
    throttle: accounts.LoginThrottle = request.app.state.login_throttle
    ip_key = f"{key}:{request.client.host if request.client else '-'}"
    if throttle.blocked(ip_key):
        raise ProblemError(429, "too-many-attempts", "Too many attempts", "Wait 15 minutes and try again.")
    throttle.failed(ip_key)


def signup_deliver(request: Request, conn: Db, data: Any, email: str, name: str) -> None:
    """Send an email ephemeralREST handed back for this site to deliver (see delivery.py)."""
    if isinstance(data, dict) and isinstance(data.get("deliver"), dict):
        from .. import delivery

        delivery.send(request, conn, data["deliver"], email, name)


class Verify(Strict):
    token: Annotated[str, Field(min_length=10, max_length=255)]
    password: Annotated[str, Field(max_length=200)]


EXPIRED = "Ask for a new link: sign up again with the same address, or use Forgot your password."


@router.post("/verify", summary="Finish signing up from the emailed link")
def verify(body: Verify, request: Request, response: Response, conn: Db) -> dict[str, Any]:
    """From /auth/verify?t=… : confirms the address and sets the ephemeralREST password in one
    step (ephemeralREST's /register/complete). Then, whichever applies:

    - someone here asked for this account ("I don't have a key"): the key is saved to them,
      whichever browser this is (`result` "key_saved");
    - the address already has an account here that signs in through ephemeralREST: it's signed in;
    - otherwise, if this site takes new accounts, one is made and signed in (`result` "signed_in").

    Confirming the address stands in for the emailed code this first time."""
    _count_registration(request, "verify")
    if len(body.password) < 8:
        raise ProblemError(422, "weak-password", "Choose a longer password", "Use at least 8 characters.")
    try:
        with signup.client(request, conn) as eph:
            data = eph.post("/register/complete", {"token": body.token.strip(), "password": body.password})
    except ProblemError as problem:
        if problem.status == 422 and problem.detail and "already set up" in problem.detail:
            raise ProblemError(
                409, "already-set-up", "This account is already set up", "Log in instead."
            ) from None
        if problem.status == 422:
            audit.record(conn, request, "registration_complete", "link-expired")
            raise ProblemError(410, "link-expired", "This link has expired or been used", EXPIRED) from None
        raise
    email = normalise_email(str(data.get("identifier") or ""))
    key = data.get("api_key")
    if not email or not isinstance(key, str) or not key:
        raise ProblemError(502, "ephemeral-error", "ephemeralREST didn't return the new account", None)
    name = str(data.get("name") or email.split("@")[0])
    signup_deliver(request, conn, data, email, name)
    identity = {k: data.get(k) for k in ("name", "identifier", "rate_limits")}
    asked_by = signup.key_request_for(conn, email)
    if asked_by:
        audit.record(conn, request, "registration_complete", "completed", user_id=asked_by, email=email)
        signup.adopt(request, conn, asked_by, key, identity, "add")
        with transaction(conn):
            conn.execute("DELETE FROM key_requests WHERE user_id = ?", (asked_by,))
        return {"result": "key_saved", "email": email}
    row = conn.execute(
        "SELECT id, signs_in_with, disabled_at FROM users WHERE email = ?", (email,)
    ).fetchone()
    if row is not None and row["disabled_at"]:
        audit.record(conn, request, "login", "disabled", email=email)
        raise accounts.disabled_problem()
    if row is not None and row["signs_in_with"] == "password":
        audit.record(conn, request, "registration_complete", "completed", user_id=row["id"])
        # Their login here has its own password: keep it, and give them the key.
        signup.adopt(request, conn, row["id"], key, identity, "add")
        return {"result": "key_saved", "email": email}
    if row is None and not accounts.registration_open(conn):
        raise ProblemError(
            403,
            "registration-closed",
            "Your account is ready, but this site isn't taking new accounts",
            "Ask the site's owner to add you.",
        )
    result = _signed_in_through_ephemeral(conn, request, response, email, data)
    audit.record(conn, request, "registration_complete", "completed", email=email)  # the account exists now
    return {"result": "signed_in", **result}


class EphemeralPassword(Strict):
    token: Annotated[str, Field(min_length=10, max_length=255)]
    password: Annotated[str, Field(max_length=200)]


@router.post("/ephemeral-password", status_code=204, summary="Choose a new password from the emailed link")
def ephemeral_password(body: EphemeralPassword, request: Request, conn: Db) -> None:
    """From /auth/set-password?t=… : for people who sign in through ephemeralREST and asked to
    reset their password. Logging in afterwards renews their key here."""
    _count_registration(request, "reset")
    if len(body.password) < 8:
        raise ProblemError(422, "weak-password", "Choose a longer password", "Use at least 8 characters.")
    try:
        with signup.client(request, conn) as eph:
            data = eph.post("/password/set", {"token": body.token.strip(), "new_password": body.password})
    except ProblemError as problem:
        if problem.status == 422:
            audit.record(conn, request, "password_reset", "link-expired")
            raise ProblemError(410, "link-expired", "This link has expired or been used", ASK_AGAIN) from None
        raise
    who = data.get("identifier") if isinstance(data, dict) else None
    audit.record(
        conn,
        request,
        "password_reset",
        "completed",
        email=normalise_email(str(who)) if who else "",
        detail="ephemeralREST",
    )


@router.put("/registration", summary="Let new people create accounts, or not")
def set_registration(body: RegistrationSetting, conn: Db, _: OwnerPrincipal) -> dict[str, Any]:
    with transaction(conn):
        conn.execute(
            "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)"
            " ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
            (accounts.REGISTRATION_SETTING, json.dumps(body.open), now()),
        )
    return {"registration_open": body.open}


def _throttle_keys(request: Request, email: str) -> tuple[str, str]:
    return (f"email:{email}", f"ip:{request.client.host if request.client else '-'}")


def _ephemeral(conn: Db, request: Request) -> Ephemeral:
    """ephemeralREST without a key: registering and logging in need none."""
    return Ephemeral(configured_url(conn, request.app.state.settings), None, transport(request))


def _signed_in_through_ephemeral(
    conn: Db, request: Request, response: Response, email: str, data: dict[str, Any]
) -> dict[str, Any]:
    """ephemeralREST accepted them and handed over their key: make their account here the first
    time, save the key (it replaces any older one), and start a session."""
    key = data.get("api_key")
    if not isinstance(key, str) or not key:
        raise ProblemError(502, "ephemeral-error", "ephemeralREST didn't return your key", None)
    settings: Settings = request.app.state.settings
    identity = {k: data.get(k) for k in ("name", "identifier", "rate_limits")}
    with transaction(conn):
        row = conn.execute("SELECT id FROM users WHERE email = ?", (email,)).fetchone()
        user_id = (
            row["id"]
            if row is not None
            else accounts.create_ephemeral_user(
                conn, email=email, name=str(data.get("name") or email.split("@")[0])
            )
        )
        store_key(conn, settings, user_id, key, identity)
        token = accounts.start_session(conn, user_id)
    _set_cookie(response, request, token)
    session = accounts.load_session(conn, token)
    assert session is not None
    return _me(conn, user_id, session.csrf_token)


@router.post("/logout", status_code=204, summary="Log out")
def logout(
    request: Request, response: Response, conn: Db, person: UserPrincipal, as_session: SessionCookie = None
) -> None:
    if as_session:
        with transaction(conn):
            accounts.end_session(conn, as_session)
    audit.record(conn, request, "logout", "by-person", user_id=person.id)
    response.delete_cookie(accounts.SESSION_COOKIE, path="/")


@router.get("/me", summary="The logged-in user")
def me(conn: Db, person: UserPrincipal) -> dict[str, Any]:
    assert person.csrf_token is not None
    return _me(conn, person.id, person.csrf_token)


@router.post("/password", status_code=204, summary="Change your password")
def change_password(
    body: PasswordChange, request: Request, conn: Db, person: UserPrincipal, as_session: SessionCookie = None
) -> None:
    """Also logs out every other session of this account."""
    row = conn.execute(
        "SELECT email, password_hash, signs_in_with FROM users WHERE id = ?", (person.id,)
    ).fetchone()
    if row["signs_in_with"] == "ephemeral":
        raise ProblemError(
            409,
            "ephemeral-password",
            "Your password is kept by ephemeralREST",
            "Change it there; it's the one you log in with here.",
        )
    if not accounts.check_password(body.current_password, row["password_hash"]):
        audit.record(conn, request, "password_changed", "bad-password", user_id=person.id)
        raise ProblemError(422, "bad-password", "Current password is wrong", None)
    problem = accounts.password_problem(body.new_password, row["email"])
    if problem:
        raise ProblemError(422, "weak-password", "Choose a stronger password", problem)
    with transaction(conn):
        conn.execute(
            "UPDATE users SET password_hash = ? WHERE id = ?",
            (accounts.hash_password(body.new_password), person.id),
        )
        accounts.end_other_sessions(conn, person.id, as_session)
    audit.record(conn, request, "password_changed", "completed", user_id=person.id)
    _tell(conn, request, person.id, "password_changed", {"date": now()[:10]})


# ---------------------------------------------------------------------------
# Forgot your password?


ASK_AGAIN = "Ask for a new one from the login page."


class ResetRequest(Strict):
    email: EmailStr


class ResetFinish(Strict):
    token: Annotated[str, Field(min_length=20, max_length=200)]
    new_password: Annotated[str, Field(max_length=200)]


@router.post("/password-reset", status_code=202, summary="Email a link to set a new password")
def request_reset(body: ResetRequest, request: Request, conn: Db) -> dict[str, Any]:
    """Public. Always answers the same way, whether or not there's an account for the address,
    so it can't be used to find out who has one. Accounts that sign in through ephemeralREST
    reset their password there, so they get an email saying so instead of a link."""
    settings: Settings = request.app.state.settings
    here = signup.links_ready(request, conn)
    if not mail.configured(conn) and not here:
        raise ProblemError(
            409,
            "email-not-set-up",
            "Password resets need email",
            "Ask the owner to set up email in Settings, or to give you a new password from the server.",
        )
    email = normalise_email(str(body.email))
    row = conn.execute("SELECT id, name, signs_in_with FROM users WHERE email = ?", (email,)).fetchone()
    audit.record(conn, request, "password_reset", "requested", email=email)
    if row is not None:
        try:
            if row["signs_in_with"] == "ephemeral" and here:
                # ephemeralREST keeps the password: its reset email links back here.
                with transaction(conn):
                    allowed = accounts.start_reset(conn, row["id"]) is not None
                if allowed:
                    data, _ = signup.post_with_links(
                        request, conn, "/password/forgot", {"email": email}, ("set_password",)
                    )
                    signup_deliver(request, conn, data, email, row["name"])
            elif row["signs_in_with"] == "ephemeral" and mail.configured(conn):
                with transaction(conn):
                    allowed = accounts.start_reset(conn, row["id"]) is not None
                if allowed:
                    email_design.send(conn, settings, "password_elsewhere", email, {"name": row["name"]})
            elif row["signs_in_with"] != "ephemeral" and mail.configured(conn):
                with transaction(conn):
                    token = accounts.start_reset(conn, row["id"])
                if token:
                    link = f"{settings.base_url}/reset-password?token={token}"
                    expires = (datetime.now(UTC) + accounts.RESET_LIFETIME).strftime("%d %b %Y, %H:%M UTC")
                    email_design.send(
                        conn,
                        settings,
                        "password_reset",
                        email,
                        {"name": row["name"], "link": link, "expires": expires},
                    )
        except ProblemError:
            # Not telling the person asking: that would show the account exists. The owner sees
            # sending problems when they send a test message.
            log.warning("A password reset email couldn't be sent", exc_info=True)
    return {"sent": True}


@router.get("/password-reset/{token}", summary="Check a reset link before choosing a password")
def check_reset(token: str, conn: Db) -> dict[str, Any]:
    row = accounts.reset_user(conn, token)
    if row is None:
        raise ProblemError(
            410,
            "reset-expired",
            "This link has expired or been used",
            "Ask for a new one from the login page.",
        )
    return {"email": row["email"]}


@router.post("/password-reset/finish", status_code=204, summary="Set a new password from a reset link")
def finish_reset(body: ResetFinish, request: Request, conn: Db) -> None:
    """Logs the account out everywhere; log in again with the new password."""
    row = accounts.reset_user(conn, body.token)
    if row is None:
        raise ProblemError(
            410,
            "reset-expired",
            "This link has expired or been used",
            "Ask for a new one from the login page.",
        )
    problem = accounts.password_problem(body.new_password, row["email"])
    if problem:
        raise ProblemError(422, "weak-password", "Choose a stronger password", problem)
    with transaction(conn):
        accounts.finish_reset(conn, body.token, row["id"], body.new_password)
    audit.record(conn, request, "password_reset", "completed", user_id=row["id"])
    _tell(conn, request, row["id"], "password_changed", {"date": now()[:10]})


def _tell(conn: Db, request: Request, user_id: str, key: str, values: dict[str, str]) -> None:
    """A notice by email, when email is set up. A failure doesn't undo what's been done."""
    if not mail.configured(conn):
        return
    row = conn.execute("SELECT email, name FROM users WHERE id = ?", (user_id,)).fetchone()
    if row is None:
        return
    try:
        email_design.send(
            conn, request.app.state.settings, key, row["email"], {"name": row["name"], **values}
        )
    except ProblemError:
        log.warning("A %s email couldn't be sent", key, exc_info=True)
