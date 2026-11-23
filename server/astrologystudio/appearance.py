"""
AstrologyStudio ·
server/astrologystudio/appearance.py

How charts and dials look:

themes, display options and layouts.

A theme colours the canvas, charts and dials (never the app window itself, which the light/dark
toggle sets). Each theme has a light and a dark version; the toggle picks which one is used.
Built-in themes are defined here; people make their own by copying one, and the owner can
publish themes for everyone (site themes).

A layout says what a chart type draws: rings, scales, labels and so on. Each chart type
(chart wheel, Hellenistic chart, dial) has built-in layouts and each person's own.

A preset is a named set of views (1.12): for each, chart type (and dial size), layout, report tab
and what chart 2 is; with an optional theme and calculation profile for the whole preset. It
refers to the layout, theme and profile by id rather than copying them, so improving one improves
every preset that uses it; if one has gone, the app falls back to the default when the preset is
used, and says so.

Everything stored is cleaned when read: unknown keys are dropped and anything missing comes
from the defaults, so a theme or layout made in an older version keeps working.

Copyright (c) 2026 Gavin Melhuish
MIT License; see LICENSE in the project root.
SPDX-License-Identifier: MIT
"""

from __future__ import annotations

import json
import re
import sqlite3
from typing import Any, Final

from . import preferences as prefs
from .astro.aspects import ASPECTS
from .db import now

VERSION: Final = 1
COLOUR = re.compile(r"^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$")
NAME_MAX = 60
MAX_OWN_THEMES = 30
MAX_OWN_LAYOUTS = 40
MAX_PRESETS = 30
MAX_SITE_THEMES = 30
MAX_IMPORT_BYTES = 32_000

SIGN_NAMES: Final = (
    "aries", "taurus", "gemini", "cancer", "leo", "virgo",
    "libra", "scorpio", "sagittarius", "capricorn", "aquarius", "pisces",
)  # fmt: skip
ELEMENTS: Final = ("fire", "earth", "air", "water")
MODALITIES: Final = ("cardinal", "fixed", "mutable")
COLOURED_BODIES: Final = (
    "sun", "moon", "mercury", "venus", "mars", "jupiter", "saturn", "uranus", "neptune", "pluto",
)  # fmt: skip
ASPECT_KEYS: Final = tuple(a.key for a in ASPECTS)

# (token, group, label). The order is the editor's order.
TOKENS: Final[tuple[tuple[str, str, str], ...]] = (
    ("canvas", "canvas", "Canvas background"),
    ("canvas-text", "canvas", "Canvas text"),
    ("chart-bg", "chart", "Active chart background"),
    ("line", "chart", "Lines"),
    ("faint", "chart", "Faint lines"),
    ("scale", "chart", "Degree scale"),
    ("text", "chart", "Text"),
    ("muted", "chart", "Quiet text"),
    ("house-number", "chart", "House numbers"),
    ("angle", "chart", "Angle badges (AC, MC)"),
    ("angle-text", "chart", "Angle badge text"),
    *((e, "signs", e.capitalize()) for e in ELEMENTS),
    *((m, "signs", m.capitalize()) for m in MODALITIES),
    *((s, "signs", s.capitalize()) for s in SIGN_NAMES),
    ("sign-text", "signs", "Sign symbols"),
    ("body", "bodies", "All bodies"),
    *((f"ink-{e}", "bodies", f"In {e} signs") for e in ELEMENTS),
    ("sect-day", "bodies", "Day sect"),
    ("sect-night", "bodies", "Night sect"),
    *((f"body-{b}", "bodies", b.capitalize()) for b in COLOURED_BODIES),
    ("body-other", "bodies", "Other points"),
    *((f"aspect-{a.key}", "aspects", a.name) for a in ASPECTS),
    ("dial-bg", "dial", "Dial background"),
    ("pointer", "dial", "Pointer"),
    ("pointer-axis", "dial", "Pointer axis lines"),
    ("tree-line", "dial", "Midpoint tree lines"),
    ("tree-text", "dial", "Midpoint tree text"),
    ("focus", "highlights", "Focused body"),
    ("mark-primary", "highlights", "Marked sign"),
    ("mark-secondary", "highlights", "Second marked sign"),
    ("peak", "highlights", "Peaks and angular labels"),
    ("chart-2", "multi", "Chart 2"),
    ("chart-3", "multi", "Chart 3"),
)
TOKEN_KEYS: Final = frozenset(t for t, _, _ in TOKENS)
GROUPS: Final = (
    ("canvas", "Canvas"),
    ("chart", "Chart"),
    ("signs", "Signs"),
    ("bodies", "Bodies"),
    ("aspects", "Aspects"),
    ("dial", "Dial"),
    ("highlights", "Highlights"),
    ("multi", "Multi-chart"),
)
SIGN_MODES: Final = ("element", "modality", "sign", "plain")
BODY_MODES: Final = ("single", "element", "sect", "body")
DASHES: Final = ("solid", "dashed", "dotted")


