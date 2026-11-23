-- AstrologyStudio ·
-- server/astrologystudio/migrations/003_ephemeris_cache.sql
--
-- 003: months of ephemeralREST's daily ephemeris, kept for transits, progressions and event
-- lists. A month's positions never change, so it is fetched once and shared by everyone.
--
-- Copyright (c) 2026 Gavin Melhuish
-- MIT License; see LICENSE in the project root.
-- SPDX-License-Identifier: MIT

CREATE TABLE ephemeris_months (
    year       INTEGER NOT NULL,
    month      INTEGER NOT NULL,
    data       TEXT NOT NULL,   -- {"YYYY-MM-DD": {body: {lon, lat, speed, decl}}} at noon UT
    fetched_at TEXT NOT NULL,
    PRIMARY KEY (year, month)
);
