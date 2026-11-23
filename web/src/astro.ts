/**
 * AstrologyStudio ·
 * web/src/astro.ts
 *
 * Zodiac formatting shared by every screen.
 *
 * Copyright (c) 2026 Gavin Melhuish
 * MIT License; see LICENSE in the project root.
 * SPDX-License-Identifier: MIT
 */

import { angle } from './fmt';

export const SIGNS = ['Aries', 'Taurus', 'Gemini', 'Cancer', 'Leo', 'Virgo', 'Libra', 'Scorpio', 'Sagittarius',
  'Capricorn', 'Aquarius', 'Pisces'] as const;
/** Each glyph carries U+FE0E so it draws as text, not as a coloured emoji. */
const SIGN_SYMBOLS = ['♈', '♉', '♊', '♋', '♌', '♍', '♎', '♏', '♐', '♑', '♒', '♓'].map((g) => `${g}\uFE0E`);
const SIGN_LETTERS = ['Ar', 'Ta', 'Ge', 'Cn', 'Le', 'Vi', 'Li', 'Sc', 'Sg', 'Cp', 'Aq', 'Pi'];
/** The sign marks in use: symbols, or two letters when Your view asks for letters. */
export const SIGN_GLYPHS = [...SIGN_SYMBOLS];

/** Two-letter marks for bodies and points, for when symbols don't suit. */
export const BODY_LETTERS: Record<string, string> = {
  sun: 'Su', moon: 'Mo', mercury: 'Me', venus: 'Ve', mars: 'Ma', jupiter: 'Ju', saturn: 'Sa', uranus: 'Ur',
  neptune: 'Ne', pluto: 'Pl', earth: 'Ea', chiron: 'Ch', ceres: 'Ce', pallas: 'Pa', juno: 'Jn', vesta: 'Vs',
  mean_node: 'Nn', true_node: 'TN', south_node: 'SN', mean_lilith: 'Li', true_lilith: 'TL', part_of_fortune: 'PF',
  asc: 'AC', mc: 'MC', vertex: 'Vx', east_point: 'EP', aries_point: 'AP',
  lot_spirit: 'Sp', lot_eros: 'Er', lot_necessity: 'Nc', lot_courage: 'Co', lot_victory: 'Vi', lot_nemesis: 'Nm',
};

export function setGlyphStyle(style: 'symbols' | 'letters'): void {
  const source = style === 'letters' ? SIGN_LETTERS : SIGN_SYMBOLS;
  source.forEach((g, i) => { SIGN_GLYPHS[i] = g; });
}
const ELEMENTS = ['fire', 'earth', 'air', 'water'] as const;

export const norm = (deg: number) => ((deg % 360) + 360) % 360;
export const signIndex = (lon: number) => Math.floor(norm(lon) / 30);
export const element = (sign: number) => ELEMENTS[sign % 4]!;

/** An angle as each person chooses to see them (see fmt.ts): 24°06' by default. Rounded down. */
export function dm(value: number): string {
  return angle(value);
}

/** A longitude within its sign: 24°06' ♓ */
export function zodiac(lon: number): string {
  const l = norm(lon);
  return `${dm(l % 30)} ${SIGN_GLYPHS[signIndex(l)]}`;
}

/** The same, with the sign spelt out: 24°06' Pisces */
export function zodiacLong(lon: number): string {
  const l = norm(lon);
  return `${dm(l % 30)} ${SIGNS[signIndex(l)]}`;
}

/** A plain longitude 0–360 in degrees and minutes: 354°06' */
export function degrees(lon: number): string {
  return dm(norm(lon));
}

export function signed(value: number | null, positive = 'N', negative = 'S'): string {
  if (value === null || Number.isNaN(value)) return '—';
  return `${dm(value)} ${value < 0 ? negative : positive}`;
}

export function offsetText(seconds: number | null): string {
  if (seconds === null) return '';
  const sign = seconds < 0 ? '−' : '+';
  const abs = Math.abs(seconds);
  return `UTC${sign}${String(Math.floor(abs / 3600)).padStart(2, '0')}:${String(Math.floor((abs % 3600) / 60)).padStart(2, '0')}`;
}

