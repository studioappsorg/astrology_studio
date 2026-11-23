/**
 * AstrologyStudio ·
 * web/tests/aspects.test.ts
 *
 * Unit tests:
 *
 * aspect helpers.
 *
 * Copyright (c) 2026 Gavin Melhuish
 * MIT License; see LICENSE in the project root.
 * SPDX-License-Identifier: MIT
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aspectsBetween } from '../src/aspects';
import type { Point } from '../src/api';

const pt = (lon: number) => ({ lon } as Point);
const settings = { conjunction: { on: true, orb: 8 }, square: { on: true, orb: 6 }, trine: { on: false, orb: 8 }, semisquare: { on: true, orb: 2 } };

test('aspects between two charts use the profile orbs and skip aspects that are off', () => {
  const outer = { sun: pt(3), mars: pt(91) };
  const inner = { moon: pt(358), venus: pt(123) };
  const found = aspectsBetween(outer, ['sun', 'mars'], inner, ['moon', 'venus'], settings);
  assert.deepEqual(found.map((f) => [f.a, f.b, f.aspect]), [['mars', 'moon', 'square'], ['sun', 'moon', 'conjunction']]);
  assert.equal(found[1]!.orb, 5); // across 0° Aries
  assert.ok(!found.some((f) => f.aspect === 'trine')); // sun-venus trine is switched off
});

test('the closer aspect wins and results are sorted by orb', () => {
  const found = aspectsBetween({ a: pt(0) }, ['a'], { b: pt(46), c: pt(92) }, ['b', 'c'], { ...settings, square: { on: true, orb: 50 } });
  assert.deepEqual(found.map((f) => [f.b, f.aspect]), [['b', 'semisquare'], ['c', 'square']]);
});

test('keys missing from a chart are ignored', () => {
  assert.deepEqual(aspectsBetween({ sun: pt(0) }, ['sun', 'pluto'], {}, ['moon'], settings), []);
});
