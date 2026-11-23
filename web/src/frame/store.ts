/**
 * AstrologyStudio ·
 * web/src/frame/store.ts
 *
 * What the app frame shares between its parts: your chart list (for the chart list down the
 * left, the tab titles and the status bar) and the open tabs.
 *
 * Every screen is a tab, like documents in a desktop program. A chart keeps one tab whichever of
 * its screens you're on (the chart, With…, Returns, Edit), and the tab remembers the last of them,
 * so going back to it puts you where you were. The open tabs are remembered with your other choices.
 *
 * Copyright (c) 2026 Gavin Melhuish
 * MIT License; see LICENSE in the project root.
 * SPDX-License-Identifier: MIT
 */

import { useEffect, useState } from 'preact/hooks';
import { api, type ChartSummary } from '../api';
import { describe, type Loaded } from '../ui';
import { getPref, setPref, usePref } from '../prefs';

// ---------------------------------------------------------------------------
// Your charts

let charts: Loaded<ChartSummary[]> = { state: 'loading' };
const chartListeners = new Set<() => void>();
let inFlight: Promise<void> | null = null;
let again = false;

/** Read the chart list again (after anything that may have changed it). */
export function refreshCharts(): void {
  if (inFlight) { again = true; return; }
  inFlight = api<{ data: ChartSummary[] }>('/charts')
    .then((r) => { charts = { state: 'ready', data: r.data }; })
    .catch((error: unknown) => { if (charts.state !== 'ready') charts = { state: 'error', error: describe(error) }; })
    .finally(() => {
      inFlight = null;
      chartListeners.forEach((l) => l());
      if (again) { again = false; refreshCharts(); }
    });
}

export function useCharts(): Loaded<ChartSummary[]> {
  const [, bump] = useState(0);
  useEffect(() => {
    const listener = () => bump((n) => n + 1);
    chartListeners.add(listener);
    return () => { chartListeners.delete(listener); };
  }, []);
  return charts;
}

/** Forget the list (on logging out), so the next person doesn't see it for a moment. */
export function resetCharts(): void {
  charts = { state: 'loading' };
  chartListeners.forEach((l) => l());
}

// ---------------------------------------------------------------------------
// Tabs

export interface Tab {
  /** What the tab is: `/charts/{id}` for a chart, otherwise the screen's own address. */
  key: string;
  /** Where in it you were last. */
  path: string;
}

const TABS = 'open-tabs';
const MAX_TABS = 16;
/** The chart library's tab: always there, always first, and it can't be closed. */
export const LIBRARY = '/charts';
const isTabs = (v: unknown): v is Tab[] =>
  Array.isArray(v) && v.every((t) => t && typeof t === 'object' && typeof (t as Tab).key === 'string' && typeof (t as Tab).path === 'string');

/** The tabs with the library first (added if it was missing). */
function withLibrary(tabs: Tab[]): Tab[] {
  const library = tabs.find((t) => t.key === LIBRARY) ?? { key: LIBRARY, path: LIBRARY };
  return [library, ...tabs.filter((t) => t.key !== LIBRARY)];
}
const readTabs = () => withLibrary(getPref<Tab[]>(TABS, [], isTabs));

const SECTIONS: Record<string, string> = {
  '/charts': 'Chart library',
  '/charts/new': 'New chart',
  '/view': 'Your view',
  '/settings': 'Settings',
  '/account': 'Account',
  '/users': 'Users',
  '/ephemeris': 'Ephemeris',
  '/start': 'Getting started',
};

/** Which tab an address belongs to; null for the home screen. */
export function tabKey(path: string): string | null {
  if (path === '/' || path === '') return null;
  if (path === '/charts' || path === '/charts/new') return path;
  const chart = /^\/charts\/([^/]+)/.exec(path);
  if (chart) return `/charts/${chart[1]}`;
  return `/${path.split('/').filter(Boolean)[0]}`;
}

