-- AstrologyStudio ·
-- server/astrologystudio/migrations/004_ephemeral_signin.sql
--
-- 004: people who registered through ephemeralREST sign in with their ephemeralREST email,
-- password and emailed code, not a password kept here.
--
-- Copyright (c) 2026 Gavin Melhuish
-- MIT License; see LICENSE in the project root.
-- SPDX-License-Identifier: MIT

ALTER TABLE users ADD COLUMN signs_in_with TEXT NOT NULL DEFAULT 'password';  -- 'password' or 'ephemeral'
