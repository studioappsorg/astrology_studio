"""
AstrologyStudio ·
server/astrologystudio/app.py

Application factory.

Copyright (c) 2026 Gavin Melhuish
MIT License; see LICENSE in the project root.
SPDX-License-Identifier: MIT
"""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import APIRouter, FastAPI

from . import __version__, ephemeral, errors, web
from .accounts import LoginThrottle
from .api import (
    account,
    appearance,
    auth,
    charts,
    connection,
    ephemeris,
    folders,
    places,
    preferences,
    system,
    users,
)
from .config import Settings
from .db import migrate

log = logging.getLogger("astrologystudio")

ROUTERS = (
    system, auth, users, connection, account, preferences, appearance, places, folders, charts, ephemeris,
)  # fmt: skip


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings.from_env()

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        applied = migrate(settings)
        if applied:
            log.info("Applied migrations: %s", ", ".join(applied))
        yield

    app = FastAPI(
        title="AstrologyStudio API",
        version=__version__,
        summary="Astrology charts and cosmobiology. Calculations by ephemeralREST.",
        lifespan=lifespan,
        openapi_url="/api/v1/openapi.json",
        docs_url="/api/docs",
        redoc_url=None,
    )
    app.state.settings = settings
    app.state.login_throttle = LoginThrottle()
    app.state.ephemeral_transport = None
    app.state.ephemeral_cache = ephemeral.Cache()
    errors.install(app)

    v1 = APIRouter(prefix="/api/v1")
    for module in ROUTERS:
        v1.include_router(module.router)
    app.include_router(v1)
    app.include_router(web.router)  # last: it answers every other GET with the web app
    return app
