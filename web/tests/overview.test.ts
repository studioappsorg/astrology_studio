/**
 * AstrologyStudio ·
 * web/tests/overview.test.ts
 *
 * Unit tests:
 *
 * the chart overview: elements and modalities, the chart signature, houses, the Moon's phase,
 * chart shapes, aspect patterns, stelliums and rulerships. Jane Doe is the real chart for
 * 12 June 1985, 14:30, Perth (the e2e tests' and the book's example).
 *
 * Copyright (c) 2026 Gavin Melhuish
 * MIT License; see LICENSE in the project root.
 * SPDX-License-Identifier: MIT
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { FoundAspect, Point } from '../src/api';
import {
  balance, emphasis, houses, isDayChart, moonPhase, patterns, PLANETS, rulership, shape, signFor, stelliums, unaspected,
} from '../src/overview';

const JANE: Record<string, number> = {
  sun: 81.235, moon: 12.45, mercury: 86.996, venus: 35.489, mars: 91.883, jupiter: 316.878, saturn: 232.9,
  uranus: 255.765, neptune: 272.549, pluto: 212.17, chiron: 69.833, mean_node: 46.555, asc: 214.435, mc: 112.117,
};
const CUSPS = [214.435, 245.14, 269.194, 292.117, 318.158, 351.89, 34.435, 65.14, 89.194, 112.117, 138.158, 171.891];
const point = (lon: number): Point => ({ lon, lat: 0, speed: 1, decl: null, ra: null, retro: false });
const points = Object.fromEntries(Object.entries(JANE).map(([k, v]) => [k, point(v)]));
const shown = Object.keys(JANE);
const asp = (a: string, b: string, aspect: string): FoundAspect => ({ a, b, aspect, orb: 1, applying: null });
const ASPECTS = [
  asp('mars', 'pluto', 'trine'), asp('neptune', 'pluto', 'sextile'), asp('mars', 'neptune', 'opposition'),
  asp('venus', 'pluto', 'opposition'), asp('venus', 'mars', 'sextile'), asp('venus', 'neptune', 'trine'),
  asp('jupiter', 'saturn', 'square'), asp('sun', 'uranus', 'opposition'), asp('sun', 'jupiter', 'trine'),
  asp('moon', 'uranus', 'trine'), asp('moon', 'jupiter', 'sextile'), asp('sun', 'mercury', 'conjunction'),
  asp('sun', 'saturn', 'quincunx'), asp('mercury', 'mars', 'conjunction'),
];

test('every element and modality meets in exactly one sign', () => {
  assert.equal(signFor(3, 1), 7); // fixed water: Scorpio
  assert.equal(signFor(0, 0), 0); // cardinal fire: Aries
  assert.equal(signFor(2, 2), 2); // mutable air: Gemini
  const all = new Set([0, 1, 2, 3].flatMap((e) => [0, 1, 2].map((m) => signFor(e, m))));
  assert.equal(all.size, 12);
});

test("Jane's balance: air and water lead, fixed leads, so the signature is Aquarius or Scorpio", () => {
  const b = balance(points, shown, 'planets');
  assert.equal(b.total, 10);
  assert.deepEqual(b.elements.map((e) => e.score), [2, 2, 3, 3]);
  assert.deepEqual(b.modalities.map((m) => m.score), [3, 4, 3]);
  assert.deepEqual(b.signature, { elements: [2, 3], modalities: [1], signs: [7, 10] });
  assert.deepEqual(b.grid[3]![1], ['saturn', 'pluto']);
  assert.deepEqual(b.polarity, { active: 5, receptive: 5 });
  assert.deepEqual(b.missing, { elements: [], modalities: [] });
});

test('counting the angles, or weighting, changes the balance', () => {
  const angles = balance(points, shown, 'angles');
  assert.equal(angles.total, 12);
  assert.deepEqual(angles.elements.map((e) => e.score), [2, 2, 3, 5]); // Asc in Scorpio, MC in Cancer
  assert.deepEqual(angles.signature.signs, [7]); // now clearly fixed water: Scorpio
  const weighted = balance(points, shown, 'weighted');
  assert.equal(weighted.total, 15); // Sun, Moon and Asc count twice
  assert.equal(weighted.elements[0]!.score, 3); // the Moon (x2) and Uranus in fire
});

test('planets switched off in My View are not counted', () => {
  const b = balance(points, shown.filter((k) => k !== 'pluto'), 'planets');
  assert.equal(b.total, 9);
  assert.equal(b.elements[3]!.score, 2);
});

test('missing elements and singletons', () => {
  const lons = { sun: 0, moon: 10, mercury: 20, venus: 120, mars: 130, jupiter: 240, saturn: 250, uranus: 40, neptune: 45, pluto: 50 };
  const b = balance(Object.fromEntries(Object.entries(lons).map(([k, v]) => [k, point(v)])), PLANETS, 'planets');
  assert.deepEqual(b.missing.elements, [2, 3]); // no air, no water
  assert.ok(b.singletons.length === 0);
  const solo = balance({ ...points, moon: point(100) }, shown, 'planets'); // Moon into Cancer: Uranus alone in fire
  assert.ok(solo.singletons.some((s) => s.key === 'uranus' && s.kind === 'element' && s.index === 0));
  assert.equal(emphasis(0, 10, 4), 'missing');
  assert.equal(emphasis(5, 10, 4), 'strong');
  assert.equal(emphasis(1, 10, 4), 'weak');
  assert.equal(emphasis(3, 10, 3), 'average');
});

test("Jane's houses: a day chart, mostly above the horizon", () => {
  const h = houses(points, shown, CUSPS);
  assert.equal(h.houseOf.sun, 8);
  assert.equal(h.houseOf.saturn, 1);
  assert.equal(h.above.length + h.below.length, 10);
  assert.ok(h.above.includes('sun') && h.below.includes('saturn'));
  assert.equal(h.angular.length + h.succedent.length + h.cadent.length, 10);
  assert.ok(isDayChart(JANE.sun!, CUSPS));
});

test('the Moon phase is the Moon\'s distance ahead of the Sun', () => {
  assert.equal(moonPhase(JANE.sun!, JANE.moon!).name, 'Last quarter');
  assert.equal(moonPhase(10, 15).name, 'New');
  assert.deepEqual(moonPhase(10, 200), { name: 'Full', angle: 190, waxing: false });
  assert.equal(moonPhase(350, 50).name, 'Crescent');
});

test('chart shapes', () => {
  const planetsOf = (r: Record<string, number>) => Object.fromEntries(PLANETS.filter((k) => r[k] !== undefined).map((k) => [k, r[k]!]));
  assert.deepEqual(shape(planetsOf(JANE)), { name: 'Locomotive', key: 'pluto', role: 'leading' });
  const spread = (lons: number[]) => Object.fromEntries(lons.map((l, i) => [PLANETS[i]!, l]));
  assert.equal(shape(spread([0, 10, 20, 30, 40, 50, 60, 70, 80, 100]))!.name, 'Bundle');
  const bowl = shape(spread([100, 110, 130, 150, 170, 190, 210, 230, 250, 270]))!;
  assert.deepEqual(bowl, { name: 'Bowl', key: 'sun', role: 'leading' });
  assert.deepEqual(shape(spread([0, 20, 40, 60, 80, 100, 120, 140, 160, 270])), { name: 'Bucket', key: 'pluto', role: 'handle' });
  assert.equal(shape(spread([0, 10, 20, 30, 40, 180, 190, 200, 210, 220]))!.name, 'Seesaw');
  assert.equal(shape(spread([0, 36, 72, 108, 144, 180, 216, 252, 288, 324]))!.name, 'Splash');
});

test("Jane's patterns: a mystic rectangle of Venus, Mars, Neptune and Pluto", () => {
  const found = patterns([...PLANETS, 'asc', 'mc'], ASPECTS);
  const rect = found.filter((p) => p.name === 'Mystic rectangle');
  assert.equal(rect.length, 1);
  assert.deepEqual([...rect[0]!.keys].sort(), ['mars', 'neptune', 'pluto', 'venus']);
  // Grand trine and T-square and yod on made-up aspects.
  const made = [asp('sun', 'moon', 'trine'), asp('moon', 'mars', 'trine'), asp('sun', 'mars', 'trine'),
    asp('venus', 'jupiter', 'opposition'), asp('venus', 'saturn', 'square'), asp('jupiter', 'saturn', 'square'),
    asp('uranus', 'neptune', 'sextile'), asp('uranus', 'pluto', 'quincunx'), asp('neptune', 'pluto', 'quincunx')];
  const names = patterns(PLANETS, made).map((p) => `${p.name}:${p.apex ?? ''}`).sort();
  assert.deepEqual(names, ['Grand trine:', 'T-square:saturn', 'Yod:pluto']);
});

test('a grand cross is not also reported as four T-squares', () => {
  const made = [asp('sun', 'moon', 'opposition'), asp('mars', 'venus', 'opposition'),
    asp('sun', 'mars', 'square'), asp('sun', 'venus', 'square'), asp('moon', 'mars', 'square'), asp('moon', 'venus', 'square')];
  assert.deepEqual(patterns(PLANETS, made).map((p) => p.name), ['Grand cross']);
});

test('stelliums and unaspected planets', () => {
  assert.deepEqual(stelliums({ sun: 2, mercury: 2, mars: 2, venus: 3 }), [{ at: 2, keys: ['sun', 'mercury', 'mars'] }]);
  assert.deepEqual(stelliums({ sun: 2, mercury: 2 }), []);
  assert.deepEqual(unaspected(['sun', 'venus'], [...PLANETS], [asp('sun', 'moon', 'trine'), asp('venus', 'mars', 'quincunx')]), ['venus']);
});

test("Jane's rulerships: mutual receptions, and no final dispositor", () => {
  const r = rulership(JANE, 'modern');
  assert.equal(r.dispositor.sun, 'mercury');
  assert.deepEqual(r.own.sort(), ['mercury', 'pluto', 'venus']); // Pluto rules Scorpio in modern astrology
  assert.deepEqual(r.receptions, [['moon', 'mars'], ['jupiter', 'uranus']]);
  assert.deepEqual(rulership(JANE, 'traditional').receptions, [['moon', 'mars']]); // Aquarius is Saturn's: no Jupiter–Uranus
  assert.equal(r.final, null);
  const one = rulership({ sun: 70, moon: 75, mercury: 80, venus: 85, mars: 65 }, 'traditional'); // all in Gemini
  assert.equal(one.final, 'mercury');
});
