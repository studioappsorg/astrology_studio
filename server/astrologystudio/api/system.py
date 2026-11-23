"""
AstrologyStudio ·
server/astrologystudio/api/system.py

/api/v1/health

Copyright (c) 2026 Gavin Melhuish
MIT License; see LICENSE in the project root.
SPDX-License-Identifier: MIT
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter

from .. import __version__
from ..deps import Db

router = APIRouter(tags=["System"])


@router.get("/health", summary="Health check")
def health(conn: Db) -> dict[str, Any]:
    """Unauthenticated. Used by Docker and uptime monitors."""
    conn.execute("SELECT 1").fetchone()
    return {"status": "ok", "version": __version__}
