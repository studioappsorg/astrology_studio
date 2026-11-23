-- AstrologyStudio ·
-- server/astrologystudio/migrations/006_kept_derived.sql
--
-- 006: composite and Davison charts you make are kept with the chart they were made from, so they
-- appear under it in your chart list. They're worked out from the two charts each time they're
-- shown; only what they are is kept here.
--
-- Copyright (c) 2026 Gavin Melhuish
-- MIT License; see LICENSE in the project root.
-- SPDX-License-Identifier: MIT

CREATE TABLE kept_derived (
    user_id     TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    id          TEXT NOT NULL,            -- e.g. composite~{chart id}~{other chart id}
    parent_id   TEXT NOT NULL,            -- the chart it was made from (the "From" chart)
    other_id    TEXT NOT NULL,            -- the second chart
    kind        TEXT NOT NULL,            -- 'composite' or 'davison'
    name        TEXT NOT NULL,
    created_at  TEXT NOT NULL,
    PRIMARY KEY (user_id, id)
);
CREATE INDEX kept_derived_by_parent ON kept_derived (user_id, parent_id);
