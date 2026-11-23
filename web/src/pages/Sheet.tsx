/**
 * AstrologyStudio ·
 * web/src/pages/Sheet.tsx
 *
 * A one-page client sheet:
 *
 * wheel, positions and aspect grid, ready to print or save as PDF.
 *
 * Copyright (c) 2026 Gavin Melhuish
 * MIT License; see LICENSE in the project root.
 * SPDX-License-Identifier: MIT
 */

import { useEffect } from 'preact/hooks';
import { api, type ChartDetail } from '../api';
import { HOUSE_SYSTEM_NAMES, houseOf, offsetText, signed, textGlyph, zodiac } from '../astro';
import { AspectGrid } from '../components/AspectGrid';
import { Wheel } from '../components/Wheel';
import { Link } from '../router';
import { Loading, useLoad } from '../ui';
import { useView } from '../view';
import { birthLine, useGlyphs, useShownKeys } from './ChartView';
import { retroMark } from '../fmt';
import { ChartStyleContext, chartStyleOf, tokenVars, useAppearance } from '../appearance';
import { oneOf, usePref } from '../prefs';

export function Sheet({ id }: { id: string }) {
  const [chart] = useLoad(() => api<ChartDetail>(`/charts/${id}`), [id]);
  useEffect(() => {
    document.body.classList.add('printing');
    return () => document.body.classList.remove('printing');
  }, []);
  return <Loading result={chart}>{() => chart.state === 'ready' && <SheetBody chart={chart.data} />}</Loading>;
}

function SheetBody({ chart }: { chart: ChartDetail }) {
  const { catalog } = useView();
  const glyphs = useGlyphs();
  const keys = useShownKeys(chart.points);
  const shown = new Set(keys);
  const aspects = chart.aspects.filter((a) => shown.has(a.a) && shown.has(a.b));
  const label = (k: string) => catalog.bodies.find((b) => b.key === k)?.label ?? k;
  // Printed on white: Monochrome unless you choose your own theme's light version.
  const { view, theme, appearance } = useAppearance();
  const [colours, setColours] = usePref<'mono' | 'theme'>('sheet-colours', 'mono', oneOf<'mono' | 'theme'>('mono', 'theme'));
  const sheetTheme = colours === 'theme' ? theme : view.themes.find((t) => t.id === 'mono') ?? theme;
  return (
    <>
      <div class="sheet-tools no-print">
        <Link href={`/charts/${chart.id}`}>← {chart.name}</Link>
        <span class="sheet-tools__right">
          <label class="sheet-tools__colours">Colours{' '}
            <select value={colours} onChange={(e) => setColours(e.currentTarget.value as 'mono' | 'theme')}>
              <option value="mono">Monochrome</option>
              <option value="theme">{theme.name} (light)</option>
            </select>
          </label>
          <button type="button" class="btn btn--primary" onClick={() => window.print()}>Print or save as PDF</button>
        </span>
      </div>
      <ChartStyleContext.Provider value={chartStyleOf(sheetTheme, appearance)}>
      <article class="sheet themed" style={tokenVars(sheetTheme, 'light')}>
        <header class="sheet__head">
          <div>
            <h1>{chart.name}</h1>
            <p>{birthLine(chart)}</p>
            <p class="muted">
              {chart.datetime_utc.replace('T', ' ').slice(0, 16)} UT · {offsetText(chart.location.utc_offset_seconds)}
              {chart.location.latitude !== null && chart.location.longitude !== null && ` · ${signed(chart.location.latitude)}, ${signed(chart.location.longitude, 'E', 'W')}`}
              {' · '}{HOUSE_SYSTEM_NAMES[chart.house_system ?? ''] ?? 'no'} houses · {chart.profile.zodiac}
            </p>
          </div>
          <div class="sheet__brand">AstrologyStudio</div>
        </header>
        <div class="sheet__body">
          <div class="sheet__wheel">
            <Wheel rings={[{ points: chart.points, keys }]} houses={chart.houses} aspects={aspects} glyphs={glyphs} title={chart.name} />
          </div>
          <table class="sheet__positions">
            <tbody>
              {keys.map((k) => {
                const p = chart.points[k]!;
                return (
                  <tr key={k}>
                    <td><span class="glyph">{textGlyph(glyphs[k] ?? '')}</span> {label(k)}</td>
                    <td class="nowrap">{zodiac(p.lon)}{p.retro ? ` ${retroMark()}` : ''}</td>
                    <td>{chart.houses && !['asc', 'mc', 'vertex', 'east_point'].includes(k) ? houseOf(p.lon, chart.houses) : ''}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div class="sheet__grid">
          <AspectGrid rows={keys} aspects={aspects} glyphs={glyphs} />
        </div>
      </article>
      </ChartStyleContext.Provider>
    </>
  );
}
