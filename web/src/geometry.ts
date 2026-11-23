/**
 * AstrologyStudio ·
 * web/src/geometry.ts
 *
 * Pure geometry for wheels and dials, with no browser or app state, so it can be unit-tested:
 * spreading symbols apart, a dial's graduation, and which dial sizes are allowed.
 *
 * Copyright (c) 2026 Gavin Melhuish
 * MIT License; see LICENSE in the project root.
 * SPDX-License-Identifier: MIT
 */

import { norm } from './astro';

/** A dial size in degrees: any that divides the circle evenly, from 360° down to 5.625°. */
export type DialModulus = number;

export const MIN_DIAL = 5.625;
export const isModulus = (v: unknown): v is DialModulus =>
  typeof v === 'number' && v >= MIN_DIAL && v <= 360 && Math.abs(360 / v - Math.round(360 / v)) < 1e-9;
/** The sizes offered first in Your view. */
export const DIAL_MODULI: DialModulus[] = [360, 180, 120, 90, 45, 30, 22.5, 11.25];
/** How a size is written: 22.5°, 90°. */
export const sizeLabel = (m: number) => `${Number(m.toFixed(4))}°`;

/** Spread glyphs so they don't overlap, keeping each as near its true longitude as possible. */
export function spread(lons: number[], minGap: number): number[] {
  const n = lons.length;
  if (n < 2) return [...lons];
  const order = lons.map((l, i) => [norm(l), i] as const).sort((x, y) => x[0] - y[0]);
  // Start the run after the widest empty gap, so clusters never straddle the cut.
  let cut = 0;
  let widest = -1;
  for (let k = 0; k < n; k++) {
    const gap = norm(order[(k + 1) % n]![0] - order[k]![0]) || 360;
    if (gap > widest) { widest = gap; cut = (k + 1) % n; }
  }
  const seq = Array.from({ length: n }, (_, k) => order[(cut + k) % n]!);
  const base = seq[0]![0];
  const want = seq.map(([l]) => norm(l - base));
  const pos = [...want];
  for (let iter = 0; iter < 60; iter++) {
    let moved = false;
    for (let k = 1; k < n; k++) {
      const overlap = minGap - (pos[k]! - pos[k - 1]!);
      if (overlap > 0.001) { pos[k - 1]! -= overlap / 2; pos[k]! += overlap / 2; moved = true; }
    }
    // Pull back towards the true positions where there's room.
    for (let k = 0; k < n; k++) {
      const lo = k > 0 ? pos[k - 1]! + minGap : -Infinity;
      const hi = k < n - 1 ? pos[k + 1]! - minGap : Infinity;
      pos[k] = Math.min(Math.max(want[k]!, lo), hi);
    }
    if (!moved) break;
  }
  // Centre each crowded run on its true positions: pushing apart from one end leaves a run
  // shifted to one side. Move the run as a whole, as far as its neighbours allow.
  for (let start = 0; start < n;) {
    let end = start;
    while (end + 1 < n && pos[end + 1]! - pos[end]! <= minGap + 1e-6) end++;
    if (end > start) {
      let shift = 0;
      for (let k = start; k <= end; k++) shift += want[k]! - pos[k]!;
      shift /= end - start + 1;
      const room = shift > 0
        ? (end + 1 < n ? pos[end + 1]! - minGap - pos[end]! : Infinity)
        : (start > 0 ? pos[start]! - (pos[start - 1]! + minGap) : Infinity);
      const move = Math.sign(shift) * Math.min(Math.abs(shift), Math.max(0, room));
      for (let k = start; k <= end; k++) pos[k]! += move;
    }
    start = end + 1;
  }
  const out = new Array<number>(n);
  seq.forEach(([, original], k) => { out[original] = norm(pos[k]! + base); });
  return out;
}

const STEPS = [0.0625, 0.125, 0.25, 0.5, 1, 2, 5, 10];
const LONGS = [0.25, 0.5, 1, 2, 2.5, 5, 10, 15, 30];

/** Graduation steps: [tick every, long tick and number every], in dial degrees. About 90–130
 * ticks whatever the size: 1° and 5° on the 90° and 120° dials, 5° and 30° on the 360° dial. */
export function steps(modulus: number, scale: 'normal' | 'sparse' | 'dense' = 'normal'): [number, number] {
  let step: number;
  let long: number;
  if (modulus === 360) [step, long] = [5, 30];
  else {
    step = STEPS.find((x) => modulus / x <= 130) ?? 10;
    long = LONGS.find((x) => x >= step * 4 && Math.abs(x / step - Math.round(x / step)) < 1e-9) ?? step * 5;
  }
  if (scale === 'dense') step /= 2;
  if (scale === 'sparse') step = long;
  return [step, long];
}

