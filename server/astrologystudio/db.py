"""
AstrologyStudio ·
server/astrologystudio/db.py

SQLite access, transactions and schema migrations.

Repositories never open transactions themselves. Each API write runs inside a
single `transaction()`, so a request either fully applies or not at all.

Copyright (c) 2026 Gavin Melhuish
MIT License; see LICENSE in the project root.
SPDX-License-Identifier: MIT
"""

from __future__ import annotations

import re
import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, datetime
from importlib import resources
from pathlib import Path

from .config import Settings

_MIGRATION_NAME = re.compile(r"^(\d{3})_[a-z0-9_]+\.sql$")


def now() -> str:
    """Current UTC time as an ISO-8601 string with millisecond precision."""
    return datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def connect(path: Path) -> sqlite3.Connection:
    # Autocommit mode: transactions are explicit via transaction(). The connection
    # may be used from a different worker thread than the one that opened it, but
    # only by one request at a time.
    conn = sqlite3.connect(path, isolation_level=None, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA synchronous = NORMAL")
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA busy_timeout = 5000")
    return conn


@contextmanager
def transaction(conn: sqlite3.Connection) -> Iterator[sqlite3.Connection]:
    """A write transaction. BEGIN IMMEDIATE takes the write lock up front, so
    concurrent writers wait (busy_timeout) instead of failing mid-transaction."""
    conn.execute("BEGIN IMMEDIATE")
    try:
        yield conn
    except BaseException:
        conn.execute("ROLLBACK")
        raise
    conn.execute("COMMIT")


# ---------------------------------------------------------------------------
# Migrations


def _migrations() -> list[tuple[int, str, str]]:
    found = []
    for entry in resources.files("astrologystudio.migrations").iterdir():
        match = _MIGRATION_NAME.match(entry.name)
        if match:
            found.append((int(match.group(1)), entry.name, entry.read_text(encoding="utf-8")))
    found.sort()
    versions = [v for v, _, _ in found]
    if len(set(versions)) != len(versions):
        raise RuntimeError("Two migration files share a version number")
    return found


def _is_blank(sql: str) -> bool:
    return all(not line.strip() or line.strip().startswith("--") for line in sql.splitlines())


def _statements(script: str) -> Iterator[str]:
    """Split a SQL script into statements (sqlite3.complete_statement handles
    semicolons inside strings, comments and trigger bodies)."""
    buffer = ""
    for line in script.splitlines(keepends=True):
        buffer += line
        if sqlite3.complete_statement(buffer):
            if not _is_blank(buffer):
                yield buffer.strip()
            buffer = ""
    if not _is_blank(buffer):
        raise ValueError("Migration ends with an incomplete statement")


def _backup(conn: sqlite3.Connection, settings: Settings, version: int) -> Path:
    settings.backup_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    target = settings.backup_dir / f"before-migration-{version:03d}-{stamp}.db"
    dest = sqlite3.connect(target)
    try:
        conn.backup(dest)
    finally:
        dest.close()
    return target


def migrate(settings: Settings) -> list[str]:
    """Apply pending migrations in order, in one transaction. Returns their file names.

    An existing database is copied to the backups folder before anything changes.
    """
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    conn = connect(settings.database_path)
    try:
        conn.execute(
            "CREATE TABLE IF NOT EXISTS schema_migrations ("
            " version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)"
        )
        applied = {row[0] for row in conn.execute("SELECT version FROM schema_migrations")}
        pending = [m for m in _migrations() if m[0] not in applied]
        if not pending:
            return []
        if applied:
            _backup(conn, settings, pending[0][0])

        with transaction(conn):
            # Re-check under the write lock in case another process migrated meanwhile.
            applied = {row[0] for row in conn.execute("SELECT version FROM schema_migrations")}
            done = []
            for version, name, script in pending:
                if version in applied:
                    continue
                for statement in _statements(script):
                    conn.execute(statement)
                conn.execute(
                    "INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)",
                    (version, name, now()),
                )
                done.append(name)
        return done
    finally:
        conn.close()
