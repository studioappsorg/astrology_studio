/**
 * AstrologyStudio ·
 * web/tests/geometry.test.ts
 *
 * Unit tests:
 *
 * wheel and dial geometry.
 *
 * Copyright (c) 2026 Gavin Melhuish
 * MIT License; see LICENSE in the project root.
 * SPDX-License-Identifier: MIT
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isModulus, sizeLabel, spread, steps } from '../src/geometry';
import { norm } from '../src/astro';

test('dial sizes divide the circle evenly, from 360° down to 5.625°', () => {
  for (const m of [360, 180, 120, 90, 72, 45, 30, 22.5, 11.25, 5.625]) assert.ok(isModulus(m), String(m));
  for (const m of [50, 100, 2.8125, 400, 0, '90', null]) assert.ok(!isModulus(m), String(m));
  assert.equal(sizeLabel(22.5), '22.5°');
  assert.equal(sizeLabel(5.625), '5.625°');
  assert.equal(sizeLabel(90), '90°');
});

test('the graduation keeps today’s dials and suits any size', () => {
  assert.deepEqual(steps(360), [5, 30]);
  assert.deepEqual(steps(90), [1, 5]);
  assert.deepEqual(steps(120), [1, 5]);
  for (const m of [180, 72, 45, 30, 22.5, 11.25, 5.625]) {
    const [step, long] = steps(m);
    const ticks = m / step;
    assert.ok(ticks >= 40 && ticks <= 130, `${m}: ${ticks} ticks`);
    assert.ok(Math.abs(long / step - Math.round(long / step)) < 1e-9, `${m}: long ${long} is a multiple of ${step}`);
  }
  assert.deepEqual(steps(90, 'sparse'), [5, 5]);
  assert.deepEqual(steps(90, 'dense'), [0.5, 5]);
});

test('spread keeps symbols apart and near where they belong', () => {
  const lons = [10, 11, 12, 200];
  const shown = spread(lons, 6);
  const sorted = [...shown].sort((a, b) => a - b);
  for (let i = 1; i < 3; i++) assert.ok(sorted[i]! - sorted[i - 1]! >= 6 - 1e-6, 'at least the gap apart');
  assert.equal(shown[3], 200);
  assert.ok(Math.abs(shown[1]! - 11) < 1e-6, 'the middle one stays put');
  // Across 0° Aries: a cluster either side of the cut is still spread as one.
  const across = spread([358, 359, 1], 4).map(norm);
  const gaps = across.map((a, i) => Math.abs(((a - across[(i + 1) % 3]! + 540) % 360) - 180));
  assert.ok(gaps.every((g) => g >= 4 - 1e-6), `gaps ${gaps}`);
  assert.deepEqual(spread([5], 9), [5]);
});
