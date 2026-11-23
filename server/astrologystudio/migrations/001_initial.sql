-- AstrologyStudio ·
-- server/astrologystudio/migrations/001_initial.sql
--
-- 001: people who log in, their sessions, install settings, each person's
-- ephemeralREST key and their own display preferences.
--
-- Copyright (c) 2026 Gavin Melhuish
-- MIT License; see LICENSE in the project root.
-- SPDX-License-Identifier: MIT

CREATE TABLE users (
    id            TEXT PRIMARY KEY,
    email         TEXT NOT NULL UNIQUE,  -- normalised to lower case
    name          TEXT NOT NULL DEFAULT '',
    password_hash TEXT NOT NULL,         -- scrypt$<n>$<r>$<p>$<salt>$<hash>
    is_owner      INTEGER NOT NULL DEFAULT 0,  -- the owner manages the install and its users
    created_at    TEXT NOT NULL,
    last_login_at TEXT
);

-- The session cookie holds a random token; only its SHA-256 is stored here.
CREATE TABLE sessions (
    token_hash   TEXT PRIMARY KEY,
    user_id      TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    csrf_token   TEXT NOT NULL,
    created_at   TEXT NOT NULL,
    expires_at   TEXT NOT NULL,
    last_seen_at TEXT NOT NULL
);
CREATE INDEX sessions_by_user ON sessions (user_id);
CREATE INDEX sessions_by_expiry ON sessions (expires_at);

-- Install-wide settings, one JSON value per key (for example the ephemeralREST address).
CREATE TABLE settings (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- Each person's own ephemeralREST API key, encrypted with the install's secret key.
CREATE TABLE ephemeral_keys (
    user_id     TEXT PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
    encrypted   TEXT NOT NULL,
    prefix      TEXT NOT NULL,           -- the first characters, to recognise it by
    identity    TEXT,                    -- JSON from ephemeralREST /me when last checked
    checked_at  TEXT,
    updated_at  TEXT NOT NULL
);

-- Each person's display preferences: one JSON document per key (features, bodies, profiles, ...).
CREATE TABLE preferences (
    user_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    key        TEXT NOT NULL,
    value      TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id, key)
);
