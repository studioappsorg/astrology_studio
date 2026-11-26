"""
AstrologyStudio ·
server/astrologystudio/api/email_design.py

/api/v1/email/branding, /email/templates and /email/delivery (owner only): the email designer,
and sending ephemeralREST's emails from this site. Also /email/logo, the logo emails show (public,
because mail programs fetch it; raster images only).

Copyright (c) 2026 Gavin Melhuish
MIT License; see LICENSE in the project root.
SPDX-License-Identifier: MIT
"""

from __future__ import annotations

import base64
import re
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Request, Response
from pydantic import Field, field_validator

from .. import delivery, email_design, mail, signup
from ..config import Settings
from ..db import transaction
from ..deps import Db, OwnerPrincipal
from ..errors import ProblemError, not_found
from ..schemas import Strict
from .email import _address

router = APIRouter(prefix="/email", tags=["Email"])

LOGO_MAX = 300_000


class Branding(Strict):
    use_site_logo: bool = True
    logo: Annotated[str, Field(max_length=LOGO_MAX * 2)] | None = None
    """A smaller logo just for email, as a data URL (PNG, JPEG or WebP). Null: none of its own."""
    accent: Annotated[str, Field(pattern=r"^#[0-9a-fA-F]{6}$")] = email_design.DEFAULT_ACCENT
    sender_name: Annotated[str, Field(max_length=100)] = ""
    reply_to: Annotated[str, Field(max_length=320)] = ""
    footer: Annotated[str, Field(max_length=1000)] = ""

    @field_validator("logo")
    @classmethod
    def _logo(cls, value: str | None) -> str | None:
        if value is not None and not re.match(r"^data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$", value):
            raise ValueError("Use a PNG, JPEG or WebP image (many mail programs can't show SVG)")
        return value

    @field_validator("reply_to")
    @classmethod
    def _reply(cls, value: str) -> str:
        return _address(value, blank=True)


@router.get("/branding", summary="The look shared by every email")
def get_branding(conn: Db, _: OwnerPrincipal) -> dict[str, Any]:
    return email_design.branding(conn)


@router.put("/branding", summary="Change the look shared by every email")
def put_branding(body: Branding, conn: Db, _: OwnerPrincipal) -> dict[str, Any]:
    with transaction(conn):
        email_design.save_branding(conn, body.model_dump())
    return email_design.branding(conn)


@router.get("/logo", summary="The logo emails show (public)", include_in_schema=False)
def email_logo(conn: Db) -> Response:
    found = email_design.logo_data_url(conn)
    if found is None:
        raise not_found("Logo", "email")
    header, _, data = found.partition(",")
    mime = header.removeprefix("data:").removesuffix(";base64")
    return Response(
        base64.b64decode(data),
        media_type=mime,
        headers={"Cache-Control": "public, max-age=3600", "Content-Security-Policy": "default-src 'none'"},
    )


# ---------------------------------------------------------------------------
# Templates


def _known(key: str) -> None:
    if key not in email_design.TEMPLATES:
        raise not_found("Email", key)


class TemplateUpdate(Strict):
    subject: Annotated[str, Field(max_length=500)]
    body: Annotated[str, Field(max_length=10_000)]
    enabled: bool = True
    """For the optional emails (account switched off or on); the others are always sent."""


class Draft(Strict):
    """Unsaved changes to preview or test; left out, the saved template."""

    subject: Annotated[str, Field(max_length=500)] | None = None
    body: Annotated[str, Field(max_length=10_000)] | None = None


@router.get("/templates", summary="Every email, with its subject and body")
def list_templates(conn: Db, _: OwnerPrincipal) -> dict[str, Any]:
    return {"data": [email_design.template(conn, key) for key in email_design.TEMPLATES]}


@router.get("/templates/{key}", summary="One email's design")
def get_template(key: str, conn: Db, _: OwnerPrincipal) -> dict[str, Any]:
    _known(key)
    return email_design.template(conn, key)


@router.put("/templates/{key}", summary="Change one email's design")
def put_template(key: str, body: TemplateUpdate, conn: Db, _: OwnerPrincipal) -> dict[str, Any]:
    _known(key)
    found = email_design.problems(key, body.subject, body.body)
    if found:
        raise ProblemError(422, "bad-template", "Fix the email first", " ".join(found), problems=found)
    enabled = body.enabled if email_design.TEMPLATES[key].optional else True
    with transaction(conn):
        email_design.save_template(conn, key, body.subject.strip(), body.body.strip(), enabled)
    return email_design.template(conn, key)


