"""
AstrologyStudio ·
server/astrologystudio/catalog.py

The things a person can switch on or off:

major features, and bodies and points.

The web app builds its "Your view" screens from these lists, so adding an entry
here is all it takes to make something switchable.

Copyright (c) 2026 Gavin Melhuish
MIT License; see LICENSE in the project root.
SPDX-License-Identifier: MIT
"""

from __future__ import annotations

from typing import Any, Final

FEATURES: Final[dict[str, str]] = {
    "transits": "Transits",
    "progressions": "Secondary progressions",
    "solar_arc": "Solar arc directions",
    "returns": "Solar and lunar returns",
    "synastry": "Synastry",
    "composite": "Composite charts",
    "davison": "Davison charts",
    "hellenistic": "Hellenistic techniques",
    "dials": "Cosmobiology dials",
    "midpoints": "Midpoints",
    "harmonics": "Harmonic charts",
    "heliocentric": "Heliocentric positions",
    "time_tools": "Event lists",
    "ephemeris": "Ephemeris page",
}
"""Major features. Natal charts are always on."""

COMMON_FEATURES: Final = (
    "transits",
    "progressions",
    "solar_arc",
    "returns",
    "synastry",
    "composite",
    "midpoints",
    "time_tools",
    "ephemeris",
)
"""The most common techniques: what a new person (Self-selected, the default school) starts with."""

# (key, label, glyph, group, on by default)
BODIES: Final[list[tuple[str, str, str, str, bool]]] = [
    ("sun", "Sun", "☉", "Planets", True),
    ("moon", "Moon", "☽", "Planets", True),
    ("mercury", "Mercury", "☿", "Planets", True),
    ("venus", "Venus", "♀", "Planets", True),
    ("mars", "Mars", "♂", "Planets", True),
    ("jupiter", "Jupiter", "♃", "Planets", True),
    ("saturn", "Saturn", "♄", "Planets", True),
    ("uranus", "Uranus", "♅", "Planets", True),
    ("neptune", "Neptune", "♆", "Planets", True),
    ("pluto", "Pluto", "♇", "Planets", True),
    ("earth", "Earth (heliocentric)", "♁", "Planets", True),
    ("chiron", "Chiron", "⚷", "Asteroids", True),
    ("ceres", "Ceres", "⚳", "Asteroids", False),
    ("pallas", "Pallas", "⚴", "Asteroids", False),
    ("juno", "Juno", "⚵", "Asteroids", False),
    ("vesta", "Vesta", "⚶", "Asteroids", False),
    ("mean_node", "Mean node", "☊", "Points", True),
    ("true_node", "True node", "☊", "Points", False),
    ("south_node", "South node", "☋", "Points", False),
    ("mean_lilith", "Lilith (mean)", "⚸", "Points", False),
    ("true_lilith", "Lilith (true)", "⚸", "Points", False),
    ("aries_point", "Aries Point", "♈", "Points", False),
    ("part_of_fortune", "Part of Fortune", "⊗", "Lots", False),
    ("lot_spirit", "Lot of Spirit", "⊕", "Lots", False),
    ("lot_eros", "Lot of Eros", "Er", "Lots", False),
    ("lot_necessity", "Lot of Necessity", "Nc", "Lots", False),
    ("lot_courage", "Lot of Courage", "Co", "Lots", False),
    ("lot_victory", "Lot of Victory", "Vi", "Lots", False),
    ("lot_nemesis", "Lot of Nemesis", "Nm", "Lots", False),
    ("asc", "Ascendant", "AC", "Angles", True),
    ("mc", "Midheaven", "MC", "Angles", True),
    ("vertex", "Vertex", "Vx", "Angles", False),
    ("east_point", "East Point", "EP", "Angles", False),
]

BODY_KEYS: Final = frozenset(key for key, *_ in BODIES)
ANGLES: Final = frozenset({"asc", "mc", "vertex", "east_point"})
HELIO_EXCLUDED: Final = frozenset(
    {
        "moon",
        "mean_node",
        "true_node",
        "south_node",
        "mean_lilith",
        "true_lilith",
        "part_of_fortune",
        "lot_spirit",
        "lot_eros",
        "lot_necessity",
        "lot_courage",
        "lot_victory",
        "lot_nemesis",
        "aries_point",
        "asc",
        "mc",
        "vertex",
        "east_point",
    }
)
"""Not meaningful from the Sun: hidden in heliocentric mode."""


def default_features() -> dict[str, bool]:
    return {key: key in COMMON_FEATURES for key in FEATURES}


def default_bodies() -> dict[str, bool]:
    return {key: on for key, _, _, _, on in BODIES}


DISPLAY: Final[dict[str, tuple[str, ...]]] = {
    "glyphs": ("symbols", "letters"),
    "colours": ("studio", "classic", "mono"),
    "school": ("self", "modern", "hellenistic", "cosmobiology"),
}
"""Display choices; the first of each is the default."""


def default_display() -> dict[str, str]:
    return {k: v[0] for k, v in DISPLAY.items()}


LOTS: Final = frozenset(
    {
        "part_of_fortune",
        "lot_spirit",
        "lot_eros",
        "lot_necessity",
        "lot_courage",
        "lot_victory",
        "lot_nemesis",
    }
)

_PLANETS = ["sun", "moon", "mercury", "venus", "mars", "jupiter", "saturn"]
_MODERN = [*_PLANETS, "uranus", "neptune", "pluto"]

SCHOOLS: Final[dict[str, dict[str, Any]]] = {
    "self": {
        "label": "Self-selected",
        "hint": "Mix and match techniques from every school",
        "features": list(COMMON_FEATURES),
        "bodies": [key for key, _, _, _, on in BODIES if on],
    },
    "modern": {
        "label": "Modern Western",
        "features": [
            "transits",
            "progressions",
            "solar_arc",
            "returns",
            "synastry",
            "composite",
            "time_tools",
            "ephemeris",
        ],
        "bodies": [*_MODERN, "mean_node", "chiron", "asc", "mc"],
    },
    "hellenistic": {
        "label": "Hellenistic",
        "features": ["hellenistic", "transits", "returns", "synastry", "time_tools", "ephemeris"],
        "bodies": [*_PLANETS, "asc", "mc", "part_of_fortune", "lot_spirit"],
    },
    "cosmobiology": {
        "label": "Cosmobiology",
        "features": [
            "dials",
            "midpoints",
            "transits",
            "progressions",
            "solar_arc",
            "time_tools",
            "ephemeris",
            "harmonics",
        ],
        "bodies": [*_MODERN, "mean_node", "asc", "mc", "aries_point"],
    },
}
"""What each school uses: "Show only what this school uses" switches off everything else.
Self-selected is tied to no school: its list is the most common techniques, which new people start
with, and choosing it never switches anything off by itself."""