def _palette(base: dict[str, str], hard: str, soft: str, neutral: str) -> dict[str, str]:
    """A full set of tokens from the essentials: signs by sign and by modality follow the
    element colours, bodies follow the text, and each aspect follows its kind."""
    out = dict(base)
    for i, sign in enumerate(SIGN_NAMES):
        out.setdefault(sign, base[ELEMENTS[i % 4]])
    out.setdefault("cardinal", base["fire"])
    out.setdefault("fixed", base["earth"])
    out.setdefault("mutable", base["water"])
    out.setdefault("sign-text", base["text"])
    out.setdefault("body", base["text"])
    out.setdefault("house-number", base["muted"])
    out.setdefault("scale", base["line"])
    out.setdefault("dial-bg", base["chart-bg"])
    out.setdefault("tree-line", base["line"])
    out.setdefault("tree-text", base["text"])
    out.setdefault("angle-text", "#ffffff")
    for b in COLOURED_BODIES:
        out.setdefault(f"body-{b}", base["text"])
    out.setdefault("body-other", base["text"])
    for a in ASPECTS:
        out.setdefault(f"aspect-{a.key}", {"hard": hard, "soft": soft, "neutral": neutral}[a.kind])
    for key in ("focus", "mark-primary", "mark-secondary", "peak", "pointer"):
        out.setdefault(key, base["angle"])
    missing = TOKEN_KEYS - out.keys()
    assert not missing, missing
    return {k: out[k] for k in TOKEN_KEYS}


STUDIO_LIGHT = _palette(
    {
        "canvas": "#eef1f4", "canvas-text": "#26303d", "chart-bg": "#fbfbfc", "line": "#8a96a6",
        "faint": "#c9d0d9", "text": "#2a3442", "muted": "#6b7686", "angle": "#b4532f",
        "fire": "#f6e3dc", "earth": "#e9eee1", "air": "#f3efdc", "water": "#dfe8ef",
        "ink-fire": "#c0392b", "ink-earth": "#4f7a28", "ink-air": "#9a7a0c", "ink-water": "#2c6fb3",
        "sect-day": "#b8860b", "sect-night": "#2c6fb3", "pointer-axis": "#b8860b",
        "chart-2": "#b4532f", "chart-3": "#2f7d6d",
    },
    "#c0392b", "#2c6fb3", "#7d5ba6",
)  # fmt: skip
STUDIO_DARK = _palette(
    {
        "canvas": "#14181e", "canvas-text": "#e8edf6", "chart-bg": "#1a2028", "line": "#6f7c8d",
        "faint": "#39434f", "text": "#e3e8ef", "muted": "#9aa6b6", "angle": "#d36e47",
        "fire": "#3a2621", "earth": "#262f22", "air": "#343120", "water": "#1f2c38",
        "ink-fire": "#f07a6c", "ink-earth": "#9ccc7a", "ink-air": "#e8c860", "ink-water": "#6eaee8",
        "sect-day": "#ffd700", "sect-night": "#6eaee8", "pointer-axis": "#ffd700",
        "chart-2": "#e08a64", "chart-3": "#6cc2ae",
    },
    "#f07a6c", "#6eaee8", "#b39ae0",
)  # fmt: skip


def _studio_with(light: dict[str, str], dark: dict[str, str]) -> tuple[dict[str, str], dict[str, str]]:
    def derive(base: dict[str, str], changes: dict[str, str]) -> dict[str, str]:
        essentials = {k: v for k, v in base.items() if k in _ESSENTIAL}
        essentials.update({k: v for k, v in changes.items() if k in _ESSENTIAL})
        kinds = {kind: changes.get(kind, base[f"aspect-{key}"]) for kind, key in _KIND_SAMPLE.items()}
        full = _palette(essentials, kinds["hard"], kinds["soft"], kinds["neutral"])
        full.update({k: v for k, v in changes.items() if k in TOKEN_KEYS})
        return full

    return derive(STUDIO_LIGHT, light), derive(STUDIO_DARK, dark)


