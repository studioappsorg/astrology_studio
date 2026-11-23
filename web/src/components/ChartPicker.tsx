/**
 * AstrologyStudio ·
 * web/src/components/ChartPicker.tsx
 *
 * The top of the panel:
 *
 * which chart you're looking at, a search to switch to any of your charts (staying on the same
 * kind of screen, in the same tab), and a button for a new chart.
 *
 * Copyright (c) 2026 Gavin Melhuish
 * MIT License; see LICENSE in the project root.
 * SPDX-License-Identifier: MIT
 */

import { useEffect, useRef, useState } from 'preact/hooks';
import { api, type ChartSummary } from '../api';
import { Link, navigate } from '../router';
import { useLoad } from '../ui';
import { switchTab } from '../frame/store';
import { date as fmtDate, time as fmtTime } from '../fmt';

export function ChartPicker({ id, name, line, screen = '' }: {
  id: string;
  name: string;
  line: string;
  /** The screen to stay on when switching: '' for the chart, '/dial', '/returns', ... */
  screen?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [list] = useLoad(() => api<{ data: ChartSummary[] }>('/charts'));
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const matches = list.state === 'ready'
    ? list.data.data.filter((c) => words.every((w) => `${c.name} ${c.date ?? ''} ${c.place ?? ''} ${c.tags.join(' ')}`.toLowerCase().includes(w))).slice(0, 50)
    : [];
  return (
    <div class="picker" ref={box}>
      <div class="picker__current">
        <button type="button" class="picker__name" onClick={() => setOpen(!open)} aria-expanded={open} title="Switch chart">
          <span>{name}</span><span class="picker__caret" aria-hidden="true">▾</span>
        </button>
        <Link href="/charts/new" class="btn btn--small" aria-label="New chart">+ New</Link>
      </div>
      <p class="picker__line">{line}</p>
      {open && (
        <div class="picker__menu">
          <input type="search" placeholder="Search your charts" value={q} autoFocus
                 onInput={(e) => setQ(e.currentTarget.value)} aria-label="Search your charts" />
          <ul>
            {matches.map((c) => (
              <li key={c.id}>
                <button type="button" class={c.id === id ? 'is-current' : ''}
                        onClick={() => { setOpen(false); setQ(''); switchTab(`/charts/${id}`, `/charts/${c.id}${screen}`); navigate(`/charts/${c.id}${screen}`); }}>
                  <strong>{c.name}</strong>
                  <small>{[fmtDate(c.date), c.time_unknown ? '' : fmtTime(c.time), c.place].filter(Boolean).join(' · ')}</small>
                </button>
              </li>
            ))}
            {list.state === 'ready' && matches.length === 0 && <li class="muted small picker__none">No charts match</li>}
          </ul>
          <div class="picker__foot"><Link href="/charts">All charts, folders and tags</Link></div>
        </div>
      )}
    </div>
  );
}

/** Links to the chart's other screens, shown when their features are on. */
export function ChartTools({ id, current, feature }: { id: string; current: string; feature: (k: string) => boolean }) {
  const tools: Array<[string, string, boolean]> = [
    ['', 'Chart', true],
    ['/with', 'With…', feature('synastry') || feature('composite') || feature('davison')],
    ['/returns', 'Returns', feature('returns')],
    ['/edit', 'Edit', true],
  ];
  return (
    <nav class="tool-links" aria-label="Chart screens">
      {tools.filter(([, , on]) => on).map(([path, label]) => (
        <Link key={path} href={`/charts/${id}${path}`} class={`tool-link${current === path ? ' is-active' : ''}`}>{label}</Link>
      ))}
    </nav>
  );
}
