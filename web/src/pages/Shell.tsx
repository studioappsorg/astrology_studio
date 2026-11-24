/**
 * AstrologyStudio ·
 * web/src/pages/Shell.tsx
 *
 * The signed-in layout, set out like a desktop program: the title bar and menus across the top,
 * the open tabs above the screen you're working in, and a status
 * bar along the bottom. The page itself never scrolls; each part scrolls on its own.
 *
 * Copyright (c) 2026 Gavin Melhuish
 * MIT License; see LICENSE in the project root.
 * SPDX-License-Identifier: MIT
 */

import type { JSX } from 'preact';
import { useEffect } from 'preact/hooks';
import { AppBar } from '../nav';
import { TabBar } from '../frame/Tabs';
import { StatusBar } from '../frame/StatusBar';
import { useStatusBar } from '../frame/layout';
import { requestViewChange } from '../views';
import { dropMissingCharts, refreshCharts, tabKey, useCharts, visit } from '../frame/store';
import { match, navigate, usePath } from '../router';
import { Account } from './Account';
import { EditChart, NewChart } from './ChartForm';
import { Charts } from './Charts';
import { ChartView } from './ChartView';
import { EphemerisPage } from './EphemerisPage';
import { Returns } from './Returns';
import { Sheet } from './Sheet';
import { Together } from './Together';
import { GettingStarted } from './GettingStarted';
import { NotFound } from './NotFound';
import { SettingsPage } from './Settings';
import { Users } from './Users';
import { MyView } from './MyView';
import { LayoutEditor } from './LayoutEditor';
import { ThemeEditor } from './ThemeEditor';
import { setPref } from '../prefs';

type Params = Record<string, string>;

/** Screens with a wheel or dial get the wider layout. */
const WIDE = /^\/view\/(themes|layouts)\/[^/]+$|^\/ephemeris$|^\/charts\/[^/]+\/(events|sheet)$/;
/** Screens with a chart or dial: one panel on the left and the chart filling the rest. */
const WORKSPACE = /^\/charts\/(?!new$)[^/]+(\/(with|returns|edit))?$/;

/** A chart's screen, with the Edit dialog over it at /charts/{id}/edit (the same tree either
 * way, so the chart isn't loaded again when the dialog opens or closes). */
function ChartWithEdit({ id, edit }: { id: string; edit: boolean }) {
  return (
    <>
      <ChartView id={id} />
      {edit && <EditChart id={id} />}
    </>
  );
}

/** Exact patterns, most specific first. */
export const ROUTES: Array<[string, (p: Params) => JSX.Element]> = [
  ['/charts', () => <Charts />],
  ['/charts/new', () => <NewChart />],
  ['/charts/:id', (p) => <ChartWithEdit key={p.id} id={p.id!} edit={false} />],
  ['/charts/:id/edit', (p) => <ChartWithEdit key={p.id} id={p.id!} edit />],
  ['/charts/:id/dial', (p) => <ToChartScreen id={p.id!} display="dial" />],
  ['/charts/:id/with', (p) => <Together key={p.id} id={p.id!} />],
  ['/charts/:id/returns', (p) => <Returns key={p.id} id={p.id!} />],
  ['/charts/:id/events', (p) => <ToChartScreen id={p.id!} events />],
  ['/charts/:id/harmonic', (p) => <ToChartScreen id={p.id!} />],
  ['/ephemeris', () => <EphemerisPage />],
  ['/charts/:id/sheet', (p) => <Sheet key={p.id} id={p.id!} />],
  ['/start', () => <GettingStarted />],
  ['/settings', () => <SettingsPage />],
  ['/view', () => <MyView />],
  ['/view/themes/:id', (p) => <ThemeEditor key={p.id} id={p.id!} />],
  ['/view/layouts/:id', (p) => <LayoutEditor key={p.id} id={p.id!} />],
  ['/users', () => <Users />],
  ['/account', () => <Account />],
  // A reset link opened while logged in: change the password under Account instead.
  ['/reset-password', () => <Redirect to="/account" />],
];

function Redirect({ to }: { to: string }) {
  useEffect(() => navigate(to, { replace: true }), [to]);
  return null;
}

export function Shell() {
  const rawPath = usePath();
  const [statusBar] = useStatusBar();
  // The app's own address is the chart library, which is always open as the first tab.
  const atRoot = rawPath === '/' || rawPath === '';
  useEffect(() => {
    if (atRoot) navigate('/charts', { replace: true });
  }, [rawPath]);
  const path = atRoot ? '/charts' : rawPath;
  const activeKey = tabKey(path);

  // Every screen you visit gets a tab (or brings its tab forward).
  useEffect(() => { if (activeKey) visit(path); }, [path]);
  // Keep the chart list fresh: anything you just did may have changed it.
  useEffect(() => { refreshCharts(); }, [path]);
  const charts = useCharts();
  useEffect(() => { if (charts.state === 'ready') dropMissingCharts(charts.data, activeKey); }, [charts]);

  let page: JSX.Element | null = null;
  for (const [pattern, render] of ROUTES) {
    const params = match(pattern, path);
    if (params) {
      page = render(params);
      break;
    }
  }

  return (
    <div class={`shell frame${statusBar ? '' : ' frame--no-status'}`}>
      <AppBar activeKey={activeKey} />
      <div class="frame__body">
        <div class="frame__work">
          <TabBar activeKey={activeKey} />
          <main class={`content${WORKSPACE.test(path) ? ' content--workspace' : WIDE.test(path) ? ' content--wide' : ''}`}>{page ?? <NotFound />}</main>
        </div>
      </div>
      {statusBar && <StatusBar activeKey={activeKey} />}
    </div>
  );
}


/** Old screens' addresses: harmonic charts are chosen on the chart screen (Change → Derived chart
 * → Harmonic), the dial is a chart type there, and events are one of its report tabs. */
function ToChartScreen({ id, display, events }: { id: string; display?: 'dial'; events?: boolean }) {
  useEffect(() => {
    if (display) setPref('canvas-display', display);
    if (events) setPref('chart-report', 'events');
    // The chart's view on screen opens that way too.
    requestViewChange(id, { ...(display ? { display } : {}), ...(events ? { report: 'events' as const } : {}) });
    navigate(`/charts/${id}`, { replace: true });
  }, [id]);
  return null;
}
