"""
AstrologyStudio ·
server/astrologystudio/astro/zodiac.py

Zodiac choices. Sidereal positions need ayanamsa support in ephemeralREST: until it has
it, the choice is kept and shown, and positions stay tropical.

Copyright (c) 2026 Gavin Melhuish
MIT License; see LICENSE in the project root.
SPDX-License-Identifier: MIT
"""

from __future__ import annotations

from typing import Any, Final

AYANAMSAS: Final[dict[str, str]] = {
    "lahiri": "Lahiri",
    "fagan_bradley": "Fagan-Bradley",
    "krishnamurti": "Krishnamurti",
    "raman": "Raman",
}

SIDEREAL_SUPPORTED: Final = False
"""Switch on once ephemeralREST accepts an ayanamsa (and fill in `request_fields`)."""


def request_fields(zodiac: str, ayanamsa: str) -> dict[str, Any]:
    """Extra /calculate fields for the zodiac. Stub: ephemeralREST doesn't take these yet,
    and it rejects fields it doesn't know, so nothing is sent until it does."""
    if zodiac == "sidereal" and SIDEREAL_SUPPORTED:
        return {"zodiac": "sidereal", "ayanamsa": ayanamsa}
    return {}
