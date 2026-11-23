/**
 * AstrologyStudio ·
 * web/src/pages/EphemerisPage.tsx
 *
 * A month of the ephemeris:
 *
 * daily positions at noon UT, with ingresses, stations, lunations and eclipses.
 *
 * Copyright (c) 2026 Gavin Melhuish
 * MIT License; see LICENSE in the project root.
 * SPDX-License-Identifier: MIT
 */

import { useState } from 'preact/hooks';
import { api } from '../api';
import { SIGNS, textGlyph, zodiac } from '../astro';
import { Loading, PageHeader, useLoad } from '../ui';
import { useView } from '../view';
import { useGlyphs } from './ChartView';
import { retroMark } from '../fmt';

interface Month {
  year: number;
  month: number;
  days: Record<string, Record<string, { lon: number; speed: number }>>;
  events: Array<{ date: string; body: string; kind: 'ingress' | 'station'; sign?: number; direction?: string }>;
  lunations: Array<{ phase: string; datetime_utc: string; moon_longitude?: number }>;
  eclipses: Array<{ type: string; eclipse_type: string; datetime_utc: string }>;
}

const PHASES: Record<string, string> = { new_moon: 'New Moon', first_quarter: 'First quarter', full_moon: 'Full Moon', last_quarter: 'Last quarter' };

export function EphemerisPage() {
  const now = new Date();
  const [ym, setYm] = useState({ y: now.getUTCFullYear(), m: now.getUTCMonth() + 1 });
  const [data] = useLoad(() => api<Month>(`/ephemeris?year=${ym.y}&month=${ym.m}`), [ym.y, ym.m]);
  const { catalog, body } = useView();
  const glyphs = useGlyphs();
  const columns = catalog.bodies.filter((b) => body(b.key) && b.group !== 'Angles' && !['part_of_fortune', 'earth'].includes(b.key));
  const label = (k: string) => catalog.bodies.find((b) => b.key === k)?.label ?? k;
  const step = (by: number) => setYm(({ y, m }) => {
    const t = y * 12 + (m - 1) + by;
    return { y: Math.floor(t / 12), m: (t % 12) + 1 };
  });
  const title = new Date(Date.UTC(ym.y, ym.m - 1, 1)).toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' });

  return (
    <>
      <PageHeader title="Ephemeris" intro="Positions at noon UT each day." />
      <div class="moving">
        <div class="segmented">
          <button type="button" onClick={() => step(-1)} aria-label="Previous month">◀</button>
          <button type="button" class="is-active month-title">{title}</button>
          <button type="button" onClick={() => step(1)} aria-label="Next month">▶</button>
        </div>
        <label class="inline-select"><span>Go to</span>
          <input type="month" value={`${ym.y}-${String(ym.m).padStart(2, '0')}`}
                 onChange={(e) => { const [y, m] = e.currentTarget.value.split('-').map(Number); if (y && m) setYm({ y, m }); }} />
        </label>
      </div>
      <Loading result={data}>
        {() => data.state === 'ready' && (
          <div class="ephemeris-layout">
            <div class="table-scroll ephemeris-table">
              <table class="table table--compact data-table">
                <thead><tr><th>Day</th>{columns.map((c) => <th key={c.key} title={c.label} class="glyph-head">{textGlyph(glyphs[c.key] ?? c.glyph)}</th>)}</tr></thead>
                <tbody>
                  {Object.keys(data.data.days).sort().map((d) => (
                    <tr key={d}>
                      <td class="nowrap">{Number(d.slice(8))}</td>
                      {columns.map((c) => {
                        const p = data.data.days[d]![c.key];
                        return <td key={c.key} class="nowrap">{p ? <>{zodiac(p.lon)}{p.speed < 0 && <span class="retro">{retroMark()}</span>}</> : ''}</td>;
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <aside class="card ephemeris-events">
              <h2 class="card__title">This month</h2>
              <ul class="plain-list event-list">
                {[
                  ...data.data.lunations.map((l) => ({ when: l.datetime_utc, text: `${PHASES[l.phase] ?? l.phase}${l.moon_longitude !== undefined ? ` ${zodiac(l.moon_longitude)}` : ''}`, glyph: l.phase === 'full_moon' ? '○' : l.phase === 'new_moon' ? '●' : '◐' })),
                  ...data.data.eclipses.map((e) => ({ when: e.datetime_utc, text: `${e.eclipse_type} ${e.type} eclipse`, glyph: '◉' })),
                  ...data.data.events.map((e) => ({
                    when: `${e.date}T12:00:00`,
                    text: e.kind === 'ingress' ? `${label(e.body)} enters ${SIGNS[e.sign ?? 0]}` : `${label(e.body)} stations ${e.direction}`,
                    glyph: glyphs[e.body] ?? '',
                  })),
                ].sort((a, b) => a.when.localeCompare(b.when)).map((e, i) => (
                  <li key={i}><span class="event-date">{Number(e.when.slice(8, 10))}</span><span class="glyph">{textGlyph(e.glyph)}</span> {e.text}</li>
                ))}
              </ul>
              <p class="muted small">Ingresses and stations are dated to the noon after they happen.</p>
            </aside>
          </div>
        )}
      </Loading>
    </>
  );
}
