"""
AstrologyStudio ·
server/tests/test_appearance.py

Tests:

themes, text size, dial sizes, layouts and presets (including presets as sets of views).

Copyright (c) 2026 Gavin Melhuish
MIT License; see LICENSE in the project root.
SPDX-License-Identifier: MIT
"""

from __future__ import annotations

from fastapi.testclient import TestClient

from astrologystudio import appearance as look

from .conftest import PASSWORD

API = "/api/v1"
P = f"{API}/preferences"


def test_builtin_themes_are_complete() -> None:
    ids = [t["id"] for t in look.BUILTIN_THEMES]
    assert ids == ["studio", "classic", "mono", "contrast", "parchment"]
    for theme in look.BUILTIN_THEMES:
        for mode in ("light", "dark"):
            assert set(theme[mode]) == look.TOKEN_KEYS
            assert all(look.COLOUR.match(v) for v in theme[mode].values())


def test_clean_theme_fills_and_checks() -> None:
    raw = {"name": "Mine", "base": "classic", "light": {"canvas": "#123456", "nope": "#000000"}}
    theme = look.clean_theme(raw)
    assert theme["light"]["canvas"] == "#123456"
    assert "nope" not in theme["light"]
    assert theme["dark"] == look.BUILTIN_BY_ID["classic"]["dark"]
    lenient = look.clean_theme({"light": {"canvas": "red"}})
    assert lenient["light"]["canvas"] == look.STUDIO_LIGHT["canvas"]
    try:
        look.clean_theme({"light": {"canvas": "red"}}, strict=True)
    except look.Invalid as exc:
        assert "canvas" in str(exc)
    else:
        raise AssertionError("strict should refuse a bad colour")


def test_dial_sizes() -> None:
    assert all(look.valid_modulus(m) for m in (360, 180, 120, 90, 72, 45, 30, 22.5, 11.25, 5.625))
    assert not any(look.valid_modulus(m) for m in (50, 100, 2.8125, 400, 0))


def test_appearance_defaults_and_migration(client: TestClient, owner: dict[str, str]) -> None:
    view = client.get(f"{P}/appearance").json()
    assert view["appearance"]["theme"] == "studio"
    assert view["appearance"]["text_size"] == 100
    assert len(view["themes"]) == 5
    # Someone who chose Classic colours before 1.3 gets the Classic theme.
    client.patch(f"{P}/view", json={"display": {"colours": "classic"}}, headers=owner)
    assert client.get(f"{P}/appearance").json()["appearance"]["theme"] == "classic"
    changed = client.patch(
        f"{P}/appearance", json={"theme": "parchment", "text_size": 115}, headers=owner
    ).json()
    assert changed["appearance"]["theme"] == "parchment" and changed["appearance"]["text_size"] == 115
    for change, status in (({"theme": "nope"}, 404), ({"text_size": 101}, 422)):
        assert client.patch(f"{P}/appearance", json=change, headers=owner).status_code == status


def test_own_themes(client: TestClient, owner: dict[str, str]) -> None:
    made = client.post(f"{P}/themes", json={"name": "Night", "copy_from": "classic"}, headers=owner)
    assert made.status_code == 201
    theme_id = made.json()["created"]
    changed = client.patch(
        f"{P}/themes/{theme_id}",
        json={"light": {"canvas": "#AABBCC"}, "signs": "modality", "dashes": {"trine": "dotted"}},
        headers=owner,
    ).json()
    mine = next(t for t in changed["themes"] if t["id"] == theme_id)
    assert mine["light"]["canvas"] == "#aabbcc" and mine["signs"] == "modality"
    assert mine["dashes"]["trine"] == "dotted" and mine["kind"] == "own"
    bad = client.patch(f"{P}/themes/{theme_id}", json={"dark": {"text": "blue"}}, headers=owner)
    assert bad.status_code == 422
    client.patch(f"{P}/appearance", json={"theme": theme_id}, headers=owner)
    gone = client.delete(f"{P}/themes/{theme_id}", headers=owner).json()
    assert gone["appearance"]["theme"] == "studio"
    assert client.patch(f"{P}/themes/studio", json={"name": "x"}, headers=owner).status_code == 404


def test_import(client: TestClient, owner: dict[str, str]) -> None:
    good = {"name": "Shared", "base": "mono", "light": {"canvas": "#fefefe"}, "unknown": 1}
    made = client.post(f"{P}/themes/import", json={"theme": good}, headers=owner)
    assert made.status_code == 201
    mine = next(t for t in made.json()["themes"] if t["id"] == made.json()["created"])
    assert mine["light"]["canvas"] == "#fefefe" and mine["base"] == "mono"
    bad = client.post(f"{P}/themes/import", json={"theme": {"light": {"canvas": "url(x)"}}}, headers=owner)
    assert bad.status_code == 422
    huge = {"name": "x" * 40_000}
    assert client.post(f"{P}/themes/import", json={"theme": huge}, headers=owner).status_code == 422


