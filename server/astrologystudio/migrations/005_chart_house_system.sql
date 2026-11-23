-- AstrologyStudio ·
-- server/astrologystudio/migrations/005_chart_house_system.sql
--
-- 005: each chart can have its own house system; '' means "use my default".
--
-- Copyright (c) 2026 Gavin Melhuish
-- MIT License; see LICENSE in the project root.
-- SPDX-License-Identifier: MIT

ALTER TABLE chart_notes ADD COLUMN house_system TEXT NOT NULL DEFAULT '';
