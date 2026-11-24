/**
 * AstrologyStudio ·
 * web/src/pages/Sheet.tsx
 *
 * A one-page client sheet:
 *
 * a large wheel, the positions and house cusps, the elements and modalities, the aspectarian and
 * the owner's business box, sized to fit one portrait page of A4 or US Letter (the space both
 * share: 190 × 255 mm inside 10 mm margins). The more bodies there are, the smaller the
 * aspectarian's squares, from 7.5 mm down to 5 mm; past that the wheel gives up some room. When
 * that would make the wheel small, or the page still doesn't fit, the sheet goes onto two pages:
 * the wheel across the full width of page 1 with the business box, and the aspectarian and the
 * tables on page 2.
 *
 * Copyright (c) 2026 Gavin Melhuish
 * MIT License; see LICENSE in the project root.
 * SPDX-License-Identifier: MIT
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { api, type ChartDetail } from '../api';
import { HOUSE_SYSTEM_NAMES, houseOf, offsetText, signed, SIGN_GLYPHS, textGlyph, zodiac } from '../astro';
import { balance } from '../overview';
import { BalanceTable, signatureText, useOverviewChoices } from './OverviewReport';
import { AspectGrid } from '../components/AspectGrid';
import { Wheel } from '../components/Wheel';
import { Link } from '../router';
import { Loading, useLoad } from '../ui';
import { useView } from '../view';
import { birthLine, useGlyphs, useShownKeys } from './ChartView';
import { retroMark } from '../fmt';
import { ChartStyleContext, chartStyleOf, tokenVars, useAppearance } from '../appearance';
import { oneOf, usePref } from '../prefs';
import { useBranding } from '../branding';

const ANGLES = ['asc', 'mc', 'dsc', 'ic', 'vertex', 'east_point'];

export function Sheet({ id }: { id: string }) {
  const [chart] = useLoad(() => api<ChartDetail>(`/charts/${id}`), [id]);
  useEffect(() => {
    document.body.classList.add('printing');
    return () => document.body.classList.remove('printing');
  }, []);
  return <Loading result={chart}>{() => chart.state === 'ready' && <SheetBody chart={chart.data} />}</Loading>;
}

/** Sizes in mm for the page: what's left below the header for the wheel and aspectarian. */
const PAGE_HEIGHT = 255;
const BELOW_HEADER = 226;
const LEFT_COLUMN = 132;
/** The wheel stops a little short of the column, leaving the aspectarian more room. */
const WHEEL = 126;
const GAP = 5;

/** The aspectarian's square and the wheel's width, in mm, for this many bodies. */
export function sheetSizes(bodies: number): { cell: number; wheel: number } {
  const n = Math.max(bodies, 1);
  const cell = Math.min(7.5, Math.max(5, (BELOW_HEADER - GAP - WHEEL) / n), LEFT_COLUMN / n);
  return { cell, wheel: Math.min(WHEEL, BELOW_HEADER - GAP - n * cell) };
}

/** On two pages (too many bodies for one): the aspectarian's square on page 2, in mm. */
export function secondPageCell(bodies: number): number {
  const n = Math.max(bodies, 1);
  return Math.min(7.5, PAGE2_GRID_WIDTH / n, (PAGE_HEIGHT - PAGE2_HEADER - GAP) / n);
}
const PAGE2_GRID_WIDTH = 130;
const PAGE2_HEADER = 16;
/** Page 1 of two: the wheel across the full width, with room under it for the business box. */
const SOLO_WHEEL = 190;
/** Below this (in mm) the one-page wheel is too small: use two pages instead. */
const MIN_WHEEL = 110;

/** Shrink `inner` until `page` is no taller than a page (a last guard: very long names and the like). */
function fitPage(page: HTMLElement | null, inner: HTMLElement | null): number {
  if (!page || !inner) return 1;
  inner.style.removeProperty('zoom');
  const pad = parseFloat(getComputedStyle(page).paddingTop) || 0;
  const above = inner.getBoundingClientRect().top - page.getBoundingClientRect().top - pad;
  const room = (PAGE_HEIGHT * 96) / 25.4 - above;
  const height = inner.getBoundingClientRect().height;
  if (height <= room + 0.5) return 1;
  const zoom = Math.floor((room / height) * 1000) / 1000;
  inner.style.setProperty('zoom', String(zoom));
  return zoom;
}