@router.delete("/templates/{key}", summary="Put one email back to the original")
def reset_template(key: str, conn: Db, _: OwnerPrincipal) -> dict[str, Any]:
    _known(key)
    with transaction(conn):
        conn.execute("DELETE FROM email_templates WHERE key = ?", (key,))
    return email_design.template(conn, key)


def _draft(key: str, body: Draft, conn: Db) -> tuple[str, str]:
    saved = email_design.template(conn, key)
    subject = body.subject if body.subject is not None else saved["subject"]
    text = body.body if body.body is not None else saved["body"]
    found = email_design.problems(key, subject, text)
    if found:
        raise ProblemError(422, "bad-template", "Fix the email first", " ".join(found), problems=found)
    return subject, text


@router.post("/templates/{key}/preview", summary="The email filled in with sample details")
def preview_template(key: str, body: Draft, request: Request, conn: Db, _: OwnerPrincipal) -> dict[str, Any]:
    _known(key)
    subject, text = _draft(key, body, conn)
    settings: Settings = request.app.state.settings
    light = email_design.render(
        conn, settings, key, email_design.SAMPLE, subject=subject, body=text, for_preview=True
    )
    dark = email_design.render(
        conn, settings, key, email_design.SAMPLE, subject=subject, body=text, for_preview=True, dark=True
    )
    return {"subject": light.subject, "text": light.text, "html": light.html, "html_dark": dark.html}


@router.post("/templates/{key}/test", summary="Send yourself the email, with sample details")
def test_template(
    key: str, body: Draft, request: Request, conn: Db, person: OwnerPrincipal
) -> dict[str, Any]:
    _known(key)
    subject, text = _draft(key, body, conn)
    settings: Settings = request.app.state.settings
    rendered = email_design.render(conn, settings, key, email_design.SAMPLE, subject=subject, body=text)
    brand = email_design.branding(conn)
    mail.send(
        conn, settings, person.email, rendered.subject, rendered.text, rendered.html,
        reply_to=brand["reply_to"] or None, from_name=brand["sender_name"] or None,
    )  # fmt: skip
    return {"sent": True, "to": person.email}


# ---------------------------------------------------------------------------
# Sending ephemeralREST's emails from this site


def _ephemeral_side(request: Request, conn: Db) -> tuple[dict[str, Any] | None, str | None]:
    """ephemeralREST's answer for the site key ({allowed, mode}), or why it can't be asked."""
    settings: Settings = request.app.state.settings
    if signup.site_key(conn, settings) is None:
        return None, "Save a site key first (Settings → ephemeralREST)."
    if not signup.features(request, conn).get("registration", {}).get("email_delivery"):
        return None, "This site's ephemeralREST doesn't offer email delivery yet: it needs updating."
    try:
        with signup.client(request, conn) as eph:
            return eph.get("/keys/self/email-delivery"), None
    except ProblemError as problem:
        return None, f"ephemeralREST: {problem.title}."


def _delivery_state(request: Request, conn: Db) -> dict[str, Any]:
    missing: list[str] = []
    if not mail.configured(conn):
        missing.append("Set up email (SMTP) above.")
    elif not mail.tested(conn):
        missing.append("Send a test message, so we know email works.")
    side, why = _ephemeral_side(request, conn)
    if why:
        missing.append(why)
    elif side is not None and not side.get("allowed"):
        domain = (signup.stored_site(conn) or {}).get("domain") or "your site key"
        missing.append(f"Ask whoever runs your ephemeralREST to allow email delivery for {domain}.")
    return {
        "on": bool(side and side.get("mode") == "self"),
        "ready": not missing,
        "missing": missing,
        "last_failure": delivery.last_failure(conn),
    }


@router.get("/delivery", summary="Whether ephemeralREST's emails are sent from this site")
def get_delivery(request: Request, conn: Db, _: OwnerPrincipal) -> dict[str, Any]:
    return _delivery_state(request, conn)


class DeliveryChange(Strict):
    on: bool


@router.put("/delivery", summary="Send ephemeralREST's emails from this site, or let ephemeralREST send them")
def put_delivery(body: DeliveryChange, request: Request, conn: Db, _: OwnerPrincipal) -> dict[str, Any]:
    """On: sign-up links, login codes, password resets and key notices for accounts made through
    this site come here to send, with your designs. Off: ephemeralREST sends its own."""
    state = _delivery_state(request, conn)
    if body.on and not state["ready"]:
        raise ProblemError(409, "delivery-not-ready", "Not ready yet", " ".join(state["missing"]))
    mode: Literal["self", "ephemeral"] = "self" if body.on else "ephemeral"
    with signup.client(request, conn) as eph:
        eph.put("/keys/self/email-delivery", {"mode": mode})
    return _delivery_state(request, conn)
