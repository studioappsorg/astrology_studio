"""
AstrologyStudio ·
server/astrologystudio/api/preferences.py

/api/v1/preferences:

what each person wants to see. Stored in this install.

Copyright (c) 2026 Gavin Melhuish
MIT License; see LICENSE in the project root.
SPDX-License-Identifier: MIT
"""

from __future__ import annotations

import json
import re
from typing import Annotated, Any, Literal

from fastapi import APIRouter
from pydantic import Field

from .. import catalog, charts
from .. import preferences as prefs
from ..appearance import valid_modulus
from ..astro import aspects, zodiac
from ..db import transaction
from ..deps import Db, UserPrincipal
from ..errors import ProblemError, not_found
from ..ids import new_id
from ..schemas import Strict

router = APIRouter(prefix="/preferences", tags=["Preferences"])


class Switches(Strict):
    features: dict[str, bool] | None = None
    bodies: dict[str, bool] | None = None
    display: dict[str, str] | None = None
    aspect_colours: dict[str, str | None] | None = None
    """Your colour for each aspect, as #rrggbb; null goes back to the theme's colour."""
    reset: bool = False
    """Back to the defaults for everything in Your view (before applying any other change)."""


def _view(conn: Db, user_id: str) -> dict[str, Any]:
    return {
        "features": prefs.features(conn, user_id),
        "bodies": prefs.bodies(conn, user_id),
        "display": prefs.display(conn, user_id),
        "aspect_colours": prefs.aspect_colours(conn, user_id),
    }


@router.get("/catalog", summary="Everything that can be switched on or off")
def get_catalog(_: UserPrincipal) -> dict[str, Any]:
    return {
        "display": {k: list(v) for k, v in catalog.DISPLAY.items()},
        "features": [{"key": k, "label": v} for k, v in catalog.FEATURES.items()],
        "bodies": [
            {"key": k, "label": label, "glyph": glyph, "group": group, "default": on}
            for k, label, glyph, group, on in catalog.BODIES
        ],
        "schools": [
            {
                "key": k,
                "label": v["label"],
                "hint": v.get("hint", ""),
                "features": v["features"],
                "bodies": v["bodies"],
            }
            for k, v in catalog.SCHOOLS.items()
        ],
    }


@router.get("/view", summary="Your feature and body switches")
def get_view(conn: Db, person: UserPrincipal) -> dict[str, Any]:
    return _view(conn, person.id)


@router.patch("/view", summary="Change some of your switches")
def patch_view(body: Switches, conn: Db, person: UserPrincipal) -> dict[str, Any]:
    """Send only what changes, e.g. `{"features": {"harmonics": false}}`."""
    for group, known in (("features", catalog.FEATURES.keys()), ("bodies", catalog.BODY_KEYS)):
        unknown = set(getattr(body, group) or {}) - set(known)
        if unknown:
            raise ProblemError(422, "unknown-switch", f"Unknown {group}", ", ".join(sorted(unknown)))
    for key, value in (body.display or {}).items():
        if value not in catalog.DISPLAY.get(key, ()):
            raise ProblemError(422, "unknown-display", "Unknown display choice", f"{key}: {value}")
    for key, colour in (body.aspect_colours or {}).items():
        if key not in aspects.BY_KEY:
            raise ProblemError(422, "unknown-aspect", "Unknown aspect", key)
        if colour is not None and not prefs.HEX_COLOUR.match(colour):
            raise ProblemError(422, "bad-colour", "Colours are #rrggbb", f"{key}: {colour}")
    with transaction(conn):
        if body.reset:
            conn.execute(
                "DELETE FROM preferences WHERE user_id = ?"
                " AND key IN ('features', 'bodies', 'display', 'aspect_colours')",
                (person.id,),
            )
        if body.display:
            prefs.put(conn, person.id, "display", {**prefs.display(conn, person.id), **body.display})
        if body.aspect_colours:
            colours = {**prefs.aspect_colours(conn, person.id), **body.aspect_colours}
            prefs.put(conn, person.id, "aspect_colours", {k: v.lower() for k, v in colours.items() if v})
        for group, current in (
            ("features", prefs.features(conn, person.id)),
            ("bodies", prefs.bodies(conn, person.id)),
        ):
            changes = getattr(body, group)
            if changes:
                prefs.put(conn, person.id, group, {**current, **changes})
    return _view(conn, person.id)


class SchoolChoice(Strict):
    school: Literal["self", "modern", "hellenistic", "cosmobiology"]


