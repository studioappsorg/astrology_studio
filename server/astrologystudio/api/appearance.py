"""
AstrologyStudio ·
server/astrologystudio/api/appearance.py

/api/v1/preferences/appearance, /themes, /layouts and /presets: how charts and dials look.
/api/v1/site/themes: themes the owner publishes for everyone.

Copyright (c) 2026 Gavin Melhuish
MIT License; see LICENSE in the project root.
SPDX-License-Identifier: MIT
"""

from __future__ import annotations

import json
from typing import Annotated, Any, Literal

from fastapi import APIRouter
from pydantic import Field

from .. import appearance as look
from .. import preferences as prefs
from ..db import transaction
from ..deps import Db, OwnerPrincipal, UserPrincipal
from ..errors import ProblemError, not_found
from ..ids import new_id
from ..schemas import Strict

router = APIRouter(tags=["Appearance"])

Name = Annotated[str, Field(min_length=1, max_length=look.NAME_MAX)]


def _view(conn: Db, user_id: str) -> dict[str, Any]:
    return {
        "appearance": look.appearance(conn, user_id),
        "themes": look.all_themes(conn, user_id),
        "site_default": look.site_default(conn),
        "layouts": [*look.BUILTIN_LAYOUTS, *look.own_layouts(conn, user_id)],
        "presets": look.presets(conn, user_id),
    }


@router.get("/preferences/appearance-catalog", summary="What can be adjusted, for the editors")
def catalog(_: UserPrincipal) -> dict[str, Any]:
    return {
        "tokens": [{"key": k, "group": g, "label": label} for k, g, label in look.TOKENS],
        "groups": [{"key": k, "label": label} for k, label in look.GROUPS],
        "sign_modes": list(look.SIGN_MODES),
        "body_modes": list(look.BODY_MODES),
        "dashes": list(look.DASHES),
        "options": {k: {key: list(v) for key, v in o.items()} for k, o in look.OPTIONS.items()},
        "appearance": {k: list(v) for k, v in look.APPEARANCE_CHOICES.items()},
        "min_dial": look.MIN_DIAL,
    }


@router.get("/preferences/appearance", summary="Your theme, display options and layouts")
def get_appearance(conn: Db, person: UserPrincipal) -> dict[str, Any]:
    return _view(conn, person.id)


class AppearanceChange(Strict):
    theme: str | None = None
    text_size: Literal[90, 100, 115, 130] | None = None
    glyph_size: Literal["small", "medium", "large"] | None = None
    line_weight: Literal["fine", "normal", "bold"] | None = None
    degrees: Literal["dm", "dms", "decimal"] | None = None
    date_format: Literal["ymd", "dmy", "mdy"] | None = None
    time_format: Literal["24", "12"] | None = None
    retro: Literal["symbol", "letter"] | None = None
    reduce_motion: bool | None = None
    export_bg: Literal["theme", "white", "transparent"] | None = None


@router.patch("/preferences/appearance", summary="Change your theme or display options")
def patch_appearance(body: AppearanceChange, conn: Db, person: UserPrincipal) -> dict[str, Any]:
    with transaction(conn):
        if body.theme is not None and body.theme not in {t["id"] for t in look.all_themes(conn, person.id)}:
            raise not_found("Theme", body.theme)
        look.choose(conn, person.id, **body.model_dump(exclude_none=True))
    return _view(conn, person.id)


# ---------------------------------------------------------------------------
# Your own themes


class ThemeNew(Strict):
    name: Name
    copy_from: str
    """Any theme you can use: built-in, site or your own."""


class ThemeImport(Strict):
    theme: dict[str, Any]
    """A theme as exported: name, base, signs, bodies, dashes, light and dark."""


def _save_own(conn: Db, user_id: str, themes: list[dict[str, Any]]) -> None:
    prefs.put(conn, user_id, "themes", [{k: v for k, v in t.items() if k != "kind"} for t in themes])


def _add(conn: Db, user_id: str, theme: dict[str, Any], use: bool) -> dict[str, Any]:
    with transaction(conn):
        own = look.own_themes(conn, user_id)
        if len(own) >= look.MAX_OWN_THEMES:
            raise ProblemError(422, "too-many-themes", f"At most {look.MAX_OWN_THEMES} themes", None)
        own.append({**theme, "id": new_id("theme"), "kind": "own"})
        _save_own(conn, user_id, own)
        if use:
            look.choose(conn, user_id, theme=own[-1]["id"])
    return {**_view(conn, user_id), "created": own[-1]["id"]}


