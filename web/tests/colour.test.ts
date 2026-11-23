/**
 * AstrologyStudio ·
 * web/tests/colour.test.ts
 *
 * Unit tests:
 *
 * colour helpers used by themes.
 *
 * Copyright (c) 2026 Gavin Melhuish
 * MIT License; see LICENSE in the project root.
 * SPDX-License-Identifier: MIT
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contrast, flipped, fromHsl, toHsl } from '../src/colour';

test('contrast ratios match WCAG', () => {
  assert.equal(Math.round(contrast('#000000', '#ffffff') * 10) / 10, 21);
  assert.equal(contrast('#777777', '#777777'), 1);
  assert.ok(contrast('#2a3442', '#fbfbfc') > 4.5, 'Studio text on the chart is readable');
});

test('hsl round trip', () => {
  for (const hex of ['#b4532f', '#2c6fb3', '#ffffff', '#000000', '#7d5ba6']) {
    const [h, s, l] = toHsl(hex);
    const back = fromHsl(h, s, l);
    const diff = [0, 2, 4].map((i) => Math.abs(parseInt(back.slice(1 + i, 3 + i), 16) - parseInt(hex.slice(1 + i, 3 + i), 16)));
    assert.ok(Math.max(...diff) <= 1, `${hex} -> ${back}`);
  }
});

test('a dark version from a light one turns backgrounds dark and keeps text readable', () => {
  const dark = flipped({ 'chart-bg': '#fbfbfc', text: '#2a3442', fire: '#f6e3dc' }, 'dark');
  assert.ok(toHsl(dark['chart-bg']!)[2] < 0.1);
  assert.ok(toHsl(dark.fire!)[2] < 0.3);
  assert.ok(contrast(dark.text!, dark['chart-bg']!) >= 4.5);
});
