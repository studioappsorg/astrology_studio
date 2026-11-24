"""
AstrologyStudio ·
server/astrologystudio/mail.py

Sending email:

through the install's own SMTP server, set by the owner in Settings → Email. Everything in the
app that sends email goes through send(), so it all comes from the same server and address.

Copyright (c) 2026 Gavin Melhuish
MIT License; see LICENSE in the project root.
SPDX-License-Identifier: MIT
"""

from __future__ import annotations

import json
import smtplib
import sqlite3
import ssl
from email.message import EmailMessage
from email.utils import formataddr, make_msgid
from typing import Any, Literal

from . import secretbox
from .config import Settings
from .db import now
from .errors import ProblemError

SETTING_KEY = "smtp"
TIMEOUT = 20.0
Security = Literal["starttls", "ssl", "none"]
SECURITY: tuple[Security, ...] = ("starttls", "ssl", "none")

# The classes that talk to the server (tests put stand-ins here).
SMTP: Any = smtplib.SMTP
SMTP_SSL: Any = smtplib.SMTP_SSL


def stored(conn: sqlite3.Connection) -> dict[str, Any] | None:
    row = conn.execute("SELECT value FROM settings WHERE key = ?", (SETTING_KEY,)).fetchone()
    if row is None:
        return None
    value = json.loads(row["value"])
    return value if isinstance(value, dict) and value.get("host") else None


def public(conn: sqlite3.Connection) -> dict[str, Any]:
    """The settings as the owner sees them: never the password, only whether there is one."""
    found = stored(conn)
    if found is None:
        return {"configured": False}
    return {
        "configured": True,
        "host": found["host"],
        "port": found["port"],
        "security": found["security"],
        "username": found.get("username", ""),
        "has_password": bool(found.get("password")),
        "from_address": found["from_address"],
        "from_name": found.get("from_name", ""),
        "reply_to": found.get("reply_to", ""),
        "updated_at": found.get("updated_at"),
    }


def save(conn: sqlite3.Connection, settings: Settings, values: dict[str, Any], password: str | None) -> None:
    """Store the settings. `password` None keeps the one already saved; "" removes it."""
    current = stored(conn) or {}
    kept = current.get("password", "")
    if password is not None:
        kept = secretbox.encrypt(settings, password) if password else ""
    value = {**values, "password": kept, "updated_at": now()}
    conn.execute(
        "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)"
        " ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
        (SETTING_KEY, json.dumps(value), now()),
    )


def forget(conn: sqlite3.Connection) -> None:
    conn.execute("DELETE FROM settings WHERE key = ?", (SETTING_KEY,))


def configured(conn: sqlite3.Connection) -> bool:
    return stored(conn) is not None


def send(
    conn: sqlite3.Connection,
    settings: Settings,
    to: str | list[str],
    subject: str,
    text: str,
    html: str | None = None,
    reply_to: str | None = None,
    attachments: list[tuple[str, bytes, str]] | None = None,
) -> None:
    """Send one email through the install's SMTP server. `attachments` are (file name, content,
    MIME type). Raises ProblemError with a plain explanation when it can't be sent."""
    config = stored(conn)
    if config is None:
        raise ProblemError(
            409,
            "email-not-set-up",
            "Email isn't set up",
            "The owner can set up email under Settings → Email.",
        )
    password = ""
    if config.get("password"):
        password = secretbox.decrypt(settings, config["password"]) or ""
        if not password:
            raise ProblemError(
                409,
                "email-password-unreadable",
                "The email password needs entering again",
                "The install's secret key has changed since it was saved. Enter it again in"
                " Settings → Email.",
            )
    message = EmailMessage()
    message["From"] = formataddr((config.get("from_name") or "", config["from_address"]))
    message["To"] = ", ".join([to] if isinstance(to, str) else to)
    message["Subject"] = subject
    message["Message-ID"] = make_msgid(domain=config["from_address"].rpartition("@")[2] or None)
    if reply_to or config.get("reply_to"):
        message["Reply-To"] = reply_to or config["reply_to"]
    message.set_content(text)
    if html:
        message.add_alternative(html, subtype="html")
    for name, content, mime in attachments or []:
        main, _, sub = mime.partition("/")
        message.add_attachment(content, maintype=main, subtype=sub or "octet-stream", filename=name)
    _deliver(config, password, message)


def _deliver(config: dict[str, Any], password: str, message: EmailMessage) -> None:
    host, port, security = config["host"], int(config["port"]), config["security"]
    context = ssl.create_default_context()
    try:
        if security == "ssl":
            server = SMTP_SSL(host, port, timeout=TIMEOUT, context=context)
        else:
            server = SMTP(host, port, timeout=TIMEOUT)
        with server:
            server.ehlo()
            if security == "starttls":
                server.starttls(context=context)
                server.ehlo()
            if config.get("username"):
                server.login(config["username"], password)
            server.send_message(message)
    except smtplib.SMTPAuthenticationError as error:
        raise _problem("The email server didn't accept the username or password", error) from None
    except smtplib.SMTPNotSupportedError as error:
        raise _problem(
            "The email server doesn't offer that security",
            error,
            "Try SSL/TLS on port 465, or STARTTLS on 587.",
        ) from None
    except smtplib.SMTPRecipientsRefused as error:
        raise _problem("The email server refused the address it was sent to", error) from None
    except smtplib.SMTPSenderRefused as error:
        raise _problem(
            "The email server won't send from that address",
            error,
            "Use an address the server allows you to send from.",
        ) from None
    except smtplib.SMTPException as error:
        raise _problem("The email server turned the message down", error) from None
    except ssl.SSLError as error:
        raise _problem(
            "A secure connection to the email server failed",
            error,
            "Check the security setting: SSL/TLS is usually port 465, STARTTLS port 587.",
        ) from None
    except TimeoutError as error:
        raise _problem(
            "The email server didn't answer in time", error, "Check the address and port."
        ) from None
    except OSError as error:
        raise _problem("Couldn't reach the email server", error, CHECK) from None


CHECK = "Check the address and port."
TRY_PORTS = "Try SSL/TLS on port 465, or STARTTLS on 587."
ALLOWED_FROM = "Use an address the server allows you to send from."


def _problem(title: str, error: BaseException, hint: str = "") -> ProblemError:
    detail = str(error).strip() or type(error).__name__
    return ProblemError(502, "email-failed", title, f"{hint} ({detail})".strip() if hint else detail)