def test_site_themes(client: TestClient, owner: dict[str, str]) -> None:
    made = client.post(f"{P}/themes", json={"name": "House", "copy_from": "studio"}, headers=owner)
    own_id = made.json()["created"]
    published = client.post(f"{API}/site/themes", json={"theme_id": own_id}, headers=owner).json()
    site = [t for t in published["themes"] if t["kind"] == "site"]
    assert len(site) == 1 and site[0]["name"] == "House"
    assert (
        client.put(f"{API}/site/default-theme", json={"theme_id": own_id}, headers=owner).status_code == 422
    )
    client.put(f"{API}/site/default-theme", json={"theme_id": site[0]["id"]}, headers=owner)

    client.post(
        f"{API}/users",
        json={"name": "Ann", "email": "ann@example.com", "password": PASSWORD},
        headers=owner,
    )
    client.post(f"{API}/auth/logout", headers=owner)
    ann = {
        "X-CSRF-Token": client.post(
            f"{API}/auth/login", json={"email": "ann@example.com", "password": PASSWORD}
        ).json()["csrf_token"]
    }
    view = client.get(f"{P}/appearance").json()
    assert view["appearance"]["theme"] == site[0]["id"]  # new accounts start on the site default
    assert any(t["id"] == site[0]["id"] for t in view["themes"])
    assert client.post(f"{API}/site/themes", json={"theme_id": own_id}, headers=ann).status_code == 403


def test_layouts(client: TestClient, owner: dict[str, str]) -> None:
    view = client.get(f"{P}/appearance").json()
    ids = {x["id"] for x in view["layouts"]}
    assert {"wheel:default", "hellenistic:default", "dial:default", "dial:minimal"} <= ids
    hellenistic = next(x for x in view["layouts"] if x["id"] == "hellenistic:default")
    assert hellenistic["options"]["aspects"] == "hover"
    made = client.post(f"{P}/layouts", json={"name": "Mine", "copy_from": "dial:clear"}, headers=owner)
    layout_id = made.json()["created"]
    changed = client.patch(
        f"{P}/layouts/{layout_id}", json={"options": {"pointer": "arrow"}}, headers=owner
    ).json()
    mine = next(x for x in changed["layouts"] if x["id"] == layout_id)
    assert mine["display"] == "dial"
    assert mine["options"]["pointer"] == "arrow" and mine["options"]["glyphs"] == "large"
    bad = client.patch(f"{P}/layouts/{layout_id}", json={"options": {"scale": "1"}}, headers=owner)
    assert bad.status_code == 422
    assert client.delete(f"{P}/layouts/{layout_id}", headers=owner).status_code == 200


def test_presets(client: TestClient, owner: dict[str, str]) -> None:
    body = {
        "name": "Dial work",
        "display": "dial",
        "dial_size": 45,
        "layout": "dial:clear",
        "theme": "classic",
        "profile": "standard",
        "panel": {"trees": True},
    }
    made = client.post(f"{P}/presets", json=body, headers=owner)
    assert made.status_code == 201
    preset = next(x for x in made.json()["presets"] if x["id"] == made.json()["created"])
    assert preset["dial_size"] == 45
    assert preset["panel"] == {"aspectarian": False, "trees": True, "timing": False}
    wheel = client.post(f"{P}/presets", json={**body, "display": "wheel"}, headers=owner).json()
    assert next(x for x in wheel["presets"] if x["id"] == wheel["created"])["dial_size"] is None
    bad = client.post(f"{P}/presets", json={**body, "dial_size": 50}, headers=owner)
    assert bad.status_code == 422
    changed = client.patch(
        f"{P}/presets/{preset['id']}", json={"name": "Dials", "theme": None}, headers=owner
    ).json()
    again = next(x for x in changed["presets"] if x["id"] == preset["id"])
    assert again["name"] == "Dials" and again["theme"] is None and again["layout"] == "dial:clear"
    assert client.delete(f"{P}/presets/{preset['id']}", headers=owner).status_code == 200
    assert client.delete(f"{P}/presets/{preset['id']}", headers=owner).status_code == 404


def test_site_default_follows_people_who_never_chose(client: TestClient, owner: dict[str, str]) -> None:
    """Changing something else (symbols, text size) mustn't pin the theme to today's default."""
    made = client.post(f"{P}/themes", json={"name": "House", "copy_from": "classic"}, headers=owner).json()
    site = client.post(f"{API}/site/themes", json={"theme_id": made["created"]}, headers=owner).json()
    house = next(t["id"] for t in site["themes"] if t["kind"] == "site")
    client.patch(f"{P}/view", json={"display": {"glyphs": "letters"}}, headers=owner)
    client.patch(f"{P}/appearance", json={"text_size": 115}, headers=owner)
    client.put(f"{API}/site/default-theme", json={"theme_id": house}, headers=owner)
    view = client.get(f"{P}/appearance").json()["appearance"]
    assert view["theme"] == house and view["text_size"] == 115
    # Someone who did choose keeps their choice.
    client.patch(f"{P}/appearance", json={"theme": "parchment"}, headers=owner)
    client.put(f"{API}/site/default-theme", json={"theme_id": "mono"}, headers=owner)
    assert client.get(f"{P}/appearance").json()["appearance"]["theme"] == "parchment"


def test_fallback_colours_match_studio() -> None:
    """styles.css carries Studio's colours for when the theme can't be loaded."""
    from pathlib import Path

    css = (Path(__file__).parents[2] / "web" / "src" / "styles.css").read_text()
    light = css[css.index(":root {\n  --t-") :]
    light = light[: light.index("}")]
    dark = css[css.index(':root[data-theme="dark"] {\n  --t-') :]
    dark = dark[: dark.index("}")]
    for key, value in look.STUDIO_LIGHT.items():
        assert f"--t-{key}: {value};" in light, key
    for key, value in look.STUDIO_DARK.items():
        assert f"--t-{key}: {value};" in dark, key