/** The chart id behind a tab, or null when it isn't a chart's tab. */
export function chartOf(key: string): string | null {
  const m = /^\/charts\/([^/]+)$/.exec(key);
  return m && m[1] !== 'new' ? m[1]! : null;
}

export function tabTitle(key: string, list: Loaded<ChartSummary[]>): string {
  const id = chartOf(key);
  if (!id) return SECTIONS[key] ?? key.slice(1).replace(/^\w/, (c) => c.toUpperCase());
  const chart = list.state === 'ready' ? list.data.find((c) => c.id === id) : undefined;
  return chart?.name ?? (list.state === 'loading' ? '…' : 'Chart');
}

export function useTabs(): [Tab[], (tabs: Tab[]) => void] {
  const [tabs, setTabs] = usePref<Tab[]>(TABS, [], isTabs);
  return [withLibrary(tabs), (next) => setTabs(withLibrary(next))];
}

/** Move a tab to another place in the row, as in a browser. The library stays first. */
export function moveTab(key: string, to: number): void {
  if (key === LIBRARY) return;
  const tabs = readTabs();
  const from = tabs.findIndex((t) => t.key === key);
  if (from < 0) return;
  const at = Math.max(1, Math.min(to, tabs.length - 1));
  if (at === from) return;
  const next = tabs.filter((t) => t.key !== key);
  next.splice(at, 0, tabs[from]!);
  setPref(TABS, next);
}

/** Make sure the address you're on has a tab, and remember it as that tab's place. */
export function visit(path: string): void {
  const key = tabKey(path);
  if (!key) return;
  const tabs = readTabs();
  const at = tabs.findIndex((t) => t.key === key);
  if (at >= 0) {
    if (tabs[at]!.path === path) return;
    setPref(TABS, tabs.map((t, i) => (i === at ? { key, path } : t)));
    return;
  }
  // Too many open: the oldest tab that isn't a chart goes first, then the oldest chart.
  let next = [...tabs, { key, path }];
  while (next.length > MAX_TABS) {
    const drop = next.findIndex((t) => !chartOf(t.key) && t.key !== LIBRARY);
    next = next.filter((_, i) => i !== (drop >= 0 && drop < next.length - 1 ? drop : 1));
  }
  setPref(TABS, next);
}

/** Close a tab. Returns where to go next if it was the one you're on (null: the home screen). */
export function closeTab(key: string, current: string | null): string | null | undefined {
  if (key === LIBRARY) return undefined;
  const tabs = readTabs();
  const at = tabs.findIndex((t) => t.key === key);
  if (at < 0) return undefined;
  const rest = tabs.filter((t) => t.key !== key);
  setPref(TABS, rest);
  if (key !== current) return undefined;
  const neighbour = rest[at] ?? rest[at - 1] ?? rest[0];
  return neighbour ? neighbour.path : LIBRARY;
}

/** Close the tabs of charts that are no longer in your list (deleted here or elsewhere). */
export function dropMissingCharts(list: ChartSummary[], current: string | null): void {
  const ids = new Set(list.map((c) => c.id));
  const tabs = getPref<Tab[]>(TABS, [], isTabs);
  const kept = tabs.filter((t) => { const id = chartOf(t.key); return !id || t.key === current || ids.has(id); });
  if (kept.length !== tabs.length) setPref(TABS, kept);
}

/** Show another chart in the same tab (switching chart from the chart's own panel). */
export function switchTab(fromKey: string, toPath: string): void {
  const toKey = tabKey(toPath);
  const tabs = getPref<Tab[]>(TABS, [], isTabs);
  if (!toKey || toKey === fromKey) return;
  const already = tabs.some((t) => t.key === toKey);
  setPref(TABS, already
    ? tabs.filter((t) => t.key !== fromKey)
    : tabs.map((t) => (t.key === fromKey ? { key: toKey, path: toPath } : t)));
}