function SheetBody({ chart }: { chart: ChartDetail }) {
  const { catalog } = useView();
  const branding = useBranding();
  const logo = branding?.logo ?? null;
  const details = branding?.details ?? '';
  const business = !!(logo || details);
  const glyphs = useGlyphs();
  const keys = useShownKeys(chart.points);
  const { counting } = useOverviewChoices();
  const balanced = balance(chart.points, keys, counting);
  const shown = new Set(keys);
  const aspects = chart.aspects.filter((a) => shown.has(a.a) && shown.has(a.b));
  const label = (k: string) => catalog.bodies.find((b) => b.key === k)?.label ?? k;
  const labels = Object.fromEntries(keys.map((k) => [k, label(k)]));
  const sizes = sheetSizes(keys.length);

  // One page if everything fits without shrinking; otherwise two: the wheel at full width with
  // the business box on page 1, and the aspectarian and tables on page 2. Measured, not guessed,
  // because long business details and names take room too.
  const [measured, setPages] = useState<1 | 2>(1);
  // So many bodies that the wheel would have to shrink well below its usual size: two pages anyway.
  const pages: 1 | 2 = sizes.wheel < MIN_WHEEL ? 2 : measured;
  const layoutKey = `${keys.join()}|${details}|${logo?.length ?? 0}|${counting}`;
  useEffect(() => { setPages(1); }, [layoutKey]);
  const page1 = useRef<HTMLElement>(null);
  const body1 = useRef<HTMLDivElement>(null);
  const page2 = useRef<HTMLElement>(null);
  const body2 = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const fit = () => {
      if (pages === 1) {
        // Shrinking a little (long names) is fine; much more than that, use two pages.
        if (fitPage(page1.current, body1.current) < 0.97) setPages(2);
      } else {
        fitPage(page1.current, body1.current);
        fitPage(page2.current, body2.current);
      }
    };
    fit();
    void document.fonts?.ready.then(fit);
    window.addEventListener('beforeprint', fit);
    return () => window.removeEventListener('beforeprint', fit);
  });
  // Printed on white: Monochrome unless you choose your own theme's light version.
  const { view, theme, appearance } = useAppearance();
  const [colours, setColours] = usePref<'mono' | 'theme'>('sheet-colours', 'mono', oneOf<'mono' | 'theme'>('mono', 'theme'));
  const sheetTheme = colours === 'theme' ? theme : view.themes.find((t) => t.id === 'mono') ?? theme;

  const technical = (
    <p class="muted">
      {chart.datetime_utc.replace('T', ' ').slice(0, 16)} UT · {offsetText(chart.location.utc_offset_seconds)}
      {chart.location.latitude !== null && chart.location.longitude !== null && ` · ${signed(chart.location.latitude)}, ${signed(chart.location.longitude, 'E', 'W')}`}
      {' · '}{HOUSE_SYSTEM_NAMES[chart.house_system ?? ''] ?? 'no'} houses · {chart.profile.zodiac}
    </p>
  );
  const head = (
    <header class="sheet__head">
      <div>
        <h1>{chart.name}</h1>
        <p>{birthLine(chart)}</p>
        {technical}
      </div>
      {!business && branding && <div class="sheet__brand">AstrologyStudio</div>}
    </header>
  );
  const wheel = <Wheel rings={[{ points: chart.points, keys }]} houses={chart.houses} aspects={aspects} glyphs={glyphs} title={chart.name} />;
  const grid = <AspectGrid rows={keys} aspects={aspects} glyphs={glyphs} diagonal labels={labels} />;
  const tables = (
    <>
      <table class="sheet__table">
        <colgroup><col /><col class="sheet__pos" /><col class="sheet__house" /></colgroup>
        <thead><tr><th>Body</th><th>Position</th><th>{chart.houses ? 'House' : ''}</th></tr></thead>
        <tbody>
          {keys.map((k) => {
            const p = chart.points[k]!;
            return (
              <tr key={k}>
                <td><span class="glyph">{textGlyph(glyphs[k] ?? '')}</span> {label(k)}</td>
                <td class="nowrap">{zodiac(p.lon)}{p.retro ? ` ${retroMark()}` : ''}</td>
                <td>{chart.houses && !ANGLES.includes(k) ? houseOf(p.lon, chart.houses) : ''}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {chart.houses && (
        <table class="sheet__table sheet__cusps">
          <colgroup><col class="sheet__num" /><col /><col class="sheet__num" /><col /></colgroup>
          <thead><tr><th colSpan={4}>{HOUSE_SYSTEM_NAMES[chart.house_system ?? ''] ?? ''} house cusps</th></tr></thead>
          <tbody>
            {chart.houses.slice(0, 6).map((c, i) => (
              <tr key={i}>
                <td>{i + 1}</td><td class="nowrap">{zodiac(c)}</td>
                <td>{i + 7}</td><td class="nowrap">{zodiac(chart.houses![i + 6]!)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div class="sheet__balance">
        <p class="sheet__heading">Elements and modalities</p>
        <BalanceTable result={balanced} compact glyph={(k) => <span class="glyph">{textGlyph(glyphs[k] ?? '')}</span>} />
        <p class="sheet__signature">
          <span class="sheet__signature-label">Signature</span>
          <span class="glyph">{balanced.signature.signs.map((sg) => SIGN_GLYPHS[sg]).join(' ')}</span> {signatureText(balanced)}
        </p>
        <p class="sheet__polarity">Active {balanced.polarity.active} · Receptive {balanced.polarity.receptive}</p>
      </div>
    </>
  );
  const businessBox = (wide: boolean) => business && (
    <div class={`sheet__business${wide ? ' sheet__business--wide' : ''}`}>
      {logo && <img class="sheet__logo" src={logo} alt="" />}
      {details && <p class="sheet__details">{details}</p>}
    </div>
  );

  return (
    <>
      <div class="sheet-tools no-print">
        <Link href={`/charts/${chart.id}`}>← {chart.name}</Link>
        <span class="sheet-tools__right">
          {pages === 2 && <span class="muted small">Two pages: there are too many bodies for one.</span>}
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
      {pages === 1 ? (
        <article ref={page1} class="sheet themed" style={tokenVars(sheetTheme, 'light')}>
          {head}
          <div ref={body1} class="sheet__body" style={{ '--sheet-cell': `${sizes.cell.toFixed(2)}mm`, '--sheet-wheel': `${sizes.wheel.toFixed(2)}mm` }}>
            <div class="sheet__left">
              <div class="sheet__wheel">{wheel}</div>
              <div class="sheet__grid">{grid}</div>
            </div>
            <div class="sheet__right">
              {tables}
              {businessBox(false)}
            </div>
          </div>
        </article>
      ) : (
        <>
          <article ref={page1} class="sheet themed sheet--first" style={tokenVars(sheetTheme, 'light')}>
            {head}
            <div ref={body1} class="sheet__solo" style={{ '--sheet-wheel': `${SOLO_WHEEL}mm` }}>
              <div class="sheet__wheel">{wheel}</div>
              {businessBox(true)}
            </div>
          </article>
          <article ref={page2} class="sheet themed sheet--second" style={tokenVars(sheetTheme, 'light')}>
            <header class="sheet__head sheet__head--small">
              <div>
                <h1>{chart.name}</h1>
                <p>{birthLine(chart)}</p>
              </div>
              <div class="sheet__pageno">Page 2</div>
            </header>
            <div ref={body2} class="sheet__body sheet__body--second" style={{ '--sheet-cell': `${secondPageCell(keys.length).toFixed(2)}mm` }}>
              <div class="sheet__left"><div class="sheet__grid">{grid}</div></div>
              <div class="sheet__right">{tables}</div>
            </div>
          </article>
        </>
      )}
      </ChartStyleContext.Provider>
    </>
  );
}
