-- AstrologyStudio ·
-- server/astrologystudio/migrations/010_user_management.sql
--
-- 010:
--
-- The owner's user management. An account can be switched off (it keeps its charts, settings
-- and key); every login, code, sign-up, password and key change is written to the activity log;
-- and each person can have limits on how many calls are made to ephemeralREST for them, per
-- hour, day, week and month (no row: the site's defaults).
--
-- Copyright (c) 2026 Gavin Melhuish
-- MIT License; see LICENSE in the project root.
-- SPDX-License-Identifier: MIT

ALTER TABLE users ADD COLUMN disabled_at TEXT;
ALTER TABLE users ADD COLUMN disabled_by TEXT;
ALTER TABLE users ADD COLUMN disabled_reason TEXT;
-- Set when an account is switched off: the next login asks for a code even on a trusted browser.
ALTER TABLE users ADD COLUMN ignore_device INTEGER NOT NULL DEFAULT 0;

CREATE TABLE auth_events (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     TEXT REFERENCES users (id) ON DELETE CASCADE,  -- null: an address with no account here
    email       TEXT NOT NULL DEFAULT '',
    at          TEXT NOT NULL,
    ip          TEXT NOT NULL DEFAULT '',
    user_agent  TEXT NOT NULL DEFAULT '',
    event       TEXT NOT NULL,              -- login, login_code, key_saved, disabled, ...
    outcome     TEXT NOT NULL,              -- success, bad-password, by-owner, ...
    detail      TEXT NOT NULL DEFAULT ''    -- never a password, code, token or key (a key prefix at most)
);
CREATE INDEX auth_events_by_user ON auth_events (user_id, id);
CREATE INDEX auth_events_by_time ON auth_events (at);

CREATE TABLE user_limits (
    user_id     TEXT PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
    per_hour    INTEGER,                    -- null: no limit
    per_day     INTEGER,
    per_week    INTEGER,
    per_month   INTEGER,
    updated_at  TEXT NOT NULL
);

-- The count in each period's current window; a new window starts it again from 0.
CREATE TABLE usage_counts (
    user_id       TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    period        TEXT NOT NULL,            -- hour, day, week, month
    period_start  TEXT NOT NULL,
    count         INTEGER NOT NULL DEFAULT 0,
    reached       INTEGER NOT NULL DEFAULT 0,  -- limit_reached logged for this window
    PRIMARY KEY (user_id, period)
);

-- When the person last confirmed who they are (password, or ephemeralREST password and code),
-- for Show my key and Replace my key: good for 5 minutes, for this session only.
ALTER TABLE sessions ADD COLUMN reauth_at TEXT;
