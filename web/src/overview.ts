/**
 * AstrologyStudio ·
 * web/src/overview.ts
 *
 * The chart overview (the Overview tab and the client sheet):
 *
 * the basics an astrologer reads first. The balance of elements (triplicities) and modalities
 * (quadruplicities) and the chart signature they point to; polarity; hemispheres, quadrants and
 * house types; the Sun, Moon and rising sign, the chart ruler, the Moon's phase and sect; the
 * chart's shape; stelliums, aspect patterns and unaspected planets; dignities, mutual receptions
 * and the final dispositor. Pure, so it can be unit-tested.
 *
 * Copyright (c) 2026 Gavin Melhuish
 * MIT License; see LICENSE in the project root.
 * SPDX-License-Identifier: MIT
 */

import type { FoundAspect, Point } from './api';
import { dignities, houseOf, norm, signIndex } from './astro';

export const PLANETS = ['sun', 'moon', 'mercury', 'venus', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune', 'pluto'];
const SEVEN = PLANETS.slice(0, 7);
export const ELEMENT_NAMES = ['Fire', 'Earth', 'Air', 'Water'] as const;
export const MODALITY_NAMES = ['Cardinal', 'Fixed', 'Mutable'] as const;
export const SIGN_NAMES = ['Aries', 'Taurus', 'Gemini', 'Cancer', 'Leo', 'Virgo', 'Libra', 'Scorpio', 'Sagittarius',
  'Capricorn', 'Aquarius', 'Pisces'];

/** How the balance is counted: the ten planets; with the Ascendant and MC; or weighted, the
 * Sun, Moon and Ascendant counting twice. */
export type Counting = 'planets' | 'angles' | 'weighted';
export const isCounting = (v: unknown): v is Counting => v === 'planets' || v === 'angles' || v === 'weighted';
export const COUNTING_LABELS: Record<Counting, string> = {
  planets: 'Ten planets',
  angles: 'Planets, AC and MC',
  weighted: 'Weighted',
};
export const COUNTING_NOTES: Record<Counting, string> = {
  planets: 'the ten planets, one each',
  angles: 'the ten planets, the Ascendant and the MC, one each',
  weighted: 'the ten planets, the Ascendant and the MC, with the Sun, Moon and Ascendant counting twice',
};

export type Rulers = 'modern' | 'traditional';
export const isRulers = (v: unknown): v is Rulers => v === 'modern' || v === 'traditional';
const TRADITIONAL_RULERS = ['mars', 'venus', 'mercury', 'moon', 'sun', 'mercury', 'venus', 'mars', 'jupiter', 'saturn', 'saturn', 'jupiter'];
const MODERN_RULERS = TRADITIONAL_RULERS.map((r, i) => (i === 7 ? 'pluto' : i === 10 ? 'uranus' : i === 11 ? 'neptune' : r));
export const rulerOf = (sign: number, rulers: Rulers) => (rulers === 'modern' ? MODERN_RULERS : TRADITIONAL_RULERS)[sign]!;

export const elementOf = (sign: number) => sign % 4;
export const modalityOf = (sign: number) => sign % 3;
/** The one sign with this element and modality (fixed water is Scorpio). */
export const signFor = (el: number, mod: number) => [...Array(12).keys()].find((s) => s % 4 === el && s % 3 === mod)!;

export interface Share { score: number; keys: string[] }

export interface Balance {
  counting: Counting;
  total: number;
  elements: Share[];
  modalities: Share[];
  /** elements × modalities: who is in, say, fixed water. */
  grid: string[][][];
  /** Fire and air (active, outgoing) against earth and water (receptive, inward). */
  polarity: { active: number; receptive: number };
  /** The leading element(s) and modality(ies), and the sign(s) where they meet. More than one
   * when there's a tie. */
  signature: { elements: number[]; modalities: number[]; signs: number[] };
  /** Elements and modalities with nothing in them. */
  missing: { elements: number[]; modalities: number[] };
  /** A planet alone in its element or modality: astrologers give it extra weight. */
  singletons: Array<{ key: string; kind: 'element' | 'modality'; index: number }>;
}

const WEIGHTED = new Set(['sun', 'moon', 'asc']);

/** What's counted, and how much each counts. */
function counted(points: Record<string, Point>, shown: string[], counting: Counting): Array<{ key: string; sign: number; weight: number }> {
  const keys = PLANETS.filter((k) => points[k] && shown.includes(k));
  if (counting !== 'planets') keys.push(...['asc', 'mc'].filter((k) => points[k]));
  return keys.map((key) => ({
    key, sign: signIndex(points[key]!.lon), weight: counting === 'weighted' && WEIGHTED.has(key) ? 2 : 1,
  }));
}

const leaders = (scores: number[]) => {
  const top = Math.max(...scores);
  return top > 0 ? scores.map((s, i) => (s === top ? i : -1)).filter((i) => i >= 0) : [];
};

export function balance(points: Record<string, Point>, shown: string[], counting: Counting): Balance {
  const items = counted(points, shown, counting);
  const elements: Share[] = ELEMENT_NAMES.map(() => ({ score: 0, keys: [] }));
  const modalities: Share[] = MODALITY_NAMES.map(() => ({ score: 0, keys: [] }));
  const grid = ELEMENT_NAMES.map(() => MODALITY_NAMES.map(() => [] as string[]));
  for (const { key, sign, weight } of items) {
    const e = elementOf(sign);
    const m = modalityOf(sign);
    elements[e]!.score += weight;
    elements[e]!.keys.push(key);
    modalities[m]!.score += weight;
    modalities[m]!.keys.push(key);
    grid[e]![m]!.push(key);
  }
  const els = leaders(elements.map((e) => e.score));
  const mods = leaders(modalities.map((m) => m.score));
  const signs = els.flatMap((e) => mods.map((m) => signFor(e, m))).sort((a, b) => a - b);
  // Singletons are planets only: the angles move round every day, so they don't stand alone.
  const planetsIn = (keys: string[]) => keys.filter((k) => PLANETS.includes(k));
  const singletons: Balance['singletons'] = [];
  elements.forEach((e, i) => { const p = planetsIn(e.keys); if (p.length === 1) singletons.push({ key: p[0]!, kind: 'element', index: i }); });
  modalities.forEach((m, i) => { const p = planetsIn(m.keys); if (p.length === 1) singletons.push({ key: p[0]!, kind: 'modality', index: i }); });
  return {
    counting,
    total: items.reduce((n, i) => n + i.weight, 0),
    elements, modalities, grid,
    polarity: { active: elements[0]!.score + elements[2]!.score, receptive: elements[1]!.score + elements[3]!.score },
    signature: { elements: els, modalities: mods, signs },
    missing: {
      elements: elements.map((e, i) => (e.score === 0 ? i : -1)).filter((i) => i >= 0),
      modalities: modalities.map((m, i) => (m.score === 0 ? i : -1)).filter((i) => i >= 0),
    },
    singletons,
  };
}

/** How strongly an element (of four) or modality (of three) shows, for a word beside it. */
export function emphasis(score: number, total: number, of: 3 | 4): 'missing' | 'weak' | 'average' | 'strong' {
  if (score === 0) return 'missing';
  if (!total) return 'average';
  const share = score / total;
  const even = 1 / of;
  if (share >= even * 1.6) return 'strong';
  if (share <= even * 0.45) return 'weak';
  return 'average';
}

// ---------------------------------------------------------------- Houses

export interface Houses {
  /** Houses 7–12 (above the horizon) and 1–6 (below). */
  above: string[];
  below: string[];
  /** Houses 10–3 (east, the Ascendant's side) and 4–9 (west). */
  east: string[];
  west: string[];
  /** Quadrants: houses 1–3, 4–6, 7–9, 10–12. */
  quadrants: string[][];
  /** Angular (1, 4, 7, 10), succedent (2, 5, 8, 11) and cadent (3, 6, 9, 12). */
  angular: string[];
  succedent: string[];
  cadent: string[];
  houseOf: Record<string, number>;
}

export function houses(points: Record<string, Point>, shown: string[], cusps: number[]): Houses {
  const result: Houses = { above: [], below: [], east: [], west: [], quadrants: [[], [], [], []], angular: [], succedent: [], cadent: [], houseOf: {} };
  for (const k of PLANETS) {
    if (!points[k] || !shown.includes(k)) continue;
    const h = houseOf(points[k]!.lon, cusps);
    if (!h) continue;
    result.houseOf[k] = h;
    (h >= 7 ? result.above : result.below).push(k);
    (h >= 10 || h <= 3 ? result.east : result.west).push(k);
    result.quadrants[Math.floor((h - 1) / 3)]!.push(k);
    (h % 3 === 1 ? result.angular : h % 3 === 2 ? result.succedent : result.cadent).push(k);
  }
  return result;
}

// ---------------------------------------------------------------- Sun, Moon, rising; ruler; phase

export const MOON_PHASES = ['New', 'Crescent', 'First quarter', 'Gibbous', 'Full', 'Disseminating', 'Last quarter', 'Balsamic'];

/** The Moon's phase at birth, by its distance ahead of the Sun (Rudhyar's eight phases). */
export function moonPhase(sun: number, moon: number): { name: string; angle: number; waxing: boolean } {
  const angle = norm(moon - sun);
  return { name: MOON_PHASES[Math.floor(angle / 45)]!, angle, waxing: angle < 180 };
}

/** A day chart has the Sun above the horizon (houses 7–12). */
export function isDayChart(sun: number, cusps: number[]): boolean {
  const h = houseOf(sun, cusps);
  return h !== null && h >= 7;
}

// ---------------------------------------------------------------- Shape

export type ShapeName = 'Bundle' | 'Bowl' | 'Bucket' | 'Locomotive' | 'Seesaw' | 'Splash' | 'Splay';
export const SHAPES: Record<ShapeName, string> = {
  Bundle: 'Every planet within a third of the circle (120°): a concentrated, specialised focus.',
  Bowl: 'Every planet within half the circle (180°): self-contained, with a sense of something to fill in the empty half.',
  Bucket: 'A bowl with one planet (the handle) alone on the other side: the handle channels the whole chart.',
  Locomotive: 'Planets over two-thirds of the circle with a clear empty third: driving, self-motivated energy.',
  Seesaw: 'Two groups facing each other across two empty spaces: weighing up, balancing opposites.',
  Splash: 'Planets spread evenly round the whole circle: wide interests, versatile.',
  Splay: 'Irregular clusters with uneven gaps: individual, follows its own pattern.',
};

export interface Shape {
  name: ShapeName;
  /** The leading planet of a bowl or locomotive (first to rise, going clockwise), or a bucket's handle. */
  key: string | null;
  role: 'leading' | 'handle' | null;
}

/** Marc Edmund Jones's seven chart shapes, from the ten planets' spread. */
export function shape(lons: Record<string, number>): Shape | null {
  const items = Object.entries(lons).map(([key, lon]) => ({ key, lon: norm(lon) })).sort((a, b) => a.lon - b.lon);
  if (items.length < 5) return null;
  const n = items.length;
  // gaps[i] is the empty arc after items[i] (going round in zodiac order).
  const gaps = items.map((it, i) => norm(items[(i + 1) % n]!.lon - it.lon));
  const widest = Math.max(...gaps);
  const after = gaps.indexOf(widest);
  // The planet just after the widest gap leads: the chart turns clockwise, so it rises first.
  const lead = items[(after + 1) % n]!.key;
  const span = 360 - widest;
  if (span <= 120) return { name: 'Bundle', key: null, role: null };
  if (span <= 180) return { name: 'Bowl', key: lead, role: 'leading' };
  // A bucket: take one planet away and the rest fit in half the circle, with the handle well clear.
  for (let i = 0; i < n; i++) {
    const before = gaps[(i - 1 + n) % n]!;
    const own = gaps[i]!;
    if (before + own >= 180 && 360 - (before + own) <= 180 && before >= 45 && own >= 45) {
      return { name: 'Bucket', key: items[i]!.key, role: 'handle' };
    }
  }
  const big = gaps.map((g, i) => ({ g, i })).filter((x) => x.g >= 60);
  if (big.length === 2) {
    const [a, b] = big;
    const groupA = norm(items[b!.i]!.lon - items[(a!.i + 1) % n]!.lon);
    const groupB = norm(items[a!.i]!.lon - items[(b!.i + 1) % n]!.lon);
    if (groupA < 180 && groupB < 180 && Math.abs(a!.i - b!.i) > 1 && Math.abs(a!.i - b!.i) < n - 1) return { name: 'Seesaw', key: null, role: null };
  }
  if (widest >= 120) return { name: 'Locomotive', key: lead, role: 'leading' };
  const signs = new Set(items.map((it) => signIndex(it.lon))).size;
  if (widest <= 60 && signs >= 7) return { name: 'Splash', key: null, role: null };
  return { name: 'Splay', key: null, role: null };
}

// ---------------------------------------------------------------- Patterns

export interface Pattern {
  name: 'Grand trine' | 'T-square' | 'Grand cross' | 'Yod' | 'Kite' | 'Mystic rectangle';
  keys: string[];
  /** The focal planet of a T-square or yod (the apex), or a kite's tail. */
  apex: string | null;
}

const MAJOR = new Set(['conjunction', 'opposition', 'trine', 'square', 'sextile']);

/** Grand trines, kites, grand crosses, mystic rectangles, T-squares and yods among `keys`, from the chart's aspects. */
export function patterns(keys: string[], aspects: FoundAspect[]): Pattern[] {
  const between = new Map<string, string>();
  for (const a of aspects) {
    if (!keys.includes(a.a) || !keys.includes(a.b)) continue;
    between.set(`${a.a}|${a.b}`, a.aspect);
    between.set(`${a.b}|${a.a}`, a.aspect);
  }
  const is = (a: string, b: string, kind: string) => between.get(`${a}|${b}`) === kind;
  const found: Pattern[] = [];
  const ks = keys;
  const triples: string[][] = [];
  for (let i = 0; i < ks.length; i++) for (let j = i + 1; j < ks.length; j++) for (let k = j + 1; k < ks.length; k++) triples.push([ks[i]!, ks[j]!, ks[k]!]);

  const trines: string[][] = [];
  for (const [a, b, c] of triples as Array<[string, string, string]>) {
    if (is(a, b, 'trine') && is(b, c, 'trine') && is(a, c, 'trine')) {
      trines.push([a, b, c]);
      found.push({ name: 'Grand trine', keys: [a, b, c], apex: null });
    }
  }
  // Kites: a grand trine, with a fourth planet opposite one corner and sextile the other two.
  for (const t of trines) {
    for (const d of ks) {
      if (t.includes(d)) continue;
      for (const corner of t) {
        const others = t.filter((x) => x !== corner);
        if (is(d, corner, 'opposition') && others.every((o) => is(d, o, 'sextile'))) {
          found.push({ name: 'Kite', keys: [...t, d], apex: d });
        }
      }
    }
  }
  // Grand crosses: two oppositions, each end square both ends of the other.
  const crosses: string[][] = [];
  for (let i = 0; i < ks.length; i++) for (let j = i + 1; j < ks.length; j++) {
    const [a, b] = [ks[i]!, ks[j]!];
    if (!is(a, b, 'opposition')) continue;
    for (let k = j + 1; k < ks.length; k++) for (let l = k + 1; l < ks.length; l++) {
      const [c, d] = [ks[k]!, ks[l]!];
      if (a === c || a === d || b === c || b === d) continue;
      if (is(c, d, 'opposition') && [c, d].every((x) => is(a, x, 'square') && is(b, x, 'square'))) {
        const four = [a, b, c, d].sort();
        if (!crosses.some((x) => x.join() === four.join())) {
          crosses.push(four);
          found.push({ name: 'Grand cross', keys: [a, c, b, d], apex: null });
        }
      }
    }
  }
  // Mystic rectangles: two oppositions joined by two trines and two sextiles.
  for (let i = 0; i < ks.length; i++) for (let j = i + 1; j < ks.length; j++) {
    const [a, b] = [ks[i]!, ks[j]!];
    if (!is(a, b, 'opposition')) continue;
    for (let k = i + 1; k < ks.length; k++) for (let l = k + 1; l < ks.length; l++) {
      const [c, d] = [ks[k]!, ks[l]!];
      if ([a, b].includes(c) || [a, b].includes(d) || !is(c, d, 'opposition')) continue;
      const one = is(a, c, 'trine') && is(b, d, 'trine') && is(a, d, 'sextile') && is(b, c, 'sextile');
      const two = is(a, c, 'sextile') && is(b, d, 'sextile') && is(a, d, 'trine') && is(b, c, 'trine');
      if (one || two) found.push({ name: 'Mystic rectangle', keys: [a, b, c, d], apex: null });
    }
  }
  // T-squares (not already part of a grand cross) and yods.
  for (let i = 0; i < ks.length; i++) for (let j = i + 1; j < ks.length; j++) {
    const [a, b] = [ks[i]!, ks[j]!];
    for (const c of ks) {
      if (c === a || c === b) continue;
      if (is(a, b, 'opposition') && is(a, c, 'square') && is(b, c, 'square')
          && !crosses.some((x) => [a, b, c].every((y) => x.includes(y)))) {
        found.push({ name: 'T-square', keys: [a, b, c], apex: c });
      }
      if (is(a, b, 'sextile') && is(a, c, 'quincunx') && is(b, c, 'quincunx')) {
        found.push({ name: 'Yod', keys: [a, b, c], apex: c });
      }
    }
  }
  return found;
}

/** Three or more planets in one sign (or house). */
export function stelliums(of: Record<string, number>, least = 3): Array<{ at: number; keys: string[] }> {
  const groups = new Map<number, string[]>();
  for (const [k, at] of Object.entries(of)) groups.set(at, [...(groups.get(at) ?? []), k]);
  return [...groups.entries()].filter(([, keys]) => keys.length >= least).map(([at, keys]) => ({ at, keys })).sort((a, b) => a.at - b.at);
}

/** Planets with no major aspect to any of `keys`. */
export function unaspected(planets: string[], keys: string[], aspects: FoundAspect[]): string[] {
  return planets.filter((p) => !aspects.some((a) => MAJOR.has(a.aspect)
    && ((a.a === p && keys.includes(a.b)) || (a.b === p && keys.includes(a.a)))));
}

// ---------------------------------------------------------------- Rulerships

export interface Rulership {
  /** Each planet's dispositor: the ruler of the sign it's in. */
  dispositor: Record<string, string>;
  /** The planet every chain of dispositors ends at, if there's exactly one. */
  final: string | null;
  /** Planets in their own sign (where a chain stops). */
  own: string[];
  /** Pairs of planets in each other's signs. */
  receptions: Array<[string, string]>;
}

export function rulership(lons: Record<string, number>, rulers: Rulers): Rulership {
  const set = (rulers === 'modern' ? PLANETS : SEVEN).filter((k) => lons[k] !== undefined);
  const dispositor: Record<string, string> = {};
  for (const k of set) dispositor[k] = rulerOf(signIndex(lons[k]!), rulers);
  const own = set.filter((k) => dispositor[k] === k);
  const receptions: Array<[string, string]> = [];
  for (let i = 0; i < set.length; i++) for (let j = i + 1; j < set.length; j++) {
    const [a, b] = [set[i]!, set[j]!];
    if (dispositor[a] === b && dispositor[b] === a) receptions.push([a, b]);
  }
  // Follow each chain; with exactly one planet in its own sign and every chain ending there, it's the final dispositor.
  let final: string | null = null;
  if (own.length === 1) {
    const end = own[0]!;
    const reaches = (start: string) => {
      let at = start;
      for (let step = 0; step < 12; step++) {
        if (at === end) return true;
        const next = dispositor[at];
        if (!next || next === at) return false;
        at = next;
      }
      return false;
    };
    if (set.every(reaches)) final = end;
  }
  return { dispositor, final, own, receptions };
}

/** Planets with an essential dignity or debility in their sign: domicile, exaltation, detriment, fall. */
export function dignityList(lons: Record<string, number>): Array<{ key: string; dignity: string }> {
  return PLANETS.filter((k) => lons[k] !== undefined).map((k) => ({ key: k, dignity: dignities(k, lons[k]!) })).filter((d) => d.dignity);
}