export const HOUSE_SYSTEM_NAMES: Record<string, string> = {
  placidus: 'Placidus', koch: 'Koch', regiomontanus: 'Regiomontanus', campanus: 'Campanus', equal: 'Equal',
  whole_sign: 'Whole Sign', porphyrius: 'Porphyry', topocentric: 'Topocentric', alcabitus: 'Alcabitus',
  meridian: 'Meridian', morinus: 'Morinus', vehlow_equal: 'Vehlow Equal',
};

/** Make a glyph draw as text rather than emoji. */
export const textGlyph = (glyph: string) => (glyph.length <= 2 && /\p{Extended_Pictographic}|[\u2600-\u26FF]/u.test(glyph) ? `${glyph}\uFE0E` : glyph);

/** Which house (1–12) a longitude falls in, given the twelve cusps. */
export function houseOf(lon: number, cusps: number[] | null): number | null {
  if (!cusps || cusps.length < 12) return null;
  const l = norm(lon);
  for (let i = 0; i < 12; i++) {
    const start = norm(cusps[i]!);
    const end = norm(cusps[(i + 1) % 12]!);
    const span = norm(end - start);
    if (norm(l - start) < span || span === 0) return i + 1;
  }
  return null;
}

type Dignity = 'domicile' | 'exaltation' | 'detriment' | 'fall';
// Sign numbers 0 = Aries … 11 = Pisces. Modern rulers for the outer planets.
const DIGNITIES: Record<string, Partial<Record<Dignity, number[]>>> = {
  sun: { domicile: [4], exaltation: [0], detriment: [10], fall: [6] },
  moon: { domicile: [3], exaltation: [1], detriment: [9], fall: [7] },
  mercury: { domicile: [2, 5], exaltation: [5], detriment: [8, 11], fall: [11] },
  venus: { domicile: [1, 6], exaltation: [11], detriment: [7, 0], fall: [5] },
  mars: { domicile: [0, 7], exaltation: [9], detriment: [6, 1], fall: [3] },
  jupiter: { domicile: [8, 11], exaltation: [3], detriment: [2, 5], fall: [9] },
  saturn: { domicile: [9, 10], exaltation: [6], detriment: [3, 4], fall: [0] },
  uranus: { domicile: [10], detriment: [4] },
  neptune: { domicile: [11], detriment: [5] },
  pluto: { domicile: [7], detriment: [1] },
};
const DIGNITY_LABEL: Record<Dignity, string> = { domicile: 'Dom', exaltation: 'Exalt', detriment: 'Detr', fall: 'Fall' };

/** Essential dignities of a planet in its sign, abbreviated: Dom, Exalt, Detr, Fall. */
export function dignities(body: string, lon: number): string {
  const table = DIGNITIES[body];
  if (!table) return '';
  const sign = signIndex(lon);
  return (Object.keys(DIGNITY_LABEL) as Dignity[]).filter((d) => table[d]?.includes(sign)).map((d) => DIGNITY_LABEL[d]).join(', ');
}

/** The same aspect list as the server's astro/aspects.py, for drawing. The quintile glyphs have no
 * Unicode character, so they sit in the private use area of the symbol font (fonts/make-glyph-font.py). */
export const ASPECT_INFO: Record<string, { name: string; glyph: string; kind: 'hard' | 'soft' | 'neutral'; major: boolean }> = {
  conjunction: { name: 'Conjunction', glyph: '☌', kind: 'neutral', major: true },
  opposition: { name: 'Opposition', glyph: '☍', kind: 'hard', major: true },
  trine: { name: 'Trine', glyph: '△', kind: 'soft', major: true },
  square: { name: 'Square', glyph: '□', kind: 'hard', major: true },
  sextile: { name: 'Sextile', glyph: '⚹', kind: 'soft', major: true },
  quincunx: { name: 'Quincunx', glyph: '⚻', kind: 'neutral', major: false },
  semisquare: { name: 'Semi-square', glyph: '∠', kind: 'hard', major: false },
  sesquiquadrate: { name: 'Sesquiquadrate', glyph: '⚼', kind: 'hard', major: false },
  semisextile: { name: 'Semi-sextile', glyph: '⚺', kind: 'soft', major: false },
  quintile: { name: 'Quintile', glyph: '\uE000', kind: 'soft', major: false },
  biquintile: { name: 'Biquintile', glyph: '\uE001', kind: 'soft', major: false },
};

// ---------------------------------------------------------------------------
// Midpoints and dials (the same rules as the server's astro/midpoints.py)

