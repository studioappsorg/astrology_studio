"""
AstrologyStudio ·
server/astrologystudio/api/site_settings.py

/api/v1/settings:

install-wide choices for managing people: the limits everyone without their own starts with
(and the time zone their hours and days are counted in), and how long activity is kept.
Owner only.

Copyright (c) 2026 Gavin Melhuish
MIT License; see LICENSE in the project root.
SPDX-License-Identifier: MIT
"""

from __future__ import annotations

import json
from typing import Annotated, Any

from fastapi import APIRouter
from pydantic import Field

from .. import audit, limits
from ..db import now, transaction
from ..deps import Db, OwnerPrincipal
from ..errors import ProblemError
from ..schemas import Strict
from .users import Limits

router = APIRouter(prefix="/settings", tags=["Users"])


class DefaultLimits(Strict):
    limits: Limits = Field(default_factory=Limits)
    time_zone: Annotated[str, Field(min_length=1, max_length=64)] | None = None


@router.get("/default-limits", summary="The limits for everyone without their own")
def get_default_limits(conn: Db, _: OwnerPrincipal) -> dict[str, Any]:
    return {"limits": limits.site_defaults(conn), "time_zone": limits.time_zone(conn)}


@router.put("/default-limits", summary="Set the limits for everyone without their own")
def set_default_limits(body: DefaultLimits, conn: Db, owner: OwnerPrincipal) -> dict[str, Any]:
    if body.time_zone is not None and not limits.valid_zone(body.time_zone):
        raise ProblemError(422, "bad-time-zone", "Unknown time zone", "Use a name like Australia/Perth.")
    limits.set_site_defaults(conn, body.limits.model_dump(), body.time_zone)
    return get_default_limits(conn, owner)


class Retention(Strict):
    months: Annotated[int, Field(ge=1, le=120)]


@router.get("/activity-retention", summary="How long activity is kept")
def get_retention(conn: Db, _: OwnerPrincipal) -> dict[str, Any]:
    return {"months": audit.retention_months(conn)}


@router.put("/activity-retention", summary="Change how long activity is kept")
def set_retention(body: Retention, conn: Db, owner: OwnerPrincipal) -> dict[str, Any]:
    with transaction(conn):
        conn.execute(
            "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)"
            " ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
            (audit.RETENTION_SETTING, json.dumps(body.months), now()),
        )
    audit.prune(conn)
    return get_retention(conn, owner)
