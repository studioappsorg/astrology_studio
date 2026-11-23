/**
 * AstrologyStudio ·
 * web/src/aspects.ts
 *
 * Aspects between two charts (synastry), worked out here from their positions so they work for
 * any two charts on the wheel: saved, transits, returns, harmonic, composite or Davison. Orbs and
 * which aspects count come from the active calculation profile. Pure, so it can be unit-tested.
 *
 * Copyright (c) 2026 Gavin Melhuish
 * MIT License; see LICENSE in the project root.
 * SPDX-License-Identifier: MIT
 */

import type { FoundAspect, Point } from './api';
import { norm } from './astro';

/** The angle of each aspect, by key (as the server's aspects.py). */
export const ASPECT_ANGLES: Record<string, number> = {
  conjunction: 0, opposition: 180, trine: 120, square: 90, sextile: 60, quincunx: 150,
  semisquare: 45, sesquiquadrate: 135, semisextile: 30, quintile: 72, biquintile: 144,
};

export type AspectSettings = Record<string, { on: boolean; orb: number }>;

/**
 * Every aspect from a body in `outer` to a body in `inner`, within its orb: `a` is the outer
 * chart's body, `b` the inner chart's (the order the wheel's cross lines and the square grid use).
 * Where two aspects fit, the closer one counts. Applying or separating isn't worked out.
 */
export function aspectsBetween(
  outer: Record<string, Point>, outerKeys: string[], inner: Record<string, Point>, innerKeys: string[], settings: AspectSettings,
): FoundAspect[] {
  const wanted = Object.entries(ASPECT_ANGLES).filter(([key]) => settings[key]?.on);
  const found: FoundAspect[] = [];
  for (const a of outerKeys) {
    const pa = outer[a];
    if (!pa) continue;
    for (const b of innerKeys) {
      const pb = inner[b];
      if (!pb) continue;
      const d = norm(pa.lon - pb.lon);
      const sep = d > 180 ? 360 - d : d;
      let best: FoundAspect | null = null;
      for (const [key, angle] of wanted) {
        const orb = Math.abs(sep - angle);
        if (orb <= settings[key]!.orb && (!best || orb < best.orb)) best = { a, b, aspect: key, orb, applying: null };
      }
      if (best) found.push(best);
    }
  }
  return found.sort((x, y) => x.orb - y.orb);
}