_ESSENTIAL: Final = frozenset(
    {"canvas", "canvas-text", "chart-bg", "line", "faint", "text", "muted", "angle", *ELEMENTS,
     *(f"ink-{e}" for e in ELEMENTS), "sect-day", "sect-night", "pointer-axis", "chart-2", "chart-3"}
)  # fmt: skip
_KIND_SAMPLE: Final = {"hard": "square", "soft": "trine", "neutral": "conjunction"}

CLASSIC = _studio_with(
    {"fire": "#f5c1ad", "earth": "#c8e2b6", "air": "#f6e7a4", "water": "#bcd6f1",
     "hard": "#d0261a", "soft": "#1565c0", "neutral": "#7b3fb5"},
    {"fire": "#5a2a1d", "earth": "#2c4422", "air": "#4d4519", "water": "#1d3a5a"},
)  # fmt: skip
MONO = _studio_with(
    {"canvas": "#ffffff", "chart-bg": "#ffffff", "fire": "#ffffff", "earth": "#ffffff", "air": "#ffffff",
     "water": "#ffffff", "angle": "#1d2530", "text": "#1d2530", "line": "#5b6676", "faint": "#c4cad3",
     "hard": "#1d2530", "soft": "#6b7686", "neutral": "#6b7686", "pointer-axis": "#1d2530",
     "chart-2": "#1d2530", "chart-3": "#6b7686", "sect-day": "#1d2530", "sect-night": "#6b7686",
     "ink-fire": "#1d2530", "ink-earth": "#1d2530", "ink-air": "#1d2530", "ink-water": "#1d2530"},
    {"canvas": "#111418", "chart-bg": "#111418", "fire": "#111418", "earth": "#111418", "air": "#111418",
     "water": "#111418", "angle": "#e8edf6", "angle-text": "#111418", "text": "#e8edf6",
     "line": "#9aa6b6", "faint": "#3a434e", "hard": "#e8edf6", "soft": "#9aa6b6", "neutral": "#9aa6b6",
     "pointer-axis": "#e8edf6", "chart-2": "#e8edf6", "chart-3": "#9aa6b6", "sect-day": "#e8edf6",
     "sect-night": "#9aa6b6", "ink-fire": "#e8edf6", "ink-earth": "#e8edf6", "ink-air": "#e8edf6",
     "ink-water": "#e8edf6"},
)  # fmt: skip
CONTRAST = _studio_with(
    {"canvas": "#ffffff", "canvas-text": "#000000", "chart-bg": "#ffffff", "line": "#000000",
     "faint": "#6b6b6b", "text": "#000000", "muted": "#333333", "angle": "#a32700",
     "fire": "#ffd6c9", "earth": "#d4efc4", "air": "#fff3b0", "water": "#cfe3ff",
     "hard": "#c00000", "soft": "#0040c0", "neutral": "#6a00a8", "pointer-axis": "#8a5a00",
     "ink-fire": "#b00000", "ink-earth": "#1f5e00", "ink-air": "#6e5600", "ink-water": "#0040c0",
     "sect-day": "#8a5a00", "sect-night": "#0040c0", "chart-2": "#a32700", "chart-3": "#00624f"},
    {"canvas": "#000000", "canvas-text": "#ffffff", "chart-bg": "#000000", "line": "#ffffff",
     "faint": "#9a9a9a", "text": "#ffffff", "muted": "#d6d6d6", "angle": "#ff9f43",
     "angle-text": "#000000", "fire": "#5c1a0b", "earth": "#1d4a12", "air": "#5a4a00",
     "water": "#0b2e66", "hard": "#ff6b6b", "soft": "#6bb6ff", "neutral": "#d29bff",
     "pointer-axis": "#ffd700", "ink-fire": "#ff8a7a", "ink-earth": "#9be37a", "ink-air": "#ffe066",
     "ink-water": "#7cc4ff", "sect-day": "#ffd700", "sect-night": "#7cc4ff", "chart-2": "#ff9f43",
     "chart-3": "#5ee0c0"},
)  # fmt: skip
PARCHMENT = _studio_with(
    {"canvas": "#efe6d2", "canvas-text": "#3b2f22", "chart-bg": "#f8f1e0", "line": "#8b7355",
     "faint": "#cdbd9c", "text": "#3b2f22", "muted": "#6e5b44", "angle": "#8b3a1e",
     "fire": "#f1d2bf", "earth": "#dfe3c4", "air": "#f2e5bd", "water": "#d6dfe0",
     "hard": "#9b2c1c", "soft": "#2f5d7c", "neutral": "#6b4c7a", "pointer-axis": "#a87412",
     "ink-fire": "#9b2c1c", "ink-earth": "#4d6424", "ink-air": "#8a6a12", "ink-water": "#2f5d7c",
     "sect-day": "#a87412", "sect-night": "#2f5d7c", "chart-2": "#8b3a1e", "chart-3": "#3d6b5c"},
    {"canvas": "#1e1912", "canvas-text": "#efe3cc", "chart-bg": "#2a2219", "line": "#9c8566",
     "faint": "#4a3e2f", "text": "#efe3cc", "muted": "#bfae90", "angle": "#d08a5c",
     "fire": "#4a2b1d", "earth": "#34361f", "air": "#4a3f1f", "water": "#26343a",
     "hard": "#e88b6e", "soft": "#8fb6d3", "neutral": "#c2a3d6", "pointer-axis": "#e6b450",
     "ink-fire": "#e88b6e", "ink-earth": "#b5c98a", "ink-air": "#e6c46a", "ink-water": "#8fb6d3",
     "sect-day": "#e6b450", "sect-night": "#8fb6d3", "chart-2": "#d08a5c", "chart-3": "#86c2ad"},
)  # fmt: skip


