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
from typing import Any

from fastapi import APIRouter, FastAPI, Request, Response

from . import __version__, ephemeral, errors, web
from .accounts import LoginThrottle
from .api import (
    account,
    appearance,
    auth,
    branding,
    charts,
    connection,
    email,
    email_design,
    ephemeris,
    folders,
    places,
    preferences,
    site_settings,
    system,
    users,
)
from .config import Settings
from .db import migrate

log = logging.getLogger("astrologystudio")

ROUTERS = (
    system, auth, users, site_settings, connection, email, email_design, branding, account, preferences,
    appearance, places, folders, charts, ephemeris,
)  # fmt: skip


# The browser talks only to this site: every call to ephemeralREST is made by this server, so
# `connect-src 'self'` holds (and stops a script injected into a page sending data elsewhere).
CONTENT_SECURITY_POLICY = "; ".join([
    "default-src 'self'",
    "connect-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",  # style attributes the app sets (colours, sizes)
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
])  # fmt: skip
SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "same-origin",
    "X-Frame-Options": "DENY",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
}


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
    # Show my key and Replace my key: five failed checks lock both for 15 minutes.
    app.state.reauth_throttle = LoginThrottle(limit=5)
    app.state.ephemeral_transport = None
    app.state.ephemeral_cache = ephemeral.Cache()
    app.state.ephemeral_features = {}  # ephemeralREST's /health flags, by address (see signup.py)
    errors.install(app)

    @app.middleware("http")
    async def security_headers(request: Request, call_next: Any) -> Response:
        response: Response = await call_next(request)
        for name, value in SECURITY_HEADERS.items():
            response.headers.setdefault(name, value)
        # The API docs page loads its viewer from a CDN, so it's left out.
        if not request.url.path.startswith("/api/docs"):
            response.headers.setdefault("Content-Security-Policy", CONTENT_SECURITY_POLICY)
        return response

    v1 = APIRouter(prefix="/api/v1")
    for module in ROUTERS:
        v1.include_router(module.router)
    app.include_router(v1)
    app.include_router(web.router)  # last: it answers every other GET with the web app
    return app
