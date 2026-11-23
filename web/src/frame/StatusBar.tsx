/**
 * AstrologyStudio ·
 * web/src/frame/StatusBar.tsx
 *
 * The status bar along the bottom:
 *
 * whether ephemeralREST is answering (checked every five minutes, and again when you click the
 * dot), what's open, how many charts you have, and the version. View → Status bar hides it.
 *
 * Copyright (c) 2026 Gavin Melhuish
 * MIT License; see LICENSE in the project root.
 * SPDX-License-Identifier: MIT
 */

import { useEffect, useState } from 'preact/hooks';
import { api, type Connection } from '../api';
import { plainWording } from '../hosted';
import { date as fmtDate, time as fmtTime } from '../fmt';
import { chartOf, tabTitle, useCharts } from './store';

const EVERY = 5 * 60 * 1000;

type Health = { state: 'checking' } | { state: 'ok'; url: string | null } | { state: 'down'; url: string | null; problem: string | null };

let version: string | null = null;

export function StatusBar({ activeKey }: { activeKey: string | null }) {
  const list = useCharts();
  const [health, setHealth] = useState<Health>({ state: 'checking' });
  const [, setVersionLoaded] = useState(false);

  const check = () => {
    setHealth({ state: 'checking' });
    api<Connection>('/connection')
      .then((c) => setHealth(c.reachable ? { state: 'ok', url: c.url } : { state: 'down', url: c.url, problem: c.problem }))
      .catch(() => setHealth({ state: 'down', url: null, problem: null }));
  };
  useEffect(() => {
    check();
    const timer = setInterval(check, EVERY);
    if (!version) {
      void api<{ version: string }>('/health').then((h) => { version = h.version; setVersionLoaded(true); }).catch(() => undefined);
    }
    return () => clearInterval(timer);
  }, []);

  const host = (url: string | null) => { try { return url ? new URL(url).host : 'not set up'; } catch { return url ?? 'not set up'; } };
  const plain = plainWording();
  const connection = health.state === 'checking' ? (plain ? 'Checking…' : 'ephemeralREST · checking…')
    : health.state === 'ok' ? (plain ? 'Connected' : `ephemeralREST · ${host(health.url)}`)
    : plain ? 'Can’t reach the calculation service' : `ephemeralREST · ${health.url ? `${host(health.url)} not answering` : 'not set up'}`;
  const tip = health.state === 'down' && health.problem ? `${health.problem}. Click to check again.` : 'Click to check again';

  const id = activeKey ? chartOf(activeKey) : null;
  const chart = id && list.state === 'ready' ? list.data.find((c) => c.id === id) : undefined;
  const where = chart
    ? [chart.name, fmtDate(chart.date), chart.time_unknown ? 'time unknown' : fmtTime(chart.time), chart.place].filter(Boolean).join(' · ')
    : activeKey ? tabTitle(activeKey, list) : '';

  return (
    <footer class="status-bar" aria-label="Status">
      <button type="button" class={`status-bar__item status-bar__health is-${health.state}`} onClick={check} title={tip}>
        <span class="status-dot" aria-hidden="true" />
        <span>{connection}</span>
      </button>
      <span class="status-bar__item status-bar__where">{where}</span>
      <span class="status-bar__spacer" />
      {list.state === 'ready' && <span class="status-bar__item">{list.data.length} {list.data.length === 1 ? 'chart' : 'charts'}</span>}
      {version && <span class="status-bar__item">AstrologyStudio {version}</span>}
    </footer>
  );
}

export const appVersion = (): string | null => version;