@router.post("/preferences/themes", status_code=201, summary="Make a theme by copying one")
def add_theme(body: ThemeNew, conn: Db, person: UserPrincipal) -> dict[str, Any]:
    source = next((t for t in look.all_themes(conn, person.id) if t["id"] == body.copy_from), None)
    if source is None:
        raise not_found("Theme", body.copy_from)
    copy = look.clean_theme({**source, "name": body.name})
    return _add(conn, person.id, copy, use=False)


@router.post("/preferences/themes/import", status_code=201, summary="Add a theme from an exported file")
def import_theme(body: ThemeImport, conn: Db, person: UserPrincipal) -> dict[str, Any]:
    if len(json.dumps(body.theme)) > look.MAX_IMPORT_BYTES:
        raise ProblemError(422, "theme-too-large", "That file is too large to be a theme", None)
    try:
        theme = look.clean_theme(body.theme, strict=True)
    except look.Invalid as exc:
        raise ProblemError(422, "bad-theme", "That isn't a theme AstrologyStudio can use", str(exc)) from exc
    return _add(conn, person.id, theme, use=False)


class ThemeChange(Strict):
    name: Name | None = None
    signs: Literal["element", "modality", "sign", "plain"] | None = None
    bodies: Literal["single", "element", "sect", "body"] | None = None
    dashes: dict[str, Literal["solid", "dashed", "dotted"]] | None = None
    light: dict[str, str] | None = None
    dark: dict[str, str] | None = None


@router.patch("/preferences/themes/{theme_id}", summary="Change one of your themes")
def patch_theme(theme_id: str, body: ThemeChange, conn: Db, person: UserPrincipal) -> dict[str, Any]:
    with transaction(conn):
        own = look.own_themes(conn, person.id)
        index = next((i for i, t in enumerate(own) if t["id"] == theme_id), None)
        if index is None:
            raise not_found("Theme", theme_id)
        theme = own[index]
        change = body.model_dump(exclude_none=True)
        merged = {
            **theme,
            **{k: v for k, v in change.items() if k not in ("dashes", "light", "dark")},
            "dashes": {**theme["dashes"], **change.get("dashes", {})},
            "light": {**theme["light"], **change.get("light", {})},
            "dark": {**theme["dark"], **change.get("dark", {})},
        }
        try:
            own[index] = {**look.clean_theme(merged, strict=True), "id": theme_id, "kind": "own"}
        except look.Invalid as exc:
            raise ProblemError(422, "bad-colour", "Not a colour", str(exc)) from exc
        _save_own(conn, person.id, own)
    return _view(conn, person.id)


@router.delete("/preferences/themes/{theme_id}", summary="Remove one of your themes")
def delete_theme(theme_id: str, conn: Db, person: UserPrincipal) -> dict[str, Any]:
    with transaction(conn):
        own = look.own_themes(conn, person.id)
        remaining = [t for t in own if t["id"] != theme_id]
        if len(remaining) == len(own):
            raise not_found("Theme", theme_id)
        in_use = look.appearance(conn, person.id)["theme"] == theme_id
        _save_own(conn, person.id, remaining)
        if in_use:
            look.choose(conn, person.id, theme=None)  # back to the site's default
    return _view(conn, person.id)


# ---------------------------------------------------------------------------
# Site themes (owner)


class Publish(Strict):
    theme_id: str
    """One of your own themes; a copy is published."""


@router.post("/site/themes", status_code=201, summary="Publish one of your themes for everyone")
def publish_theme(body: Publish, conn: Db, person: OwnerPrincipal) -> dict[str, Any]:
    own = next((t for t in look.own_themes(conn, person.id) if t["id"] == body.theme_id), None)
    if own is None:
        raise not_found("Theme", body.theme_id)
    with transaction(conn):
        site = look.site_themes(conn)
        if len(site) >= look.MAX_SITE_THEMES:
            raise ProblemError(422, "too-many-themes", f"At most {look.MAX_SITE_THEMES} site themes", None)
        site.append({**own, "id": new_id("site-theme"), "kind": "site"})
        look.put_setting(conn, look.SITE_THEMES, site)
    return _view(conn, person.id)


@router.delete("/site/themes/{theme_id}", summary="Withdraw a site theme")
def withdraw_theme(theme_id: str, conn: Db, person: OwnerPrincipal) -> dict[str, Any]:
    """People using it go back to the site's default theme the next time they open the app."""
    with transaction(conn):
        site = look.site_themes(conn)
        remaining = [t for t in site if t["id"] != theme_id]
        if len(remaining) == len(site):
            raise not_found("Theme", theme_id)
        look.put_setting(conn, look.SITE_THEMES, remaining)
        if look.site_default(conn) == theme_id:
            look.put_setting(conn, look.SITE_DEFAULT, look.DEFAULT_THEME)
    return _view(conn, person.id)


