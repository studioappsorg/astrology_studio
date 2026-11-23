"""
AstrologyStudio ·
server/astrologystudio/cli.py

Command line:

`astrologystudio serve | migrate | backup | reset-password`.

Copyright (c) 2026 Gavin Melhuish
MIT License; see LICENSE in the project root.
SPDX-License-Identifier: MIT
"""

from __future__ import annotations

import argparse
import sqlite3
import sys

from .config import Settings
from .db import connect, migrate, now, transaction


def _serve(args: argparse.Namespace) -> int:
    import os

    import uvicorn

    if os.environ.get("ASTROLOGYSTUDIO_WEB_WATCH") == "1":
        from .devweb import start_watch

        start_watch()

    if os.environ.get("ASTROLOGYSTUDIO_EXIT_WITH_LAUNCHER") == "1":
        _exit_with_launcher()

    trusted = os.environ.get("ASTROLOGYSTUDIO_TRUSTED_PROXIES", "127.0.0.1")
    uvicorn.run(
        "astrologystudio.app:create_app",
        factory=True,
        host=args.host,
        port=args.port,
        proxy_headers=True,
        forwarded_allow_ips=trusted,
    )
    return 0


def _exit_with_launcher() -> None:
    """Shut down when the launcher that started us goes (scripts/dev.mjs, used by VS Code's F5).

    The launcher holds our stdin open; when it stops, however it stops, stdin reaches its end
    and we shut down as if Ctrl+C had been pressed, so the port is free for the next F5.
    """
    import _thread
    import signal
    import threading

    def watch() -> None:
        while sys.stdin.read(4096):
            pass
        _thread.interrupt_main(signal.SIGINT)

    threading.Thread(target=watch, name="exit-with-launcher", daemon=True).start()


def _backup(args: argparse.Namespace) -> int:
    """A consistent copy of the database while the app keeps running (SQLite's online backup)."""
    from pathlib import Path

    settings = Settings.from_env()
    stamp = now()[:19].replace(":", "")
    target = Path(args.path) if args.path else settings.backup_dir / f"astrologystudio-{stamp}.db"
    target.parent.mkdir(parents=True, exist_ok=True)
    source = connect(settings.database_path)
    destination = sqlite3.connect(target)
    try:
        source.backup(destination)
    finally:
        destination.close()
        source.close()
    print(target)
    return 0


def _migrate(_: argparse.Namespace) -> int:
    applied = migrate(Settings.from_env())
    print("Applied: " + ", ".join(applied) if applied else "Database is up to date.")
    return 0


def _reset_password(args: argparse.Namespace) -> int:
    import secrets

    from .accounts import end_other_sessions, hash_password
    from .schemas import normalise_email

    settings = Settings.from_env()
    migrate(settings)
    conn = connect(settings.database_path)
    password = secrets.token_urlsafe(12)
    with transaction(conn):
        row = conn.execute("SELECT id FROM users WHERE email = ?", (normalise_email(args.email),)).fetchone()
        if row:
            conn.execute(
                "UPDATE users SET password_hash = ? WHERE id = ?", (hash_password(password), row["id"])
            )
            end_other_sessions(conn, row["id"], None)
    conn.close()
    if not row:
        print("No user with that email address.", file=sys.stderr)
        return 1
    print(f"New password for {args.email}:\n\n    {password}\n\nAsk them to change it after logging in.")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="astrologystudio")
    commands = parser.add_subparsers(dest="command", required=True)

    serve = commands.add_parser("serve", help="Run the web app and API")
    serve.add_argument("--host", default="127.0.0.1")
    serve.add_argument("--port", type=int, default=8080)
    serve.set_defaults(run=_serve)

    commands.add_parser("migrate", help="Apply database migrations").set_defaults(run=_migrate)

    backup = commands.add_parser("backup", help="Copy the database to a backup file")
    backup.add_argument("path", nargs="?", help="Where to write it (default: the backups folder)")
    backup.set_defaults(run=_backup)

    reset = commands.add_parser("reset-password", help="Give someone a new password")
    reset.add_argument("--email", required=True)
    reset.set_defaults(run=_reset_password)

    args = parser.parse_args(argv)
    result: int = args.run(args)
    return result


if __name__ == "__main__":
    sys.exit(main())