export function midpoint(a: number, b: number): number {
  let d = norm(b - a);
  if (d > 180) d -= 360;
  return norm(a + d / 2);
}

export function dialDistance(a: number, b: number, modulus: number, half = false): number {
  let d = (((a - b) % modulus) + modulus) % modulus;
  d = Math.min(d, modulus - d);
  if (half) d = Math.min(d, Math.abs(d - modulus / 2));
  return d;
}

export interface AxisItem { a: string; b: string | null; lon: number; orb: number }

export interface MidpointTree { factor: string; dial: number; items: AxisItem[] }

/**
 * Ebertin's midpoint trees: for each factor, the midpoints of other pairs on its axis on the
 * dial, closest first. Factors with none are left out.
 */
export function midpointTrees(points: Record<string, number>, orb: number, modulus: number, half: boolean): MidpointTree[] {
  const keys = Object.keys(points);
  const trees: MidpointTree[] = [];
  for (const f of keys) {
    const items: AxisItem[] = [];
    keys.forEach((a, i) => {
      if (a === f) return;
      for (const b of keys.slice(i + 1)) {
        if (b === f) continue;
        const m = midpoint(points[a]!, points[b]!);
        const d = dialDistance(m, points[f]!, modulus, half);
        if (d <= orb) items.push({ a, b, lon: m, orb: d });
      }
    });
    if (items.length) trees.push({ factor: f, dial: ((points[f]! % modulus) + modulus) % modulus, items: items.sort((x, y) => x.orb - y.orb) });
  }
  return trees;
}

/** Factors and midpoints on the axis of `target` on a dial, closest first. */
export function onAxis(points: Record<string, number>, target: number, orb: number, modulus: number, half: boolean): AxisItem[] {
  const keys = Object.keys(points);
  const out: AxisItem[] = [];
  keys.forEach((a, i) => {
    const d = dialDistance(points[a]!, target, modulus, half);
    if (d <= orb) out.push({ a, b: null, lon: points[a]!, orb: d });
    for (const b of keys.slice(i + 1)) {
      const m = midpoint(points[a]!, points[b]!);
      const dm2 = dialDistance(m, target, modulus, half);
      if (dm2 <= orb) out.push({ a, b, lon: m, orb: dm2 });
    }
  });
  return out.sort((x, y) => x.orb - y.orb);
}

export interface SortRow { a: string; b: string | null; lon: number; dial: number }

/** Ebertin's midpoint sort: every factor and every midpoint, in order round the dial. */
export function midpointSort(points: Record<string, number>, modulus: number): SortRow[] {
  const keys = Object.keys(points);
  const at = (lon: number) => ((norm(lon) % modulus) + modulus) % modulus;
  const rows: SortRow[] = keys.map((a) => ({ a, b: null, lon: norm(points[a]!), dial: at(points[a]!) }));
  keys.forEach((a, i) => {
    for (const b of keys.slice(i + 1)) {
      const m = midpoint(points[a]!, points[b]!);
      rows.push({ a, b, lon: m, dial: at(m) });
    }
  });
  return rows.sort((x, y) => x.dial - y.dial || (x.b === null ? -1 : 1));
}

/** A degree typed in: 12.5, 12°30', or 12°30' Leo (a longitude), as 0–360. Null if it isn't one. */
export function parseDegree(text: string): number | null {
  const t = text.trim();
  if (!t) return null;
  const m = /^(\d{1,3})(?:[.,](\d+))?\s*°?\s*(?:(\d{1,2})\s*'?)?\s*(.*)$/.exec(t);
  if (!m) return null;
  let deg = Number(m[1]) + (m[2] ? Number(`0.${m[2]}`) : 0) + (m[3] ? Number(m[3]) / 60 : 0);
  const sign = m[4]!.trim().toLowerCase();
  if (sign) {
    const names = ['aries', 'taurus', 'gemini', 'cancer', 'leo', 'virgo', 'libra', 'scorpio', 'sagittarius', 'capricorn', 'aquarius', 'pisces'];
    let index = names.findIndex((n) => n.startsWith(sign.slice(0, 3)));
    if (index < 0) index = SIGN_GLYPHS.findIndex((g) => g.startsWith(sign[0]!));
    if (index < 0) return null;
    deg += index * 30;
  }
  return deg >= 0 && deg < 360 ? deg : null;
}
