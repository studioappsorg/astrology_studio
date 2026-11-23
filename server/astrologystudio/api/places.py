"""
AstrologyStudio ·
server/astrologystudio/api/places.py

/api/v1/places:

place suggestions while typing, from ephemeralREST.

Copyright (c) 2026 Gavin Melhuish
MIT License; see LICENSE in the project root.
SPDX-License-Identifier: MIT
"""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Query

from ..deps import Eph

router = APIRouter(prefix="/places", tags=["Places"])


@router.get("", summary="Places matching what's typed so far")
def suggest(eph: Eph, q: Annotated[str, Query(min_length=2, max_length=120)]) -> dict[str, Any]:
    data = eph.get("/autocomplete", params={"q": q})
    predictions = data.get("predictions") if isinstance(data, dict) else None
    return {
        "data": [
            {"name": p.get("description"), "place_id": p.get("place_id")}
            for p in predictions or []
            if isinstance(p, dict) and p.get("description")
        ][:8]
    }
