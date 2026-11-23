/**
 * AstrologyStudio ·
 * web/src/colour.ts
 *
 * Colour arithmetic for the theme editor:
 *
 * contrast ratios (WCAG 2) and working out a theme's other version (light from dark, or dark from
 * light). Pure, so it can be unit-tested.
 *
 * Copyright (c) 2026 Gavin Melhuish
 * MIT License; see LICENSE in the project root.
 * SPDX-License-Identifier: MIT
 */

export type Mode = 'light' | 'dark';

export function luminance(hex: string): number {
  const v = hex.replace('#', '').slice(0, 6);
  const c = [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16) / 255).map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
}

export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x! + 0.05) / (y! + 0.05);
}

// ---------------------------------------------------------------------------
// "Make dark from light": the same hues with lightness turned over, as a starting point.

export function toHsl(hex: string): [number, number, number] {
  const v = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16) / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

export function fromHsl(h: number, s: number, l: number): string {
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    return Math.round((l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))) * 255).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

/** Backgrounds swap lightness outright; ink (text, lines, aspects) is lightened or darkened to stay readable. */
const BACKGROUNDS = new Set(['canvas', 'chart-bg', 'dial-bg', 'fire', 'earth', 'air', 'water', 'cardinal', 'fixed', 'mutable',
  'aries', 'taurus', 'gemini', 'cancer', 'leo', 'virgo', 'libra', 'scorpio', 'sagittarius', 'capricorn', 'aquarius', 'pisces', 'faint']);

export function flipped(colours: Record<string, string>, to: Mode): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, hex] of Object.entries(colours)) {
    const [h, s, l] = toHsl(hex);
    let next: number;
    if (BACKGROUNDS.has(k)) next = 1 - l;
    else next = to === 'dark' ? Math.max(l, 1 - l, 0.62) : Math.min(l, 1 - l, 0.42);
    if (k === 'angle-text') next = l; // badge text keeps its contrast with the badge
    out[k] = fromHsl(h, s, Math.min(0.97, Math.max(0.05, next)));
  }
  return out;
}

