"""
AstrologyStudio ·
server/astrologystudio/email_design.py

The owner's email designs: one branded layout (logo, accent colour, footer) and a template per
kind of email, each a subject and a body in a small markup:

    Paragraphs, separated by a blank line.   **bold**   *italic*   [link text](https://…)
    [[Button text|{link}]]   (a button, on a line of its own)

and {placeholders}, filled in when the email is sent. Values are escaped, and markup in a value
does nothing, so a name like "<b>Ann</b>" or "[[x|https://evil]]" is just text. Every email is
sent as HTML (table-based, inline CSS, 600 px wide) with a plain-text version alongside.

No row in email_templates means the built-in default, so upgrades can improve the defaults.

Copyright (c) 2026 Gavin Melhuish
MIT License; see LICENSE in the project root.
SPDX-License-Identifier: MIT
"""

from __future__ import annotations

import html
import json
import re
import sqlite3
from dataclasses import dataclass
from typing import Any

from . import mail
from .config import Settings
from .db import now

BRANDING_SETTING = "email_branding"
DEFAULT_ACCENT = "#4f46e5"
SUBJECT_MAX = 150
BODY_MAX = 5000


@dataclass(frozen=True, slots=True)
class Template:
    key: str
    label: str
    placeholders: tuple[str, ...]
    required: tuple[str, ...]
    subject: str
    body: str
    optional: bool = False
    """Off unless the owner switches it on."""


TEMPLATES: dict[str, Template] = {
    t.key: t
    for t in (
        Template(
            "verify",
            "Confirm your email",
            ("name", "link", "expires", "site"),
            ("link",),
            "Confirm your email for {site}",
            "Hello {name},\n\nThanks for signing up to {site}. Confirm your email address and choose your"
            " password:\n\n[[Confirm my email|{link}]]\n\nThe link works once, until {expires}. If you didn't"
            " sign up, ignore this email.",
        ),
        Template(
            "login_code",
            "Your login code",
            ("name", "code", "expires", "site"),
            ("code",),
            "Your {site} login code: {code}",
            "Hello {name},\n\nYour code to log in to {site} is:\n\n**{code}**\n\nIt works until {expires}."
            " If you didn't try to log in, change your password.",
        ),
        Template(
            "password_reset",
            "Reset your password",
            ("name", "link", "expires", "site"),
            ("link",),
            "Set a new password for {site}",
            "Hello {name},\n\nSomeone (probably you) asked to reset your password for {site}. To choose a new"
            " one:\n\n[[Choose a new password|{link}]]\n\nThe link works once, until {expires}. If this"
            " wasn't you, ignore this email: your password stays as it is.",
        ),
        Template(
            "password_elsewhere",
            "Password kept elsewhere",
            ("name", "site"),
            (),
            "Your {site} password",
            "Hello {name},\n\nSomeone (probably you) asked to reset your password for {site}. Your account"
            " signs in through ephemeralREST, so its password is changed there, not here.\n\nIf this wasn't"
            " you, ignore this email.",
        ),
        Template(
            "welcome",
            "Welcome: your account is ready",
            ("name", "site", "login_link"),
            (),
            "Welcome to {site}",
            "Hello {name},\n\nYour account is ready.\n\n[[Open {site}|{login_link}]]",
        ),
        Template(
            "key_replaced",
            "Your key was replaced",
            ("name", "date", "site", "account_link"),
            (),
            "Your {site} access key was replaced",
            "Hello {name},\n\nYour access key was replaced on {date}. The old one no longer works anywhere it"
            " was used; give the new one to any other sites or apps that need it. You'll find it under"
            " [Your account]({account_link}).\n\nIf you didn't do this, change your password now.",
        ),
        Template(
            "password_changed",
            "Your password was changed",
            ("name", "date", "site"),
            (),
            "Your {site} password was changed",
            "Hello {name},\n\nThe password for your {site} account was changed on {date}, and you were logged"
            " out everywhere else.\n\nIf you didn't do this, contact the site's owner straight away.",
        ),
        Template(
            "account_status",
            "Your account was switched off or on",
            ("name", "site", "status"),
            (),
            "Your {site} account was {status}",
            "Hello {name},\n\nYour account on {site} was {status} by the site's owner.",
            optional=True,
        ),
    )
}