class DefaultTheme(Strict):
    theme_id: str
    """A built-in or site theme."""


@router.put("/site/default-theme", summary="The theme new accounts start with")
def set_default_theme(body: DefaultTheme, conn: Db, person: OwnerPrincipal) -> dict[str, Any]:
    ids = {t["id"] for t in look.BUILTIN_THEMES} | {t["id"] for t in look.site_themes(conn)}
    if body.theme_id not in ids:
        raise ProblemError(422, "not-a-site-theme", "Choose a built-in or site theme", body.theme_id)
    with transaction(conn):
        look.put_setting(conn, look.SITE_DEFAULT, body.theme_id)
    return _view(conn, person.id)


# ---------------------------------------------------------------------------
# Layouts


class LayoutNew(Strict):
    name: Name
    copy_from: str
    """A built-in or your own layout; the new one is for the same chart type."""


class LayoutChange(Strict):
    name: Name | None = None
    options: dict[str, Any] | None = None


@router.post("/preferences/layouts", status_code=201, summary="Make a layout by copying one")
def add_layout(body: LayoutNew, conn: Db, person: UserPrincipal) -> dict[str, Any]:
    with transaction(conn):
        own = look.own_layouts(conn, person.id)
        source = next((x for x in [*look.BUILTIN_LAYOUTS, *own] if x["id"] == body.copy_from), None)
        if source is None:
            raise not_found("Layout", body.copy_from)
        if len(own) >= look.MAX_OWN_LAYOUTS:
            raise ProblemError(422, "too-many-layouts", f"At most {look.MAX_OWN_LAYOUTS} layouts", None)
        layout = {**look.clean_layout({**source, "name": body.name}), "id": new_id("layout")}
        own.append(layout)
        prefs.put(conn, person.id, "layouts", own)
    return {**_view(conn, person.id), "created": layout["id"]}


@router.patch("/preferences/layouts/{layout_id}", summary="Change one of your layouts")
def patch_layout(layout_id: str, body: LayoutChange, conn: Db, person: UserPrincipal) -> dict[str, Any]:
    with transaction(conn):
        own = look.own_layouts(conn, person.id)
        index = next((i for i, x in enumerate(own) if x["id"] == layout_id), None)
        if index is None:
            raise not_found("Layout", layout_id)
        layout = own[index]
        allowed = look.OPTIONS[layout["display"]]
        for key, value in (body.options or {}).items():
            if key not in allowed or value not in allowed[key]:
                raise ProblemError(422, "bad-layout-option", "Unknown layout option", f"{key}: {value!r}")
        options = {**layout["options"], **(body.options or {})}
        changed = {**layout, "name": body.name or layout["name"], "options": options}
        own[index] = {**look.clean_layout(changed), "id": layout_id}
        prefs.put(conn, person.id, "layouts", own)
    return _view(conn, person.id)


@router.delete("/preferences/layouts/{layout_id}", summary="Remove one of your layouts")
def delete_layout(layout_id: str, conn: Db, person: UserPrincipal) -> dict[str, Any]:
    with transaction(conn):
        own = look.own_layouts(conn, person.id)
        remaining = [x for x in own if x["id"] != layout_id]
        if len(remaining) == len(own):
            raise not_found("Layout", layout_id)
        prefs.put(conn, person.id, "layouts", remaining)
    return _view(conn, person.id)


# ---------------------------------------------------------------------------
# Presets


class Panel(Strict):
    aspectarian: bool = False
    trees: bool = False
    timing: bool = False


class SlotRef(Strict):
    id: Annotated[str, Field(min_length=1, max_length=400)]
    derived: bool = False
    parent: Annotated[str, Field(max_length=200)] | None = None


class PartnerRole(Strict):
    role: Literal[
        "none",
        "ask",
        "transits_now",
        "progressions_now",
        "solar_arc_now",
        "solar_return_next",
        "lunar_return_next",
        "fixed",
    ] = "none"
    chart: SlotRef | None = None
    """For `fixed`: the chart."""
    chart_name: Annotated[str, Field(max_length=200)] | None = None


class ViewTemplate(Strict):
    name: Annotated[str, Field(max_length=60)] | None = None
    display: Literal["wheel", "hellenistic", "dial"]
    dial_size: float | None = None
    layout: str | None = None
    report: Literal["chart", "overview", "aspects", "midpoints", "hellenistic", "events"] = "chart"
    between: bool = False
    partner: PartnerRole = PartnerRole()