def _dashes() -> dict[str, str]:
    return {a.key: "solid" if a.major else "dashed" for a in ASPECTS}


def _builtin(theme_id: str, name: str, pair: tuple[dict[str, str], dict[str, str]]) -> dict[str, Any]:
    return {
        "id": theme_id,
        "name": name,
        "kind": "builtin",
        "base": theme_id,
        "version": VERSION,
        "signs": "plain" if theme_id == "mono" else "element",
        "bodies": "single",
        "dashes": _dashes(),
        "light": pair[0],
        "dark": pair[1],
    }


BUILTIN_THEMES: Final[tuple[dict[str, Any], ...]] = (
    _builtin("studio", "Studio", (STUDIO_LIGHT, STUDIO_DARK)),
    _builtin("classic", "Classic", CLASSIC),
    _builtin("mono", "Monochrome", MONO),
    _builtin("contrast", "High contrast", CONTRAST),
    _builtin("parchment", "Parchment", PARCHMENT),
)
BUILTIN_BY_ID: Final = {t["id"]: t for t in BUILTIN_THEMES}
DEFAULT_THEME: Final = "studio"


class Invalid(ValueError):
    """A theme or layout that can't be used; the message says why."""


def clean_theme(raw: Any, *, strict: bool = False) -> dict[str, Any]:
    """A theme with every token present. Missing colours come from its base built-in theme.
    With `strict`, a colour that isn't #rrggbb (or #rrggbbaa) is refused rather than replaced."""
    if not isinstance(raw, dict):
        raise Invalid("A theme must be a JSON object")
    base = BUILTIN_BY_ID.get(str(raw.get("base") or ""), BUILTIN_BY_ID[DEFAULT_THEME])
    name = str(raw.get("name") or "").strip()[:NAME_MAX] or "Untitled theme"
    theme: dict[str, Any] = {
        "id": str(raw.get("id") or ""),
        "name": name,
        "kind": raw.get("kind") if raw.get("kind") in ("own", "site") else "own",
        "base": base["id"],
        "version": VERSION,
        "signs": raw.get("signs") if raw.get("signs") in SIGN_MODES else base["signs"],
        "bodies": raw.get("bodies") if raw.get("bodies") in BODY_MODES else base["bodies"],
        "dashes": dict(base["dashes"]),
    }
    dashes = raw.get("dashes")
    if isinstance(dashes, dict):
        for key, value in dashes.items():
            if key in ASPECT_KEYS and value in DASHES:
                theme["dashes"][key] = value
    for mode in ("light", "dark"):
        colours = dict(base[mode])
        given = raw.get(mode)
        if isinstance(given, dict):
            for key, value in given.items():
                if key not in TOKEN_KEYS:
                    continue
                if isinstance(value, str) and COLOUR.match(value):
                    colours[key] = value.lower()
                elif strict:
                    raise Invalid(f"{mode} {key}: {value!r} is not a colour like #1a2b3c")
        theme[mode] = colours
    return theme


