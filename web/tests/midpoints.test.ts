/**
 * AstrologyStudio ·
 * web/tests/midpoints.test.ts
 *
 * Unit tests:
 *
 * midpoints and the midpoint sort.
 *
 * Copyright (c) 2026 Gavin Melhuish
 * MIT License; see LICENSE in the project root.
 * SPDX-License-Identifier: MIT
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { midpointSort, onAxis, parseDegree } from '../src/astro';

const lons = { sun: 10, moon: 100, mars: 200 };

test('the midpoint sort has every factor and midpoint, in order round the dial', () => {
  const rows = midpointSort(lons, 90);
  assert.equal(rows.length, 3 + 3);
  assert.deepEqual(rows.map((r) => r.dial), [...rows.map((r) => r.dial)].sort((a, b) => a - b));
  const sunMoon = rows.find((r) => r.a === 'sun' && r.b === 'moon')!;
  assert.equal(sunMoon.lon, 55);
  assert.equal(sunMoon.dial, 55);
  const moonMars = rows.find((r) => r.a === 'moon' && r.b === 'mars')!;
  assert.equal(moonMars.dial, 150 % 90);
  assert.ok(rows.every((r) => r.dial >= 0 && r.dial < 90));
});

test('search finds what is on a degree’s axis', () => {
  const found = onAxis(lons, 55.5, 1, 90, true);
  assert.ok(found.some((r) => r.a === 'sun' && r.b === 'moon'));
  assert.ok(found.every((r) => r.orb <= 1));
});

test('degrees can be typed in several ways', () => {
  assert.equal(parseDegree('12.5'), 12.5);
  assert.equal(parseDegree("12°30'"), 12.5);
  assert.equal(parseDegree("12°30' Leo"), 132.5);
  assert.equal(parseDegree('400'), null);
  assert.equal(parseDegree(''), null);
});
