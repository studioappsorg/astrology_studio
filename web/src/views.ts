/**
 * AstrologyStudio ·
 * web/src/views.ts
 *
 * Views:
 *
 * the ways one chart is looked at, kept per chart (1.11). A view is the chart type and dial size,
 * layout, chart 2, report tab, selected chart, Between 1 and 2, and the dial pointer. A chart
 * opens on its active view; with more than one, the chart screen shows a row to switch between
 * them.
 *
 * Views live on the server (/preferences/chart-views/{chart}), so they follow you between devices.
 * Changes show at once and are saved a moment later. A chart with no views yet gets one made from
 * your defaults: the chart type, dial size, layout and report you last chose.
 *
 * Copyright (c) 2026 Gavin Melhuish
 * MIT License; see LICENSE in the project root.
 * SPDX-License-Identifier: MIT
 */

import { useEffect, useState } from 'preact/hooks';
import { api } from './api';
import type { SlotRef } from './components/ChartSlots';
import { getPref, setPref } from './prefs';
import { isReport, type Report } from './report';

export type ViewDisplay = 'wheel' | 'hellenistic' | 'dial';
export type NowRole = 'transits_now' | 'progressions_now' | 'solar_arc_now' | 'solar_return_next' | 'lunar_return_next';

export interface View {
  id: string;
  /** Your own name for it; null names it from its settings ("Dial 90°", "+ John Smith"). */
  name: string | null;
  display: ViewDisplay;
  dial_size: number;
  /** Layout id for its chart type; null is your default layout for that chart type. */
  layout: string | null;
  /** Chart 1 when it isn't the chart itself (a chart derived from it); null is the chart. */
  chart: SlotRef | null;
  /** Chart 2. */
  partner: SlotRef | null;
  /** Chart 2's name, kept for the view's label while the view isn't showing. */
  partner_name: string | null;
  /** How chart 2 was made when it was worked out for now (transits now and so on): saving the
   * view in a preset keeps that kind rather than this particular chart. */
  partner_role: NowRole | null;
  /** Chart 2 is still to be chosen (a preset's "ask each time"): the chart dialog opens for it. */
  ask: boolean;
  report: Report;
  selected: 0 | 1;
  between: boolean;
  pointer: number | null;
}

export interface ChartViews {
  views: View[];
  active: string;
  /** The preset last applied to this chart, for the preset picker's label. */
  preset: string | null;
}

export const MAX_VIEWS = 6;

export const newViewId = (): string => `v_${Math.random().toString(36).slice(2, 10)}`;

const isDisplay = (v: unknown): v is ViewDisplay => v === 'wheel' || v === 'hellenistic' || v === 'dial';

/** A new view from your defaults: the chart type, dial size, layout and report you last chose. */
export function defaultView(): View {
  const display = getPref<ViewDisplay>('canvas-display', 'wheel', isDisplay);
  return {
    id: newViewId(),
    name: null,
    display,
    dial_size: getPref<number>('dial-modulus', 90, (v): v is number => typeof v === 'number'),
    layout: null,
    chart: null,
    partner: null,
    partner_name: null,
    partner_role: null,
    ask: false,
    report: getPref<Report>('chart-report', 'chart', isReport),
    selected: 0,
    between: false,
    pointer: null,
  };
}

/** Remember a view's choices as the defaults for new views. */
export function rememberDefaults(v: Partial<View>): void {
  if (v.display) setPref('canvas-display', v.display);
  if (v.display === 'dial' && v.dial_size) setPref('dial-modulus', v.dial_size);
  if (v.report) setPref('chart-report', v.report);
  if (v.layout && v.display) setPref(`canvas-layout-${v.display}`, v.layout);
}

/** A view's label: your name for it, or one made from what it shows. */
export function viewLabel(v: View): string {
  if (v.name) return v.name;
  const base = v.display === 'dial' ? `Dial ${Number.isInteger(v.dial_size) ? v.dial_size : v.dial_size.toFixed(1)}°`
    : v.display === 'hellenistic' ? 'Hellenistic' : 'Western';
  if (!v.partner) return base;
  // A derived chart's name is long ("Transits 2026-11-23 10:05 for Jane Doe"): its kind is enough.
  const other = v.partner_name
    ? (v.partner?.derived ? v.partner_name.replace(/ for .*$/, '').replace(/ \d{4}-\d\d-\d\d.*$/, '') : v.partner_name)
    : 'chart 2';
  return v.display === 'wheel' ? `+ ${other}` : `${base} + ${other}`;
}

// ---------------------------------------------------------------------------
// The store: one entry per chart, loaded once, saved a moment after each change.

type Entry = { state: 'loading' } | { state: 'ready'; data: ChartViews; saved: boolean };

const entries = new Map<string, Entry>();
const listeners = new Set<() => void>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const notify = () => listeners.forEach((l) => l());

/** Changes asked for before a chart's views had loaded (old addresses such as /charts/{id}/dial). */
const pending = new Map<string, Partial<View>>();

export function requestViewChange(chartId: string, patch: Partial<View>): void {
  if (entries.get(chartId)?.state === 'ready') {
    changeViews(chartId, (cv) => ({ ...cv, views: cv.views.map((v) => (v.id === cv.active ? { ...v, ...patch } : v)) }));
    return;
  }
  pending.set(chartId, { ...(pending.get(chartId) ?? {}), ...patch });
}

/** Makes the views of a chart that has none yet (from your default preset), if one is set. */
let newChartViews: ((chartId: string) => Promise<ChartViews | null>) | null = null;

export function setNewChartViews(make: ((chartId: string) => Promise<ChartViews | null>) | null): void {
  newChartViews = make;
}

