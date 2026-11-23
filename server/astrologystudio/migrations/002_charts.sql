-- AstrologyStudio ·
-- server/astrologystudio/migrations/002_charts.sql
--
-- 002: how each person organises their charts. The charts themselves live in ephemeralREST.
--
-- Copyright (c) 2026 Gavin Melhuish
-- MIT License; see LICENSE in the project root.
-- SPDX-License-Identifier: MIT

CREATE TABLE folders (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE (user_id, name)
);

-- One row per chart in a person's list: everything about it that isn't astronomy.
CREATE TABLE chart_notes (
    user_id      TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    chart_id     TEXT NOT NULL,             -- the ephemeralREST chart id
    folder_id    TEXT REFERENCES folders (id) ON DELETE SET NULL,
    tags         TEXT NOT NULL DEFAULT '[]', -- JSON array of lower-case tags
    rating       TEXT NOT NULL DEFAULT '',   -- Rodden rating: AA, A, B, C, DD, X, XX or ''
    source       TEXT NOT NULL DEFAULT '',
    notes        TEXT NOT NULL DEFAULT '',
    time_unknown INTEGER NOT NULL DEFAULT 0,
    utc_offset   TEXT NOT NULL DEFAULT '',   -- '+10:00' when set by hand, '' for automatic
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL,
    PRIMARY KEY (user_id, chart_id)
);
CREATE INDEX chart_notes_by_folder ON chart_notes (folder_id);
