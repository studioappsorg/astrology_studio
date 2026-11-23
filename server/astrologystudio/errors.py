"""
AstrologyStudio ·
server/astrologystudio/errors.py

Errors as RFC 9457 problem details (`application/problem+json`).

Raise `ProblemError` anywhere in request handling; the installed handlers turn
it, validation failures and unexpected exceptions into consistent responses.

Copyright (c) 2026 Gavin Melhuish
MIT License; see LICENSE in the project root.
SPDX-License-Identifier: MIT
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

log = logging.getLogger("astrologystudio")

PROBLEM_BASE = "https://getstudioapps.com/problems/"
MEDIA_TYPE = "application/problem+json"


class ProblemError(Exception):
    def __init__(self, status: int, slug: str, title: str, detail: str | None = None, **extra: Any) -> None:
        super().__init__(detail or title)
        self.status = status
        self.slug = slug
        self.title = title
        self.detail = detail
        self.extra = extra


def not_found(kind: str, id_: str) -> ProblemError:
    return ProblemError(404, "not-found", f"{kind} not found", f"No {kind.lower()} with id {id_}.")


def problem_response(
    status: int, slug: str, title: str, detail: str | None, request: Request, **extra: Any
) -> JSONResponse:
    body: dict[str, Any] = {"type": PROBLEM_BASE + slug, "title": title, "status": status}
    if detail:
        body["detail"] = detail
    body["instance"] = request.url.path
    body.update(extra)
    return JSONResponse(body, status_code=status, media_type=MEDIA_TYPE)


def install(app: FastAPI) -> None:
    @app.exception_handler(ProblemError)
    async def _problem(request: Request, exc: ProblemError) -> JSONResponse:
        return problem_response(exc.status, exc.slug, exc.title, exc.detail, request, **exc.extra)

    @app.exception_handler(RequestValidationError)
    async def _validation(request: Request, exc: RequestValidationError) -> JSONResponse:
        errors = [
            {"location": ".".join(str(part) for part in err["loc"]), "message": err["msg"]}
            for err in exc.errors()
        ]
        return problem_response(
            422,
            "validation",
            "The request is not valid",
            "See `errors` for each problem.",
            request,
            errors=errors,
        )

    @app.exception_handler(StarletteHTTPException)
    async def _http(request: Request, exc: StarletteHTTPException) -> JSONResponse:
        titles = {404: "Not found", 405: "Method not allowed"}
        slug = "not-found" if exc.status_code == 404 else "http-error"
        detail = exc.detail if isinstance(exc.detail, str) else None
        return problem_response(exc.status_code, slug, titles.get(exc.status_code, "Error"), detail, request)

    @app.exception_handler(Exception)
    async def _unexpected(request: Request, exc: Exception) -> JSONResponse:
        log.exception("Unhandled error on %s %s", request.method, request.url.path)
        return problem_response(500, "internal", "Something went wrong", None, request)
