/**
 * AstrologyStudio ·
 * web/src/sample.ts
 *
 * A made-up chart for previews in Your view (theme and layout editors and the theme gallery),
 * so they can be shown before any chart is opened and look the same for everyone.
 *
 * Copyright (c) 2026 Gavin Melhuish
 * MIT License; see LICENSE in the project root.
 * SPDX-License-Identifier: MIT
 */

import type { FoundAspect, Point } from './api';
import { ASPECT_INFO, norm } from './astro';

const LONS: Record<string, [number, boolean]> = {
  sun: [81.2, false], moon: [192.5, false], mercury: [64.8, false], venus: [37.3, false], mars: [148.9, false],
  jupiter: [281.7, true], saturn: [233.4, true], uranus: [266.1, true], neptune: [302.8, true], pluto: [214.6, true],
  true_node: [10.4, true], asc: [127.6, false], mc: [18.9, false],
};

const point = (lon: number, retro: boolean): Point => ({ lon, lat: 0, speed: retro ? -0.05 : 0.5, decl: null, ra: null, retro });

export const SAMPLE_POINTS: Record<string, Point> = Object.fromEntries(Object.entries(LONS).map(([k, [lon, r]]) => [k, point(lon, r)]));
export const SAMPLE_KEYS = Object.keys(LONS);
/** Placidus-like cusps, near enough for a preview. */
export const SAMPLE_HOUSES = [127.6, 152.1, 180.4, 198.9, 228.2, 262.5, 307.6, 332.1, 0.4, 18.9, 48.2, 92.5];

const ANGLES: Array<[string, number, number]> = [
  ['conjunction', 0, 7], ['opposition', 180, 7], ['trine', 120, 6], ['square', 90, 6], ['sextile', 60, 4],
  ['quincunx', 150, 2.5], ['semisquare', 45, 1.5], ['sesquiquadrate', 135, 1.5],
];

export const SAMPLE_ASPECTS: FoundAspect[] = (() => {
  const keys = SAMPLE_KEYS.filter((k) => k !== 'asc' && k !== 'mc');
  const found: FoundAspect[] = [];
  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < keys.length; j++) {
      const d = norm(LONS[keys[i]!]![0] - LONS[keys[j]!]![0]);
      const sep = d > 180 ? 360 - d : d;
      for (const [aspect, angle, orb] of ANGLES) {
        if (Math.abs(sep - angle) <= orb && ASPECT_INFO[aspect]) {
          found.push({ a: keys[i]!, b: keys[j]!, aspect, orb: Math.abs(sep - angle), applying: null });
        }
      }
    }
  }
  return found;
})();

/** A second chart (transits, say) for previews of chart 2's colour. */
export const SAMPLE_OUTER: Record<string, Point> = Object.fromEntries(
  ['sun', 'moon', 'mars', 'jupiter', 'saturn'].map((k, i) => [k, point(norm(LONS[k]![0] + 37 + i * 23), false)]),
);