SAMPLE = {
    "name": "Ann Example",
    "link": "https://example.com/auth/verify?t=sample-token",
    "expires": "26 Nov 2026, 10:30",
    "site": "AstrologyStudio",
    "code": "123456",
    "login_link": "https://example.com/",
    "account_link": "https://example.com/account",
    "date": "26 Nov 2026",
    "status": "switched off",
}

_PLACEHOLDER = re.compile(r"\{([a-z_]+)\}")


# ---------------------------------------------------------------------------
# Branding and stored templates


def _setting(conn: sqlite3.Connection, key: str) -> Any:
    row = conn.execute("SELECT value FROM settings WHERE key = ?", (key,)).fetchone()
    return json.loads(row["value"]) if row else None


def branding(conn: sqlite3.Connection) -> dict[str, Any]:
    stored = _setting(conn, BRANDING_SETTING)
    stored = stored if isinstance(stored, dict) else {}
    accent = stored.get("accent")
    return {
        "use_site_logo": stored.get("use_site_logo", True) is not False,
        "logo": stored.get("logo") if isinstance(stored.get("logo"), str) else None,
        "accent": accent
        if isinstance(accent, str) and re.fullmatch(r"#[0-9a-fA-F]{6}", accent)
        else DEFAULT_ACCENT,
        "sender_name": str(stored.get("sender_name") or ""),
        "reply_to": str(stored.get("reply_to") or ""),
        "footer": str(stored.get("footer") or ""),
    }


def save_branding(conn: sqlite3.Connection, values: dict[str, Any]) -> None:
    conn.execute(
        "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)"
        " ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
        (BRANDING_SETTING, json.dumps({**branding(conn), **values}), now()),
    )


def logo_data_url(conn: sqlite3.Connection) -> str | None:
    """The logo emails use: their own, or the site's (raster only: many mail programs can't
    show SVG, and an SVG is never served from this site)."""
    from .api import branding as site_branding

    brand = branding(conn)
    found = brand["logo"] if brand["logo"] else (site_branding.logo(conn) if brand["use_site_logo"] else None)
    if isinstance(found, str) and re.match(r"data:image/(png|jpeg|webp);base64,", found):
        return found
    return None


def template(conn: sqlite3.Connection, key: str) -> dict[str, Any]:
    base = TEMPLATES[key]
    row = conn.execute("SELECT * FROM email_templates WHERE key = ?", (key,)).fetchone()
    return {
        "key": key,
        "label": base.label,
        "placeholders": list(base.placeholders),
        "required": list(base.required),
        "optional": base.optional,
        "subject": row["subject"] if row else base.subject,
        "body": row["body"] if row else base.body,
        "enabled": bool(row["enabled"]) if row else not base.optional,
        "customised": row is not None,
        "updated_at": row["updated_at"] if row else None,
        "default_subject": base.subject,
        "default_body": base.body,
    }


def problems(key: str, subject: str, body: str) -> list[str]:
    """What's wrong with a template, in words (empty: it's fine)."""
    base = TEMPLATES[key]
    found: list[str] = []
    if not subject.strip():
        found.append("The subject can't be empty.")
    if len(subject) > SUBJECT_MAX:
        found.append(f"The subject can be at most {SUBJECT_MAX} characters.")
    if "\n" in subject:
        found.append("The subject must be one line.")
    if not body.strip():
        found.append("The body can't be empty.")
    if len(body) > BODY_MAX:
        found.append(f"The body can be at most {BODY_MAX:,} characters.")
    used = set(_PLACEHOLDER.findall(subject + "\n" + body))
    unknown = sorted(used - set(base.placeholders))
    if unknown:
        valid = ", ".join("{" + p + "}" for p in base.placeholders)
        found.append(f"Unknown: {', '.join('{' + u + '}' for u in unknown)}. This email can use {valid}.")
    missing = [p for p in base.required if p not in used]
    if missing:
        found.append(f"It must include {', '.join('{' + p + '}' for p in missing)}.")
    if re.search(r"<[a-zA-Z/!]", body):
        found.append(
            "HTML isn't allowed in the body: use **bold**, *italic*, [text](link) and [[Button|link]]."
        )
    return found