@router.post("/limit-to-school", summary="Switch off what a school doesn't use")
def limit_to_school(body: SchoolChoice, conn: Db, person: UserPrincipal) -> dict[str, Any]:
    """Switches off every feature and body the school doesn't use (see the catalog's
    `schools`), and switches on the ones it does. Anything can be switched back on afterwards.
    For `self` (Self-selected) that means back to the most common techniques."""
    school = catalog.SCHOOLS[body.school]
    with transaction(conn):
        prefs.put(conn, person.id, "features", {k: k in school["features"] for k in catalog.FEATURES})
        prefs.put(conn, person.id, "bodies", {k: k in school["bodies"] for k in catalog.BODY_KEYS})
        prefs.put(conn, person.id, "display", {**prefs.display(conn, person.id), "school": body.school})
    return _view(conn, person.id)


REMEMBERED = "remembered"
REMEMBERED_KEY = re.compile(r"^[a-z0-9][a-z0-9-]{0,63}$")
REMEMBERED_MAX_KEYS = 200
REMEMBERED_MAX_VALUE = 4096


class RememberedChange(Strict):
    values: dict[str, Any]
    """Choices to keep, by name. `null` forgets one."""


def _remembered(conn: Db, user_id: str) -> dict[str, Any]:
    stored = prefs.get(conn, user_id, REMEMBERED)
    return stored if isinstance(stored, dict) else {}


@router.get("/remembered", summary="Your remembered screen choices")
def get_remembered(conn: Db, person: UserPrincipal) -> dict[str, Any]:
    """How each screen was last left: theme, wheel or dial, layout, panel width and so on.
    Kept per person, so they follow you to any browser."""
    return {"values": _remembered(conn, person.id)}


@router.patch("/remembered", summary="Remember some screen choices")
def patch_remembered(body: RememberedChange, conn: Db, person: UserPrincipal) -> dict[str, Any]:
    for key, value in body.values.items():
        if not REMEMBERED_KEY.match(key):
            raise ProblemError(422, "bad-remembered-key", "Unusable name for a remembered choice", key)
        if len(json.dumps(value)) > REMEMBERED_MAX_VALUE:
            raise ProblemError(422, "remembered-too-large", "Remembered choice too large", key)
    with transaction(conn):
        current = _remembered(conn, person.id)
        for key, value in body.values.items():
            if value is None:
                current.pop(key, None)
            else:
                current[key] = value
        if len(current) > REMEMBERED_MAX_KEYS:
            raise ProblemError(
                422, "too-many-remembered", f"At most {REMEMBERED_MAX_KEYS} remembered choices", None
            )
        prefs.put(conn, person.id, REMEMBERED, current)
    return {"values": current}


class AspectSetting(Strict):
    on: bool | None = None
    orb: Annotated[float, Field(ge=0, le=15)] | None = None


class ProfileChange(Strict):
    name: Annotated[str, Field(min_length=1, max_length=60)] | None = None
    house_system: str | None = None
    """A house system, or "" to use your default house system (Settings → Defaults)."""
    zodiac: Literal["tropical", "sidereal"] | None = None
    ayanamsa: str | None = None
    aspects: dict[str, AspectSetting] | None = None
    moving_orb: Annotated[float, Field(ge=0.1, le=5)] | None = None
    """Largest orb for transits, progressions and directions to the natal chart."""
    lot_formula: Literal["day", "sect"] | None = None
    """Part of Fortune: "sect" reverses it for night charts; "day" uses one formula always."""


class DefaultsChange(Strict):
    house_system: str | None = None
    """The house system for profiles that don't have their own."""
    place: Annotated[str, Field(max_length=200)] | None = None
    """Where you usually are: new charts start with it, and transits and returns are worked out
    for it. "" for none."""


@router.get("/defaults", summary="Your default house system and place")
def get_defaults(conn: Db, person: UserPrincipal) -> dict[str, Any]:
    return prefs.defaults(conn, person.id)


@router.put("/defaults", summary="Change your default house system or place")
def put_defaults(body: DefaultsChange, conn: Db, person: UserPrincipal) -> dict[str, Any]:
    if body.house_system is not None and body.house_system not in charts.HOUSE_SYSTEMS:
        raise ProblemError(422, "unknown-house-system", "Unknown house system", body.house_system)
    with transaction(conn):
        current = prefs.defaults(conn, person.id)
        prefs.save_defaults(conn, person.id, {**current, **body.model_dump(exclude_none=True)})
    return prefs.defaults(conn, person.id)


class ProfileNew(Strict):
    name: Annotated[str, Field(min_length=1, max_length=60)]
    copy_from: str | None = None