# ---------------------------------------------------------------------------
# Display options

APPEARANCE_CHOICES: Final[dict[str, tuple[Any, ...]]] = {
    "text_size": (100, 90, 115, 130),
    "glyph_size": ("medium", "small", "large"),
    "line_weight": ("normal", "fine", "bold"),
    "degrees": ("dm", "dms", "decimal"),
    "date_format": ("ymd", "dmy", "mdy"),
    "time_format": ("24", "12"),
    "retro": ("symbol", "letter"),
    "reduce_motion": (False, True),
    "export_bg": ("theme", "white", "transparent"),
}
"""Each option's choices; the first is the default."""


def default_appearance(theme: str = DEFAULT_THEME) -> dict[str, Any]:
    return {"theme": theme, **{k: v[0] for k, v in APPEARANCE_CHOICES.items()}}


# ---------------------------------------------------------------------------
# Layouts

WHEEL_OPTIONS: Final[dict[str, tuple[Any, ...]]] = {
    "sign_band": (True, False),
    "scale": ("1", "5", "none"),
    "houses": (True, False),
    "house_numbers": (True, False),
    "angles": ("badges", "lines"),
    "labels": ("deg", "degmin", "none"),
    "retro": (True, False),
    "aspects": ("all", "hard", "hover", "none"),
    "rings": ("compact", "roomy"),
    "glyphs": ("normal", "large"),
}
DIAL_OPTIONS: Final[dict[str, tuple[Any, ...]]] = {
    "scale": ("normal", "sparse", "dense"),
    "numbers": ("all", "quarters"),
    "orbit": ("single", "stacked"),
    "pointer": ("both", "line", "arrow"),
    "axis_lines": (True, False),
    "trees": ("tree", "list"),
    "glyphs": ("normal", "large"),
}
OPTIONS: Final = {"wheel": WHEEL_OPTIONS, "hellenistic": WHEEL_OPTIONS, "dial": DIAL_OPTIONS}
DISPLAYS: Final = tuple(OPTIONS)


def default_options(display: str) -> dict[str, Any]:
    options = {k: v[0] for k, v in OPTIONS[display].items()}
    if display == "hellenistic":
        options["aspects"] = "hover"  # aspects by sign would fill the centre
    return options


def _layout(display: str, key: str, name: str, **changes: Any) -> dict[str, Any]:
    return {
        "id": f"{display}:{key}",
        "name": name,
        "display": display,
        "kind": "builtin",
        "options": {**default_options(display), **changes},
    }


BUILTIN_LAYOUTS: Final[tuple[dict[str, Any], ...]] = (
    *(
        layout
        for display in ("wheel", "hellenistic")
        for layout in (
            _layout(display, "default", "Default layout"),
            _layout(display, "clean", "Clean", scale="none", labels="none", house_numbers=False),
            _layout(display, "teaching", "Teaching", glyphs="large", labels="degmin", rings="roomy"),
        )
    ),
    _layout("dial", "default", "Default layout"),
    _layout("dial", "minimal", "Minimal", scale="sparse", numbers="quarters", pointer="line"),
    _layout("dial", "clear", "Clear", glyphs="large", orbit="stacked", trees="list"),
)


def clean_layout(raw: Any) -> dict[str, Any]:
    if not isinstance(raw, dict) or raw.get("display") not in OPTIONS:
        raise Invalid("A layout needs a chart type: wheel, hellenistic or dial")
    display = raw["display"]
    options = default_options(display)
    given = raw.get("options")
    if isinstance(given, dict):
        for key, value in given.items():
            if key in options and value in OPTIONS[display][key]:
                options[key] = value
    return {
        "id": str(raw.get("id") or ""),
        "name": str(raw.get("name") or "").strip()[:NAME_MAX] or "Untitled layout",
        "display": display,
        "kind": "own",
        "options": options,
    }


# ---------------------------------------------------------------------------
# Custom dial sizes

MIN_DIAL = 5.625


