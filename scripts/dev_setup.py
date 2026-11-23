"""
AstrologyStudio ·
scripts/dev_setup.py

Get a source checkout ready to run, and do nothing if it already is.

VS Code runs this before every F5 (the "setup: if needed" task), so the first press makes the
Python environment in .venv and installs the web app's packages, and later presses take about
a second. It reinstalls only when server/pyproject.toml or web/package-lock.json has changed.

Run it by hand with:  python3 scripts/dev_setup.py   (Windows: py -3 scripts\\dev_setup.py)

Copyright (c) 2026 Gavin Melhuish
MIT License; see LICENSE in the project root.
SPDX-License-Identifier: MIT
"""

from __future__ import annotations

import hashlib
import shutil
import subprocess
import sys
import venv
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VENV = ROOT / ".venv"
WINDOWS = sys.platform == "win32"
PYTHON = VENV / ("Scripts/python.exe" if WINDOWS else "bin/python")


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def stale(stamp: Path, source: Path) -> bool:
    return not stamp.exists() or stamp.read_text().strip() != digest(source)


def run(cmd: list[str], cwd: Path) -> None:
    print("  $", " ".join(cmd), flush=True)
    if subprocess.call(cmd, cwd=cwd) != 0:
        sys.exit("\nSetup stopped: that command failed (see above).")


def python() -> None:
    if sys.version_info < (3, 12):
        sys.exit(
            f"AstrologyStudio needs Python 3.12 or newer; this is {sys.version.split()[0]}.\n"
            "Install it from python.org (on Windows, tick 'Add python.exe to PATH') and press F5 again."
        )
    if not PYTHON.exists():
        print("Making the Python environment in .venv …", flush=True)
        venv.EnvBuilder(with_pip=True).create(VENV)
    stamp = VENV / ".astrologystudio-installed"
    pyproject = ROOT / "server" / "pyproject.toml"
    if stale(stamp, pyproject):
        print("Installing the server and its development tools …", flush=True)
        run([str(PYTHON), "-m", "pip", "install", "--upgrade", "--quiet", "pip"], ROOT)
        run([str(PYTHON), "-m", "pip", "install", "--quiet", "-e", "server[dev]"], ROOT)
        stamp.write_text(digest(pyproject))


def web() -> None:
    npm = shutil.which("npm")
    if not npm:
        sys.exit("Node.js isn't installed (npm wasn't found). Install Node 22 or newer from nodejs.org and press F5 again.")
    stamp = ROOT / "web" / "node_modules" / ".astrologystudio-installed"
    lock = ROOT / "web" / "package-lock.json"
    if stale(stamp, lock):
        print("Installing the web app's packages …", flush=True)
        run([npm, "ci", "--no-audit", "--no-fund"], ROOT / "web")
        stamp.write_text(digest(lock))


if __name__ == "__main__":
    python()
    web()
    print("Ready. The server builds the web app as it starts.", flush=True)