class PresetBody(Strict):
    name: Name
    views: Annotated[list[ViewTemplate], Field(min_length=1, max_length=look.MAX_PRESET_VIEWS)] | None = None
    """The preset's views (1.12). Or, as before, one view given by display, dial_size, layout and panel."""
    display: Literal["wheel", "hellenistic", "dial"] | None = None
    dial_size: float | None = None
    """Only for the dial: any size that divides 360 evenly."""
    layout: str | None = None
    theme: str | None = None
    profile: str | None = None
    panel: Panel = Panel()


class PresetChange(Strict):
    name: Name | None = None
    views: Annotated[list[ViewTemplate], Field(min_length=1, max_length=look.MAX_PRESET_VIEWS)] | None = None
    display: Literal["wheel", "hellenistic", "dial"] | None = None
    dial_size: float | None = None
    layout: str | None = None
    theme: str | None = None
    profile: str | None = None
    panel: Panel | None = None


def _check_views(views: list[ViewTemplate] | None) -> None:
    for v in views or []:
        _check_size(v.display, v.dial_size)
        if v.partner.role == "fixed" and v.partner.chart is None:
            raise ProblemError(422, "fixed-needs-chart", "A fixed chart 2 needs its chart", None)


def _check_size(display: str | None, size: float | None) -> None:
    if display == "dial" and size is not None and not look.valid_modulus(size):
        raise ProblemError(422, "bad-modulus", "A dial size must divide 360° evenly", str(size))


@router.post("/preferences/presets", status_code=201, summary="Save a preset")
def add_preset(body: PresetBody, conn: Db, person: UserPrincipal) -> dict[str, Any]:
    """A named set of views (each: chart type, dial size, layout, report tab and chart 2's role),
    with an optional theme and calculation profile. Layouts, theme and profile are referred to by
    id, not copied. The pre-1.12 shape (display, dial_size, layout, panel) still makes a one-view
    preset."""
    if body.views is None and body.display is None:
        raise ProblemError(422, "preset-needs-views", "A preset needs views, or a chart type", None)
    _check_size(body.display, body.dial_size)
    _check_views(body.views)
    with transaction(conn):
        own = look.presets(conn, person.id)
        if len(own) >= look.MAX_PRESETS:
            raise ProblemError(422, "too-many-presets", f"At most {look.MAX_PRESETS} presets", None)
        preset = {**look.clean_preset(body.model_dump()), "id": new_id("preset")}
        own.append(preset)
        prefs.put(conn, person.id, "presets", own)
    return {**_view(conn, person.id), "created": preset["id"]}


@router.patch("/preferences/presets/{preset_id}", summary="Change a preset")
def patch_preset(preset_id: str, body: PresetChange, conn: Db, person: UserPrincipal) -> dict[str, Any]:
    with transaction(conn):
        own = look.presets(conn, person.id)
        index = next((i for i, x in enumerate(own) if x["id"] == preset_id), None)
        if index is None:
            raise not_found("Preset", preset_id)
        change = body.model_dump(exclude_unset=True)
        _check_views(body.views)
        merged = {**own[index], **change}
        legacy = {"display", "dial_size", "layout", "panel"} & set(change)
        if legacy and "views" not in change:
            # The pre-1.12 fields change the preset's first view.
            first = {
                **own[index]["views"][0],
                "display": merged["display"],
                "dial_size": merged.get("dial_size"),
                "layout": merged.get("layout"),
                "report": look.report_of(merged.get("panel")),
            }
            merged["views"] = [first, *own[index]["views"][1:]]
        _check_size(merged["display"], merged.get("dial_size"))
        own[index] = {**look.clean_preset(merged), "id": preset_id}
        prefs.put(conn, person.id, "presets", own)
    return _view(conn, person.id)


class PresetOrder(Strict):
    ids: Annotated[list[str], Field(max_length=200)]


@router.put("/preferences/presets-order", summary="Put your presets in order")
def order_presets(body: PresetOrder, conn: Db, person: UserPrincipal) -> dict[str, Any]:
    """The order the preset picker and My View list them in. Presets not named keep their place
    after the ones that are; unknown ids are ignored."""
    with transaction(conn):
        own = look.presets(conn, person.id)
        rank = {pid: i for i, pid in enumerate(body.ids)}
        own.sort(key=lambda x: (rank.get(x["id"], len(rank)), 0))
        prefs.put(conn, person.id, "presets", own)
    return _view(conn, person.id)


@router.delete("/preferences/presets/{preset_id}", summary="Remove a preset")
def delete_preset(preset_id: str, conn: Db, person: UserPrincipal) -> dict[str, Any]:
    with transaction(conn):
        own = look.presets(conn, person.id)
        remaining = [x for x in own if x["id"] != preset_id]
        if len(remaining) == len(own):
            raise not_found("Preset", preset_id)
        prefs.put(conn, person.id, "presets", remaining)
    return _view(conn, person.id)