def valid_modulus(value: float) -> bool:
    """A dial size divides the circle evenly: 360, 180, 120, 90, 72, 60, 45 … down to 5.625."""
    if value < MIN_DIAL or value > 360:
        return False
    parts = 360 / value
    return abs(parts - round(parts)) < 1e-9


# ---------------------------------------------------------------------------
# Storage

SITE_THEMES = "site_themes"
SITE_DEFAULT = "default_theme"


def _setting(conn: sqlite3.Connection, key: str) -> Any:
    row = conn.execute("SELECT value FROM settings WHERE key = ?", (key,)).fetchone()
    return json.loads(row["value"]) if row else None


def put_setting(conn: sqlite3.Connection, key: str, value: Any) -> None:
    conn.execute(
        "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)"
        " ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
        (key, json.dumps(value, separators=(",", ":")), now()),
    )


def site_themes(conn: sqlite3.Connection) -> list[dict[str, Any]]:
    stored = _setting(conn, SITE_THEMES)
    themes = []
    for raw in stored if isinstance(stored, list) else []:
        try:
            themes.append({**clean_theme(raw), "id": str(raw.get("id")), "kind": "site"})
        except Invalid:
            continue
    return themes


def own_themes(conn: sqlite3.Connection, user_id: str) -> list[dict[str, Any]]:
    stored = prefs.get(conn, user_id, "themes")
    themes = []
    for raw in stored if isinstance(stored, list) else []:
        try:
            theme = clean_theme(raw)
        except Invalid:
            continue
        if theme["id"]:
            themes.append({**theme, "kind": "own"})
    return themes


def all_themes(conn: sqlite3.Connection, user_id: str) -> list[dict[str, Any]]:
    return [*BUILTIN_THEMES, *site_themes(conn), *own_themes(conn, user_id)]


def site_default(conn: sqlite3.Connection) -> str:
    value = _setting(conn, SITE_DEFAULT)
    ids = {t["id"] for t in BUILTIN_THEMES} | {t["id"] for t in site_themes(conn)}
    return value if isinstance(value, str) and value in ids else DEFAULT_THEME


def chosen_appearance(conn: sqlite3.Connection, user_id: str) -> dict[str, Any]:
    """Only what this person has chosen. Anything left out follows the defaults, so a theme they
    never chose follows the site's default theme when the owner changes it."""
    stored = prefs.get(conn, user_id, "appearance")
    if isinstance(stored, dict):
        return dict(stored)
    # Before 1.3 the chart colours were a display choice, and Classic and Monochrome are now
    # built-in themes. Studio was the default then too, so it isn't treated as a choice.
    colours = (prefs.get(conn, user_id, "display") or {}).get("colours")
    return {"theme": colours} if colours in ("classic", "mono") else {}


def appearance(conn: sqlite3.Connection, user_id: str) -> dict[str, Any]:
    """This person's display options, with a theme they can still use."""
    stored = chosen_appearance(conn, user_id)
    result = default_appearance(site_default(conn))
    for key, value in stored.items():
        # 1 == True in Python, so the type is checked too.
        choices = APPEARANCE_CHOICES.get(key, ())
        if value in choices and type(value) is type(choices[0]):
            result[key] = value
    ids = {t["id"] for t in all_themes(conn, user_id)}
    theme = stored.get("theme")
    if isinstance(theme, str) and theme in ids:
        result["theme"] = theme
    return result


def choose(conn: sqlite3.Connection, user_id: str, **changes: Any) -> None:
    """Keep these choices (None forgets one, so it follows the default again)."""
    stored = chosen_appearance(conn, user_id)
    for key, value in changes.items():
        if value is None:
            stored.pop(key, None)
        else:
            stored[key] = value
    prefs.put(conn, user_id, "appearance", stored)


def own_layouts(conn: sqlite3.Connection, user_id: str) -> list[dict[str, Any]]:
    stored = prefs.get(conn, user_id, "layouts")
    layouts = []
    for raw in stored if isinstance(stored, list) else []:
        try:
            layout = clean_layout(raw)
        except Invalid:
            continue
        if layout["id"]:
            layouts.append(layout)
    return layouts


# ---------------------------------------------------------------------------
# Presets