def _calc_view(conn: Db, user_id: str) -> dict[str, Any]:
    return {
        **prefs.calculation(conn, user_id),
        "house_systems": [{"key": k, "label": v} for k, v in charts.HOUSE_SYSTEMS.items()],
        "ayanamsas": [{"key": k, "label": v} for k, v in zodiac.AYANAMSAS.items()],
        "sidereal_supported": zodiac.SIDEREAL_SUPPORTED,
        "aspects": [
            {
                "key": a.key,
                "name": a.name,
                "glyph": a.glyph,
                "angle": a.angle,
                "major": a.major,
                "kind": a.kind,
                "default_orb": a.orb,
            }
            for a in aspects.ASPECTS
        ],
        "defaults": prefs.defaults(conn, user_id),
        # Kept for 0.2 clients:
        "house_system": prefs.house_system(conn, user_id),
    }


def _apply(profile: dict[str, Any], change: ProfileChange) -> dict[str, Any]:
    if change.house_system and change.house_system not in charts.HOUSE_SYSTEMS:
        raise ProblemError(422, "unknown-house-system", "Unknown house system", change.house_system)
    if change.ayanamsa is not None and change.ayanamsa not in zodiac.AYANAMSAS:
        raise ProblemError(422, "unknown-ayanamsa", "Unknown ayanamsa", change.ayanamsa)
    unknown = set(change.aspects or {}) - set(aspects.BY_KEY)
    if unknown:
        raise ProblemError(422, "unknown-aspect", "Unknown aspect", ", ".join(sorted(unknown)))
    updated = {**profile, **change.model_dump(exclude_none=True, exclude={"aspects"})}
    merged = {k: dict(v) for k, v in profile["aspects"].items()}
    for key, setting in (change.aspects or {}).items():
        merged[key].update(setting.model_dump(exclude_none=True))
    updated["aspects"] = merged
    return prefs.clean_profile(updated)


@router.get("/calculation", summary="Your calculation profiles")
def get_calculation(conn: Db, person: UserPrincipal) -> dict[str, Any]:
    return _calc_view(conn, person.id)


@router.patch("/calculation", summary="Change the active profile")
def patch_calculation(body: ProfileChange, conn: Db, person: UserPrincipal) -> dict[str, Any]:
    return patch_profile(prefs.calculation(conn, person.id)["active"], body, conn, person)


@router.post("/profiles", status_code=201, summary="Add a calculation profile")
def add_profile(body: ProfileNew, conn: Db, person: UserPrincipal) -> dict[str, Any]:
    with transaction(conn):
        calc = prefs.calculation(conn, person.id)
        if len(calc["profiles"]) >= 20:
            raise ProblemError(422, "too-many-profiles", "At most 20 profiles", None)
        source = (
            next((p for p in calc["profiles"] if p["id"] == body.copy_from), None) or prefs.default_profile()
        )
        profile = prefs.clean_profile({**source, "id": new_id("profile"), "name": body.name})
        calc["profiles"].append(profile)
        prefs.save_calculation(conn, person.id, calc)
    return _calc_view(conn, person.id)


@router.patch("/profiles/{profile_id}", summary="Change a calculation profile")
def patch_profile(profile_id: str, body: ProfileChange, conn: Db, person: UserPrincipal) -> dict[str, Any]:
    with transaction(conn):
        calc = prefs.calculation(conn, person.id)
        index = next((i for i, p in enumerate(calc["profiles"]) if p["id"] == profile_id), None)
        if index is None:
            raise not_found("Profile", profile_id)
        calc["profiles"][index] = _apply(calc["profiles"][index], body)
        prefs.save_calculation(conn, person.id, calc)
    return _calc_view(conn, person.id)


@router.post("/profiles/{profile_id}/activate", summary="Use a calculation profile")
def activate_profile(profile_id: str, conn: Db, person: UserPrincipal) -> dict[str, Any]:
    with transaction(conn):
        calc = prefs.calculation(conn, person.id)
        if profile_id not in [p["id"] for p in calc["profiles"]]:
            raise not_found("Profile", profile_id)
        calc["active"] = profile_id
        prefs.save_calculation(conn, person.id, calc)
    return _calc_view(conn, person.id)


@router.delete("/profiles/{profile_id}", summary="Remove a calculation profile")
def delete_profile(profile_id: str, conn: Db, person: UserPrincipal) -> dict[str, Any]:
    with transaction(conn):
        calc = prefs.calculation(conn, person.id)
        remaining = [p for p in calc["profiles"] if p["id"] != profile_id]
        if len(remaining) == len(calc["profiles"]):
            raise not_found("Profile", profile_id)
        if not remaining:
            raise ProblemError(409, "last-profile", "Keep at least one profile", None)
        calc["profiles"] = remaining
        if calc["active"] == profile_id:
            calc["active"] = remaining[0]["id"]
        prefs.save_calculation(conn, person.id, calc)
    return _calc_view(conn, person.id)


