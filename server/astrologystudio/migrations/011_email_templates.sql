-- AstrologyStudio ·
-- server/astrologystudio/migrations/011_email_templates.sql
--
-- 011:
--
-- The owner's email designs: a subject and body per kind of email (see email_design.py). No row
-- means the built-in default, so a new version can improve the defaults. Branding is a setting.
--
-- Copyright (c) 2026 Gavin Melhuish
-- MIT License; see LICENSE in the project root.
-- SPDX-License-Identifier: MIT

CREATE TABLE email_templates (
    key         TEXT PRIMARY KEY,          -- verify, login_code, password_reset, ...
    subject     TEXT NOT NULL,
    body        TEXT NOT NULL,
    enabled     INTEGER NOT NULL DEFAULT 1,  -- for the optional ones (account switched off or on)
    updated_at  TEXT NOT NULL
);