def save_template(conn: sqlite3.Connection, key: str, subject: str, body: str, enabled: bool) -> None:
    conn.execute(
        "INSERT INTO email_templates (key, subject, body, enabled, updated_at) VALUES (?, ?, ?, ?, ?)"
        " ON CONFLICT (key) DO UPDATE SET subject = excluded.subject, body = excluded.body,"
        " enabled = excluded.enabled, updated_at = excluded.updated_at",
        (key, subject, body, int(enabled), now()),
    )


# ---------------------------------------------------------------------------
# Rendering


def _marked(text: str, values: dict[str, str]) -> tuple[str, list[str]]:
    """Placeholders swapped for markers that markup can't touch; the values, in order."""
    found: list[str] = []

    def swap(match: re.Match[str]) -> str:
        found.append(values.get(match.group(1), ""))
        return f"{len(found) - 1}"

    return _PLACEHOLDER.sub(swap, text), found


def _unmark(text: str, found: list[str], escape: bool) -> str:
    return re.sub(
        r"(\d+)",
        lambda m: html.escape(found[int(m.group(1))]) if escape else found[int(m.group(1))],
        text,
    )


def _safe_url(url: str) -> str | None:
    url = url.strip()
    return url if re.match(r"https?://", url) or url.startswith("mailto:") else None


def _inline_html(text: str, found: list[str], accent: str) -> str:
    """One paragraph's text: escaped, then **bold**, *italic* and [text](url)."""
    out = html.escape(text, quote=False)

    def link(m: re.Match[str]) -> str:
        url = _safe_url(_unmark(html.unescape(m.group(2)), found, False))
        label = m.group(1)
        if url is None:
            return label
        return f'<a href="{html.escape(url)}" style="color:{accent};text-decoration:underline">{label}</a>'

    out = re.sub(r"\[([^\]\n]+)\]\(([^)\s]+)\)", link, out)
    out = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", out)
    out = re.sub(r"(?<![*\w])\*(?!\s)(.+?)(?<!\s)\*(?![*\w])", r"<em>\1</em>", out)
    return _unmark(out, found, True)


def _inline_text(text: str, found: list[str]) -> str:
    out = re.sub(r"\[([^\]\n]+)\]\(([^)\s]+)\)", lambda m: f"{m.group(1)} ({m.group(2)})", text)
    out = re.sub(r"\*\*(.+?)\*\*", r"\1", out)
    out = re.sub(r"(?<![*\w])\*(?!\s)(.+?)(?<!\s)\*(?![*\w])", r"\1", out)
    return _unmark(out, found, False)


_BUTTON = re.compile(r"^\[\[([^|\]]+)\|([^\]]+)\]\]$")


@dataclass(frozen=True, slots=True)
class Rendered:
    subject: str
    text: str
    html: str


def _palette(dark: bool) -> dict[str, str]:
    if dark:
        return {"page": "#111318", "card": "#1c1f26", "ink": "#e8e9ee", "muted": "#9aa0ad", "line": "#2c303a"}
    return {"page": "#f4f4f7", "card": "#ffffff", "ink": "#1f2330", "muted": "#6b7080", "line": "#e5e6eb"}


