/**
 * AstrologyStudio ·
 * web/src/display.ts
 *
 * What the chart screen's canvas shows:
 *
 * the chart type (chart wheel, Hellenistic chart or dial), the dial's size, and the layout it's
 * drawn with. All are chosen from pickers in the app bar and remembered. Layouts are built in or
 * each person's own (see appearance.tsx).
 *
 * Copyright (c) 2026 Gavin Melhuish
 * MIT License; see LICENSE in the project root.
 * SPDX-License-Identifier: MIT
 */

import { useEffect } from 'preact/hooks';
import type { School } from './api';
import { useLayouts, type Layout } from './appearance';
import { getPref, isBoolean, oneOf, usePref } from './prefs';

export type DisplayKey = 'wheel' | 'hellenistic' | 'dial';
export { DIAL_MODULI, isModulus, MIN_DIAL, sizeLabel, type DialModulus } from './geometry';
import { isModulus, type DialModulus } from './geometry';

/** The chart type in use, and a way to change it. */
export function useDisplay(): [DisplayKey, (key: DisplayKey) => void] {
  return usePref<DisplayKey>('canvas-display', 'wheel', oneOf<DisplayKey>('wheel', 'hellenistic', 'dial'));
}

/** What a chart opens on for each default school; Self-selected opens where it was left. */
export const SCHOOL_DISPLAY: Record<School, DisplayKey | null> = { self: null, modern: 'wheel', hellenistic: 'hellenistic', cosmobiology: 'dial' };

let started = false;

/**
 * Once per visit: with Modern Western, Hellenistic or Cosmobiology as the default school, charts
 * open on that school's chart type. With Self-selected (the default) they open where they were
 * left, so nothing changes for anyone who hasn't chosen a school.
 */
export function useSchoolStart(school: School | undefined, ready: boolean): void {
  const [, setDisplay] = useDisplay();
  useEffect(() => {
    if (started || !ready || !school) return;
    started = true;
    const opens = SCHOOL_DISPLAY[school];
    if (opens) setDisplay(opens);
  }, [school, ready]);
}

const MAX_SIZES = 12;
const isSizes = (v: unknown): v is DialModulus[] =>
  Array.isArray(v) && v.length > 0 && v.length <= MAX_SIZES && v.every(isModulus) && new Set(v).size === v.length;

/**
 * The dial sizes switched on in My View. Only 90° by default; anyone who was already on the
 * 120° or 360° dial has that size on as well, so their screen doesn't change.
 */
export function useDialSizes(): [DialModulus[], (sizes: DialModulus[]) => void] {
  const before = getPref<DialModulus>('dial-modulus', 90, isModulus);
  const fallback: DialModulus[] = before === 90 ? [90] : [90, before];
  const [sizes, setSizes] = usePref<DialModulus[]>('dial-sizes', fallback, isSizes);
  const sorted = [...sizes].sort((a, b) => b - a);
  return [sorted, (next) => {
    const clean = [...new Set(next.filter(isModulus))].sort((a, b) => b - a).slice(0, MAX_SIZES);
    if (clean.length) setSizes(clean);
  }];
}

/** The dial's size: the one last chosen, if it's still switched on, else the smallest that is. */
export function useDialModulus(): [DialModulus, (m: DialModulus) => void] {
  const [chosen, setChosen] = usePref<DialModulus>('dial-modulus', 90, isModulus);
  const [sizes] = useDialSizes();
  return [sizes.includes(chosen) ? chosen : sizes[0] ?? 90, setChosen];
}

/** The chart screen's address: /charts/{id} and nothing after it. */
export const isChartScreen = (path: string) => /^\/charts\/[^/]+$/.test(path) && path !== '/charts/new';

/** The layout chosen for a chart type (each remembers its own): built-in or your own. */
export function useLayout(display: DisplayKey): [Layout, (id: string) => void] {
  const layouts = useLayouts(display);
  const [chosen, setChosen] = usePref<string>(`canvas-layout-${display}`, `${display}:default`, (v): v is string => typeof v === 'string');
  // Before 1.3 the only choice was stored as 'default'.
  const id = chosen === 'default' ? `${display}:default` : chosen;
  const layout = layouts.find((l) => l.id === id) ?? layouts.find((l) => l.id === `${display}:default`) ?? layouts[0]!;
  return [layout, setChosen];
}
export { isReport, reportOf, type Report } from './report';

/** Whether each aspect's symbol is drawn in the middle of its line on the chart wheel (My View → Aspects). */
export const useLineGlyphs = () => usePref<boolean>('aspect-line-glyphs', true, isBoolean);

/** Whether the chart wheel draws a line from a symbol moved aside (to make room) back to its tick
 * on the graduation. Off by default; My View → Charts & dials. The ticks themselves always show. */
export const useLeaderLines = () => usePref<boolean>('wheel-leader-lines', false, isBoolean);
