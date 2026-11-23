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
from typing import Annotated, Any

from fastapi import APIRouter, Cookie, Request, Response
from pydantic import EmailStr, Field

from .. import accounts
from ..config import Settings
from ..db import now, transaction
from ..deps import Db, OwnerPrincipal, UserPrincipal, transport
from ..ephemeral import Ephemeral, configured_url
from ..errors import ProblemError
from ..schemas import Strict, normalise_email
from .account import store_key

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
    return {
        "setup_required": accounts.user_count(conn) == 0,
        "registration_open": accounts.registration_open(conn),
        "hosted": request.app.state.settings.hosted,
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
        raise ProblemError(429, "too-many-attempts", "Too many attempts", "Wait 15 minutes and try again.")
    row = conn.execute("SELECT signs_in_with FROM users WHERE email = ?", (email,)).fetchone()
    if (row is None and accounts.registration_open(conn)) or (
        row is not None and row["signs_in_with"] == "ephemeral"
    ):
        request_body: dict[str, Any] = {"email": email, "password": body.password}
        if as_device:
            request_body["device_token"] = as_device
        try:
            data = _ephemeral(conn, request).post("/login", request_body)
        except ProblemError as problem:
            if problem.slug != "ephemeral-key-rejected":  # ephemeralREST's 401: wrong email or password
                raise
            throttle.failed(*keys)
            raise ProblemError(
                401,
                "bad-login",
                "Wrong email or password",
                "Just registered? Set your password with the link in your second email first.",
            ) from None
        if data.get("must_change_password"):
            raise ProblemError(
                409,
                "password-not-set",
                "Set your password first",
                "Use the link in your email from ephemeralREST.",
            )
        throttle.succeeded(keys[0])
        if data.get("2fa_required"):
            return {"two_factor": True, "email": email}
        return _signed_in_through_ephemeral(conn, request, response, email, data)
    user = accounts.authenticate_password(conn, email, body.password)
    if user is None:
        throttle.failed(*keys)
        raise ProblemError(401, "bad-login", "Wrong email or password", None)
    throttle.succeeded(keys[0])
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
        raise ProblemError(429, "too-many-attempts", "Too many attempts", "Wait 15 minutes and try again.")
    row = conn.execute("SELECT signs_in_with FROM users WHERE email = ?", (email,)).fetchone()
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
        raise ProblemError(
            401,
            "bad-code",
            "That code didn't work",
            "Codes expire after a few minutes. Log in again for a new one.",
        ) from None
    throttle.succeeded(keys[0])
    result = _signed_in_through_ephemeral(conn, request, response, email, data)
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
    """Only when the owner allows it. ephemeralREST emails a link to verify the address, then a
    link to set a password; after that, log in here with that email and password."""
    if not accounts.registration_open(conn):
        raise ProblemError(403, "registration-closed", "This install isn't taking new accounts", None)
    throttle: accounts.LoginThrottle = request.app.state.login_throttle
    ip_key = f"register:{request.client.host if request.client else '-'}"
    if throttle.blocked(ip_key):
        raise ProblemError(429, "too-many-attempts", "Too many attempts", "Wait 15 minutes and try again.")
    throttle.failed(
        ip_key
    )  # counts every registration from this address, so it can't be used to send floods of email
    email = normalise_email(body.email)
    _ephemeral(conn, request).post("/register", {"name": body.name.strip(), "email": email})
    return {"email": email}


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
    request: Request, response: Response, conn: Db, _: UserPrincipal, as_session: SessionCookie = None
) -> None:
    if as_session:
        with transaction(conn):
            accounts.end_session(conn, as_session)
    response.delete_cookie(accounts.SESSION_COOKIE, path="/")


@router.get("/me", summary="The logged-in user")
def me(conn: Db, person: UserPrincipal) -> dict[str, Any]:
    assert person.csrf_token is not None
    return _me(conn, person.id, person.csrf_token)


@router.post("/password", status_code=204, summary="Change your password")
def change_password(
    body: PasswordChange, conn: Db, person: UserPrincipal, as_session: SessionCookie = None
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