def render_parts(
    subject: str,
    body: str,
    values: dict[str, str],
    brand: dict[str, Any],
    logo: str | None,
    site_url: str,
    dark: bool = False,
) -> Rendered:
    accent = brand["accent"]
    colours = _palette(dark)
    marked, found = _marked(body.replace("\r\n", "\n"), values)
    blocks = [b.strip() for b in re.split(r"\n\s*\n", marked) if b.strip()]
    html_blocks: list[str] = []
    text_blocks: list[str] = []
    for block in blocks:
        button = _BUTTON.match(block)
        if button:
            label_html = _inline_html(button.group(1), found, accent)
            url = _safe_url(_unmark(button.group(2), found, False))
            label_text = _inline_text(button.group(1), found)
            if url is None:
                html_blocks.append(f'<p style="margin:0 0 16px">{label_html}</p>')
                text_blocks.append(label_text)
                continue
            html_blocks.append(
                '<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 20px"><tr>'
                f'<td style="border-radius:8px;background:{accent}">'
                f'<a href="{html.escape(url)}" style="display:inline-block;padding:12px 22px;color:#ffffff;'
                f'font-weight:600;text-decoration:none;border-radius:8px">{label_html}</a></td></tr></table>'
            )
            text_blocks.append(f"{label_text}: {url}")
            continue
        lines = block.split("\n")
        joined = "<br>".join(_inline_html(line, found, accent) for line in lines)
        html_blocks.append(f'<p style="margin:0 0 16px">{joined}</p>')
        text_blocks.append("\n".join(_inline_text(line, found) for line in lines))

    subject_marked, subject_found = _marked(subject, values)
    filled_subject = " ".join(_unmark(subject_marked, subject_found, False).split())
    name = brand.get("sender_name") or values.get("site") or "AstrologyStudio"
    header = (
        f'<img src="{html.escape(logo)}" alt="{html.escape(name)}"'
        ' style="max-height:48px;max-width:240px;border:0">'
        if logo
        else f'<span style="font-size:18px;font-weight:700;color:{colours["ink"]}">{html.escape(name)}</span>'
    )
    footer_text = brand.get("footer") or ""
    footer_lines = [line for line in footer_text.split("\n") if line.strip()]
    footer_html = "<br>".join(_inline_html(line, [], accent) for line in footer_lines)
    footer_html += ("<br>" if footer_html else "") + (
        f'<a href="{html.escape(site_url)}" style="color:{colours["muted"]}">{html.escape(site_url)}</a>'
    )
    document = f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<meta name="color-scheme" content="{"dark" if dark else "light"}"><title>{html.escape(filled_subject)}</title></head>
<body style="margin:0;padding:0;background:{colours["page"]}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:{colours["page"]}">
<tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:{colours["card"]};border:1px solid {colours["line"]};border-radius:12px">
<tr><td style="padding:24px 28px 8px;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">{header}</td></tr>
<tr><td style="padding:12px 28px 8px;font:16px/1.55 -apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:{colours["ink"]}">
{"".join(html_blocks)}
</td></tr>
<tr><td style="padding:16px 28px 24px;border-top:1px solid {colours["line"]};font:13px/1.5 -apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:{colours["muted"]}">{footer_html}</td></tr>
</table></td></tr></table></body></html>"""  # noqa: E501
    text = "\n\n".join(text_blocks)
    footer_plain = "\n".join(_inline_text(line, []) for line in footer_lines)
    text += "\n\n--\n" + (footer_plain + "\n" if footer_plain else "") + site_url + "\n"
    return Rendered(filled_subject, text, document)


def logo_url(settings: Settings) -> str:
    return f"{settings.base_url}/api/v1/email/logo"


def render(
    conn: sqlite3.Connection,
    settings: Settings,
    key: str,
    values: dict[str, str],
    *,
    dark: bool = False,
    subject: str | None = None,
    body: str | None = None,
    for_preview: bool = False,
) -> Rendered:
    """`key`'s email with these values. A preview shows the logo inline; a sent email links to it,
    because most mail programs won't show an image written into the email."""
    found = template(conn, key)
    brand = branding(conn)
    logo = logo_data_url(conn)
    shown_logo = (logo if for_preview else logo_url(settings)) if logo else None
    filled = {"site": brand["sender_name"] or "AstrologyStudio", **values}
    return render_parts(
        subject if subject is not None else found["subject"],
        body if body is not None else found["body"],
        filled,
        brand,
        shown_logo,
        settings.base_url,
        dark,
    )


def send(conn: sqlite3.Connection, settings: Settings, key: str, to: str, values: dict[str, str]) -> bool:
    """Send `key`'s email to `to`. False (and nothing sent) when it's an optional email that's
    switched off. Raises ProblemError when it can't be sent."""
    if not template(conn, key)["enabled"]:
        return False
    rendered = render(conn, settings, key, values)
    brand = branding(conn)
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
    return True
