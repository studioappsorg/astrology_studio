-- AstrologyStudio ·
-- server/astrologystudio/migrations/008_ephemeris_ayanamsas.sql
--
-- 008:
--
-- Each cached month of the ephemeris also keeps ephemeralREST's ayanamsas for each day, for
-- sidereal transits, progressions and the ephemeris page. NULL for a month fetched before (it's
-- fetched again when a sidereal profile needs it); {} when ephemeralREST sent none.
--
-- Copyright (c) 2026 Gavin Melhuish
-- MIT License; see LICENSE in the project root.
-- SPDX-License-Identifier: MIT

ALTER TABLE ephemeris_months ADD COLUMN ayanamsas TEXT;  -- {"YYYY-MM-DD": {"lahiri": 24.23, ...}}