function load(chartId: string): void {
  if (entries.has(chartId)) return;
  entries.set(chartId, { state: 'loading' });
  api<ChartViews | null>(`/preferences/chart-views/${encodeURIComponent(chartId)}`)
    .catch(() => null)
    .then(async (stored) => {
      const fresh = !stored || !stored.views?.length;
      const made = fresh && newChartViews ? await newChartViews(chartId).catch(() => null) : null;
      let data: ChartViews = made ?? (fresh ? (() => { const v = defaultView(); return { views: [v], active: v.id, preset: null }; })()
        : { views: stored!.views.map((v) => ({ ...defaultView(), ...v })), active: stored!.active, preset: stored!.preset ?? null });
      const patch = pending.get(chartId);
      if (patch) {
        pending.delete(chartId);
        data = { ...data, views: data.views.map((v) => (v.id === data.active ? { ...v, ...patch } : v)) };
      }
      entries.set(chartId, { state: 'ready', data, saved: !fresh && !patch && !made });
      if (patch || made) save(chartId);
      notify();
    });
}

function save(chartId: string): void {
  const old = timers.get(chartId);
  if (old) clearTimeout(old);
  timers.set(chartId, setTimeout(() => {
    timers.delete(chartId);
    const entry = entries.get(chartId);
    if (entry?.state !== 'ready') return;
    void api(`/preferences/chart-views/${encodeURIComponent(chartId)}`, 'PUT', entry.data).catch(() => undefined);
  }, 600));
}

/** Change a chart's views. Shows at once; saved a moment later. */
export function changeViews(chartId: string, change: (cv: ChartViews) => ChartViews): void {
  const entry = entries.get(chartId);
  if (entry?.state !== 'ready') return;
  const next = change(entry.data);
  if (!next.views.length) return;
  if (!next.views.some((v) => v.id === next.active)) next.active = next.views[0]!.id;
  entries.set(chartId, { state: 'ready', data: next, saved: true });
  notify();
  save(chartId);
}

/** Forget what's kept for every chart (on logging out). */
export function resetViews(): void {
  entries.clear();
  pending.clear();
  notify();
}

export interface ChartViewsHandle {
  ready: boolean;
  views: View[];
  active: View | null;
  preset: string | null;
  /** Change the view on screen. */
  update: (patch: Partial<View>) => void;
  /** Remember which preset the chart's views came from (null: none). */
  setPreset: (id: string | null) => void;
  setActive: (id: string) => void;
  /** Add a view after the current one and show it. */
  add: (view: View) => void;
  /** Add views at the end (as many as fit) and show the first of them. */
  addMany: (views: View[]) => void;
  remove: (id: string) => void;
  move: (id: string, to: number) => void;
  replaceAll: (views: View[], preset?: string | null) => void;
}

export function useChartViews(chartId: string): ChartViewsHandle {
  const [, bump] = useState(0);
  useEffect(() => {
    const l = () => bump((n) => n + 1);
    listeners.add(l);
    return () => { listeners.delete(l); };
  }, []);
  load(chartId);
  const entry = entries.get(chartId);
  const data = entry?.state === 'ready' ? entry.data : null;
  const active = data ? data.views.find((v) => v.id === data.active) ?? data.views[0]! : null;
  const change = (fn: (cv: ChartViews) => ChartViews) => changeViews(chartId, fn);
  return {
    ready: !!data,
    views: data?.views ?? [],
    active,
    preset: data?.preset ?? null,
    update: (patch) => change((cv) => ({
      ...cv,
      views: cv.views.map((v) => (v.id === cv.active ? { ...v, ...patch } : v)),
    })),
    setPreset: (id) => change((cv) => ({ ...cv, preset: id })),
    setActive: (id) => change((cv) => ({ ...cv, active: id })),
    add: (view) => change((cv) => {
      if (cv.views.length >= MAX_VIEWS) return cv;
      const at = cv.views.findIndex((v) => v.id === cv.active);
      const views = [...cv.views];
      views.splice(at + 1, 0, view);
      return { ...cv, views, active: view.id };
    }),
    addMany: (more) => change((cv) => {
      const room = more.slice(0, MAX_VIEWS - cv.views.length);
      return room.length ? { ...cv, views: [...cv.views, ...room], active: room[0]!.id } : cv;
    }),
    remove: (id) => change((cv) => {
      if (cv.views.length < 2) return cv;
      const at = cv.views.findIndex((v) => v.id === id);
      const views = cv.views.filter((v) => v.id !== id);
      const active = cv.active === id ? (views[at] ?? views[at - 1])!.id : cv.active;
      return { ...cv, views, active };
    }),
    move: (id, to) => change((cv) => {
      const from = cv.views.findIndex((v) => v.id === id);
      if (from < 0) return cv;
      const views = [...cv.views];
      const [v] = views.splice(from, 1);
      views.splice(Math.max(0, Math.min(to, views.length)), 0, v!);
      return { ...cv, views };
    }),
    replaceAll: (views, preset = null) => change((cv) => ({ views: views.slice(0, MAX_VIEWS), active: views[0]?.id ?? cv.active, preset })),
  };
}

// ---------------------------------------------------------------------------
// The view on screen, for the title bar's pickers (chart type, dial size, layout, presets).

export interface ActiveView {
  chartId: string;
  view: View;
  update: (patch: Partial<View>) => void;
  handle: ChartViewsHandle;
}

let onScreen: ActiveView | null = null;
const screenListeners = new Set<() => void>();

export function setActiveView(value: ActiveView | null): void {
  onScreen = value;
  screenListeners.forEach((l) => l());
}

export function useActiveView(): ActiveView | null {
  const [, bump] = useState(0);
  useEffect(() => {
    const l = () => bump((n) => n + 1);
    screenListeners.add(l);
    return () => { screenListeners.delete(l); };
  }, []);
  return onScreen;
}
