"""
AstrologyStudio ·
server/astrologystudio/devweb.py

Development only:

build the web app and keep rebuilding it while the server runs.

Turned on by `ASTROLOGYSTUDIO_WEB_WATCH=1` (VS Code's Server configuration sets it), so one
press of Run starts everything in one place. Installed copies never use it.

Copyright (c) 2026 Gavin Melhuish
MIT License; see LICENSE in the project root.
SPDX-License-Identifier: MIT
"""

from __future__ import annotations

import atexit
import shutil
import subprocess
import sys
import threading
from pathlib import Path

_WEB = Path(__file__).resolve().parents[2] / "web"


def start_watch(timeout: float = 60.0) -> subprocess.Popen[str] | None:
    """Start esbuild's watcher, wait for the first build, and stop it when the server stops."""
    script = _WEB / "scripts" / "build.mjs"
    node = shutil.which("node")
    if not script.exists() or not (_WEB / "node_modules").exists():
        print("[web] Not watching: run the 'setup: everything (run once)' task first.", flush=True)
        return None
    if node is None:
        print("[web] Not watching: Node.js isn't installed or isn't on PATH.", flush=True)
        return None

    proc = subprocess.Popen(
        [node, str(script), "--watch", "--with-parent"],
        cwd=_WEB,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        stdin=subprocess.PIPE,  # closes when this process ends, which stops the watcher
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    first_build = threading.Event()

    def relay() -> None:
        assert proc.stdout is not None
        for line in proc.stdout:
            print(f"[web] {line.rstrip()}", flush=True)
            if "build finished" in line:
                first_build.set()
        first_build.set()

    threading.Thread(target=relay, name="web-watch", daemon=True).start()
    atexit.register(_stop, proc)
    if not first_build.wait(timeout):
        print("[web] The first build is taking a while; starting the server anyway.", file=sys.stderr)
    return proc


def _stop(proc: subprocess.Popen[str]) -> None:
    if proc.poll() is None:
        proc.terminate()
        try:
            proc.wait(5)
        except subprocess.TimeoutExpired:
            proc.kill()
