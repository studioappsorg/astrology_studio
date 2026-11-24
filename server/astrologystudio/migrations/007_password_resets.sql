-- AstrologyStudio ·
-- server/astrologystudio/migrations/007_password_resets.sql
--
-- 007:
--
-- "Forgot your password?" links. Only a hash of each link's token is kept; a link works once,
-- for an hour.
--
-- Copyright (c) 2026 Gavin Melhuish
-- MIT License; see LICENSE in the project root.
-- SPDX-License-Identifier: MIT

CREATE TABLE password_resets (
    token_hash  TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    created_at  TEXT NOT NULL,
    expires_at  TEXT NOT NULL,
    used_at     TEXT
);
CREATE INDEX password_resets_by_user ON password_resets (user_id);