# ---------------------------------------------------------------------------
# Views: the ways a chart is looked at (chart type, chart 2, layout, report tab…), kept per chart.

CHART_VIEWS = "chart_views:"
CHART_VIEWS_KEPT = 300
MAX_VIEWS = 6
CHART_ID = re.compile(r"^[^\s/]{1,200}$")


class SlotRefBody(Strict):
    id: Annotated[str, Field(min_length=1, max_length=400)]
    derived: bool
    parent: Annotated[str, Field(max_length=200)] | None = None


NowRole = Literal[
    "transits_now", "progressions_now", "solar_arc_now", "solar_return_next", "lunar_return_next"
]


class ViewBody(Strict):
    id: Annotated[str, Field(min_length=1, max_length=40)]
    name: Annotated[str, Field(max_length=60)] | None = None
    display: Literal["wheel", "hellenistic", "dial"] = "wheel"
    dial_size: float = 90
    layout: Annotated[str, Field(max_length=64)] | None = None
    chart: SlotRefBody | None = None
    """Chart 1 when it isn't the chart itself (a chart derived from it)."""
    partner: SlotRefBody | None = None
    """Chart 2."""
    partner_name: Annotated[str, Field(max_length=200)] | None = None
    """Chart 2's name, for the view's label."""
    partner_role: NowRole | None = None
    """How chart 2 was made, when it was worked out for now (kept for saving the view in a preset)."""
    ask: bool = False
    """Chart 2 is still to be chosen (a preset's "ask each time")."""
    report: Literal["chart", "aspects", "midpoints", "hellenistic", "events"] = "chart"
    selected: Literal[0, 1] = 0
    between: bool = False
    pointer: Annotated[float, Field(ge=0, lt=360)] | None = None


class ChartViewsBody(Strict):
    views: Annotated[list[ViewBody], Field(min_length=1, max_length=MAX_VIEWS)]
    active: str
    preset: Annotated[str, Field(max_length=40)] | None = None


def _chart_key(chart_id: str) -> str:
    if not CHART_ID.match(chart_id):
        raise ProblemError(422, "bad-chart-id", "Unusable chart id", chart_id)
    return CHART_VIEWS + chart_id


@router.get("/chart-views/{chart_id}", summary="A chart's views")
def get_chart_views(chart_id: str, conn: Db, person: UserPrincipal) -> dict[str, Any] | None:
    """The views kept for this chart, or null when it has none yet (it opens with one view made
    from your defaults, or your default preset)."""
    stored = prefs.get(conn, person.id, _chart_key(chart_id))
    return stored if isinstance(stored, dict) else None


@router.put("/chart-views/{chart_id}", summary="Keep a chart's views")
def put_chart_views(chart_id: str, body: ChartViewsBody, conn: Db, person: UserPrincipal) -> dict[str, Any]:
    """Replaces the chart's views. Only the 300 charts most recently changed keep theirs."""
    key = _chart_key(chart_id)
    ids = [v.id for v in body.views]
    if len(set(ids)) != len(ids):
        raise ProblemError(422, "duplicate-view", "Two views have the same id", None)
    for v in body.views:
        if not valid_modulus(v.dial_size):
            raise ProblemError(422, "bad-dial-size", "A dial size must divide 360° evenly", str(v.dial_size))
    value = body.model_dump()
    if value["active"] not in ids:
        value["active"] = ids[0]
    with transaction(conn):
        prefs.put(conn, person.id, key, value)
        stale = conn.execute(
            "SELECT key FROM preferences WHERE user_id = ? AND key LIKE ?"
            " ORDER BY updated_at DESC, rowid DESC LIMIT -1 OFFSET ?",
            (person.id, CHART_VIEWS + "%", CHART_VIEWS_KEPT),
        ).fetchall()
        for row in stale:
            conn.execute("DELETE FROM preferences WHERE user_id = ? AND key = ?", (person.id, row["key"]))
    return value


@router.delete("/chart-views/{chart_id}", status_code=204, summary="Forget a chart's views")
def delete_chart_views(chart_id: str, conn: Db, person: UserPrincipal) -> None:
    with transaction(conn):
        key = _chart_key(chart_id)
        conn.execute("DELETE FROM preferences WHERE user_id = ? AND key = ?", (person.id, key))
