"""
AstrologyStudio ·
server/astrologystudio/web.py

Serves the built web app (`web/dist`) from the same server as the API.

Any path that isn't an API address and isn't a file in
the build gets `index.html`, so the app's own routes (/campaigns, /contacts/…)
work on reload and from bookmarks.

Copyright (c) 2026 Gavin Melhuish
MIT License; see LICENSE in the project root.
SPDX-License-Identifier: MIT
"""

from __future__ import annotations

from fastapi import APIRouter, Request
from fastapi.responses import FileResponse, HTMLResponse, Response
from starlette.exceptions import HTTPException as StarletteHTTPException

from .config import Settings

router = APIRouter(include_in_schema=False)
_RESERVED = ("api/",)

_NOT_BUILT = """<!doctype html><meta charset="utf-8"><title>AstrologyStudio</title>
<p style="font:16px system-ui;margin:3em">The AstrologyStudio API is running,
but the web app hasn't been built. Run <code>npm run build</code> in <code>web/</code>,
or use the Docker image.</p>"""


@router.get("/{path:path}")
def web_app(path: str, request: Request) -> Response:
    if path.startswith(_RESERVED):
        raise StarletteHTTPException(404)  # answered as problem JSON like any other API 404
    settings: Settings = request.app.state.settings
    root = settings.web_dir
    index = root / "index.html"
    if not index.is_file():
        return HTMLResponse(_NOT_BUILT)

    candidate = (root / path).resolve()
    if path and candidate.is_file() and candidate.is_relative_to(root.resolve()):
        return FileResponse(candidate, headers={"Cache-Control": "no-cache"})
    return FileResponse(index, headers={"Cache-Control": "no-cache"})