PANEL_KEYS: Final = ("aspectarian", "trees", "timing")
REPORTS: Final = ("chart", "aspects", "midpoints", "hellenistic", "events")
ROLES: Final = (
    "none",
    "ask",
    "transits_now",
    "progressions_now",
    "solar_arc_now",
    "solar_return_next",
    "lunar_return_next",
    "fixed",
)
MAX_PRESET_VIEWS: Final = 6


def report_of(panel: Any) -> str:
    """The report tab a preset's old panel switches mean (one report at a time)."""
    panel = panel if isinstance(panel, dict) else {}
    if panel.get("aspectarian"):
        return "aspects"
    if panel.get("trees"):
        return "midpoints"
    if panel.get("timing"):
        return "hellenistic"
    return "chart"


def _clean_role(raw: Any) -> dict[str, Any]:
    """What chart 2 is in a preset's view: none, ask each time, a chart worked out for now (transits,
    progressions, solar arc, the next return), or one particular chart (`fixed`)."""
    raw = raw if isinstance(raw, dict) else {}
    role = raw.get("role") if raw.get("role") in ROLES else "none"
    chart = raw.get("chart")
    if role == "fixed":
        if not (isinstance(chart, dict) and isinstance(chart.get("id"), str) and chart["id"]):
            return {"role": "none"}
        parent = chart.get("parent")
        return {
            "role": "fixed",
            "chart": {
                "id": chart["id"][:400],
                "derived": bool(chart.get("derived")),
                "parent": parent[:200] if isinstance(parent, str) else None,
            },
            "chart_name": str(raw.get("chart_name") or "")[:200] or None,
        }
    return {"role": role}


def clean_view_template(raw: Any) -> dict[str, Any]:
    """One view of a preset: chart type (and dial size), layout, report tab, Between and chart 2's role."""
    if not isinstance(raw, dict) or raw.get("display") not in OPTIONS:
        raise Invalid("A preset's view needs a chart type: wheel, hellenistic or dial")
    display = raw["display"]
    size = raw.get("dial_size")
    dial_size = float(size) if isinstance(size, int | float) and not isinstance(size, bool) else None
    if display != "dial" or dial_size is None or not valid_modulus(dial_size):
        dial_size = 90.0 if display == "dial" else None
    name = str(raw.get("name") or "").strip()[:60] or None
    return {
        "name": name,
        "display": display,
        "dial_size": dial_size,
        "layout": str(raw.get("layout") or "")[:80] or None,
        "report": raw.get("report") if raw.get("report") in REPORTS else "chart",
        "between": bool(raw.get("between", False)),
        "partner": _clean_role(raw.get("partner")),
    }


def clean_preset(raw: Any) -> dict[str, Any]:
    """A preset is a name, an optional theme and calculation profile, and one to six views. Presets
    from before 1.12 (one chart type, layout and panel) read as a preset with one view. The first
    view's settings are also given at the top level (display, dial_size, layout, panel), as before."""
    if not isinstance(raw, dict):
        raise Invalid("A preset needs a chart type: wheel, hellenistic or dial")
    given = raw.get("views")
    views: list[dict[str, Any]] = []
    if isinstance(given, list):
        for v in given[:MAX_PRESET_VIEWS]:
            try:
                views.append(clean_view_template(v))
            except Invalid:
                continue
    if not views:
        views = [
            clean_view_template(
                {
                    "display": raw.get("display"),
                    "dial_size": raw.get("dial_size"),
                    "layout": raw.get("layout"),
                    "report": report_of(raw.get("panel")),
                }
            )
        ]
    first = views[0]

    def ref(key: str) -> str | None:
        return str(raw.get(key) or "")[:80] or None

    return {
        "id": str(raw.get("id") or ""),
        "name": str(raw.get("name") or "").strip()[:NAME_MAX] or "Untitled preset",
        "theme": ref("theme"),
        "profile": ref("profile"),
        "views": views,
        "display": first["display"],
        "dial_size": first["dial_size"],
        "layout": first["layout"],
        "panel": {
            "aspectarian": first["report"] == "aspects",
            "trees": first["report"] == "midpoints",
            "timing": first["report"] == "hellenistic",
        },
    }


def presets(conn: sqlite3.Connection, user_id: str) -> list[dict[str, Any]]:
    stored = prefs.get(conn, user_id, "presets")
    out = []
    for raw in stored if isinstance(stored, list) else []:
        try:
            preset = clean_preset(raw)
        except Invalid:
            continue
        if preset["id"]:
            out.append(preset)
    return out
