-- AstrologyStudio ·
-- server/astrologystudio/migrations/009_site_signup.sql
--
-- 009:
--
-- Sign-up on this site's own pages. A key request is someone logged in here who asked for an
-- ephemeralREST account ("I don't have a key"): when they finish it from the emailed link, in
-- whatever browser, the new key is saved to them. A pending key is one waiting for them to say
-- what happens to their charts before it replaces their current key. (The site key itself is a
-- setting.)
--
-- Copyright (c) 2026 Gavin Melhuish
-- MIT License; see LICENSE in the project root.
-- SPDX-License-Identifier: MIT

CREATE TABLE key_requests (
    user_id     TEXT PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
    email       TEXT NOT NULL,              -- the ephemeralREST account's address (may differ from the login)
    created_at  TEXT NOT NULL,
    expires_at  TEXT NOT NULL
);
CREATE INDEX key_requests_by_email ON key_requests (email);

CREATE TABLE pending_keys (
    user_id     TEXT PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
    encrypted   TEXT NOT NULL,
    identity    TEXT,
    created_at  TEXT NOT NULL
);
