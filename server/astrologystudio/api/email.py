"""
AstrologyStudio ·
server/astrologystudio/api/email.py

/api/v1/email:

the install's SMTP settings (owner only), and a test message. Everything that sends email
sends it through these settings (see mail.py).

Copyright (c) 2026 Gavin Melhuish
MIT License; see LICENSE in the project root.
SPDX-License-Identifier: MIT
"""

from __future__ import annotations

import re
from typing import Annotated, Any

from fastapi import APIRouter, Request, Response
from pydantic import Field, field_validator

from .. import email_design, mail
from ..db import transaction
from ..deps import Db, OwnerPrincipal
from ..errors import ProblemError
from ..schemas import Strict

router = APIRouter(prefix="/email", tags=["Email"])

ADDRESS = re.compile(r"^[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+$")


def _address(value: str, *, blank: bool = False) -> str:
    value = value.strip()
    if blank and not value:
        return ""
    if not ADDRESS.match(value):
        raise ValueError("Enter an email address, like name@example.com")
    return value


class EmailSettings(Strict):
    host: Annotated[str, Field(min_length=1, max_length=253)]
    port: Annotated[int, Field(ge=1, le=65535)] = 587
    security: mail.Security = "starttls"
    """starttls (usually port 587), ssl (SSL/TLS from the start, usually 465), or none."""
    username: Annotated[str, Field(max_length=320)] = ""
    password: Annotated[str, Field(max_length=500)] | None = None
    """Leave out to keep the saved password; "" removes it."""
    from_address: Annotated[str, Field(max_length=320)]
    from_name: Annotated[str, Field(max_length=100)] = ""
    reply_to: Annotated[str, Field(max_length=320)] = ""

    @field_validator("host")
    @classmethod
    def _host(cls, value: str) -> str:
        value = value.strip()
        if not re.match(r"^[A-Za-z0-9.-]+$", value):
            raise ValueError("Enter the server's name, like smtp.example.com (no https:// or port)")
        return value

    @field_validator("from_address")
    @classmethod
    def _from(cls, value: str) -> str:
        return _address(value)

    @field_validator("reply_to")
    @classmethod
    def _reply(cls, value: str) -> str:
        return _address(value, blank=True)


class TestMessage(Strict):
    to: Annotated[str, Field(max_length=320)] = ""
    """Where to send it; your own address if left out."""


@router.get("", summary="The SMTP settings (never the password)")
def get_email(conn: Db, _: OwnerPrincipal) -> dict[str, Any]:
    return mail.public(conn)


@router.put("", summary="Save the SMTP settings")
def put_email(body: EmailSettings, request: Request, conn: Db, _: OwnerPrincipal) -> dict[str, Any]:
    values = body.model_dump(exclude={"password"})
    with transaction(conn):
        mail.save(conn, request.app.state.settings, values, body.password)
    return mail.public(conn)


@router.delete("", summary="Remove the SMTP settings", status_code=204)
def delete_email(conn: Db, _: OwnerPrincipal) -> Response:
    with transaction(conn):
        mail.forget(conn)
    return Response(status_code=204)


@router.post("/test", summary="Send a test message")
def test_email(body: TestMessage, request: Request, conn: Db, person: OwnerPrincipal) -> dict[str, Any]:
    to = body.to.strip()
    if to:
        try:
            to = _address(to)
        except ValueError as error:
            raise ProblemError(422, "bad-address", str(error), None) from None
    else:
        row = conn.execute("SELECT email FROM users WHERE id = ?", (person.id,)).fetchone()
        to = row["email"] if row else ""
    if not to:
        raise ProblemError(422, "bad-address", "Enter an address to send the test to", None)
    settings = request.app.state.settings
    brand = email_design.branding(conn)
    logo = email_design.logo_url(settings) if email_design.logo_data_url(conn) else None
    rendered = email_design.render_parts(
        "{site}: test message",
        "This is a test message from {site}.\n\nIf you can read it, email is set up: anything the app sends"
        " will come from this server and address, with your email design.",
        {"site": brand["sender_name"] or "AstrologyStudio"},
        brand,
        logo,
        settings.base_url,
    )
    mail.send(
        conn,
        settings,
        to,
        rendered.subject,
        rendered.text,
        rendered.html,
        reply_to=brand["reply_to"] or None,
        from_name=brand["sender_name"] or None,
    )
    with transaction(conn):
        mail.mark_tested(conn)
    return {"sent": True, "to": to}
