/**
 * AstrologyStudio ·
 * web/src/components/Midpoints.tsx
 *
 * Midpoints in the Midpoints report:
 *
 * the midpoint sort (every factor and midpoint in order round the dial, or the midpoints closest
 * to a factor first) and a search for any degree. Worked out here from the selected chart's
 * positions, so they work for every kind of chart: saved, transits, returns, harmonic, composite
 * or Davison.
 *
 * Copyright (c) 2026 Gavin Melhuish
 * MIT License; see LICENSE in the project root.
 * SPDX-License-Identifier: MIT
 */

import { useEffect, useRef, useState } from 'preact/hooks';
import { dm, midpointSort, onAxis, parseDegree, textGlyph, zodiac, type AxisItem, type SortRow } from '../astro';
import { sizeLabel } from '../display';
import { oneOf, usePref } from '../prefs';
import { useView } from '../view';

type Tab = 'sort' | 'search';
const TABS: Array<[Tab, string]> = [['sort', 'Midpoint sort'], ['search', 'Search']];
type Order = 'dial' | 'orb';

export function MidpointPanel({ lons, glyphs, modulus, orb, half, pointer, onPointer }: {
  /** The selected chart's bodies (those shown), by key. */
  lons: Record<string, number>;
  glyphs: Record<string, string>;
  modulus: number;
  orb: number;
  half: boolean;
  pointer: number;
  /** Put the pointer on a dial position. */
  onPointer: (dial: number) => void;
}) {
  const { catalog } = useView();
  const [tab, setTab] = usePref<Tab>('dial-midpoint-tab', 'sort', oneOf<Tab>('sort', 'search'));
  const [order, setOrder] = usePref<Order>('dial-midpoint-order', 'dial', oneOf<Order>('dial', 'orb'));
  const [text, setText] = useState('');
  const label = (k: string) => catalog.bodies.find((b) => b.key === k)?.label ?? k;
  const name = (r: { a: string; b: string | null }) => (r.b ? `${label(r.a)}/${label(r.b)}` : label(r.a));
  const pair = (r: { a: string; b: string | null }) => (
    <span class="nowrap"><span class="glyph">{textGlyph(glyphs[r.a] ?? r.a.slice(0, 2))}</span>
      {r.b && <>/<span class="glyph">{textGlyph(glyphs[r.b] ?? r.b.slice(0, 2))}</span></>}</span>
  );
  const degree = parseDegree(text);
  const toDial = (lon: number) => ((lon % modulus) + modulus) % modulus;

  return (
    <section class="midpoint-panel" aria-label="Midpoints">
      <nav class="tabs" role="tablist" aria-label="Midpoints">
        {TABS.map(([t, l]) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} class={`tabs__tab${tab === t ? ' is-active' : ''}`}
                  onClick={() => setTab(t)}>{l}</button>
        ))}
      </nav>
      {tab === 'sort' && (
        <>
          <div class="segmented segmented--small" role="group" aria-label="Order">
            <button type="button" class={order === 'dial' ? 'is-active' : ''} aria-pressed={order === 'dial'}
                    onClick={() => setOrder('dial')}>Round the dial</button>
            <button type="button" class={order === 'orb' ? 'is-active' : ''} aria-pressed={order === 'orb'}
                    onClick={() => setOrder('orb')}>Closest to exact</button>
          </div>
          {order === 'dial' ? (
            <>
              <p class="muted small">Every factor and midpoint in order round the {sizeLabel(modulus)} dial, from 0°. Click one to put the pointer there.</p>
              <SortTable rows={midpointSort(lons, modulus)} name={name} pair={pair} near={pointer} modulus={modulus}
                         onPick={(r) => onPointer(r.dial)} />
            </>
          ) : (
            <>
              <p class="muted small">Midpoints within {orb}° of a factor{half ? ` (or ${modulus / 2}° from it)` : ''}, closest to exact first. Click one to put the pointer there.</p>
              <ExactTable rows={closest(midpointSort(lons, modulus), orb, modulus, half)} name={name} pair={pair}
                          onPick={(r) => onPointer(r.dial)} />
            </>
          )}
        </>
      )}
      {tab === 'search' && (
        <>
          <label class="field">
            <span>Degree</span>
            <input value={text} onInput={(e) => setText(e.currentTarget.value)} placeholder="12.5, 12°30' or 12°30' Leo"
                   aria-label="Degree to search" />
            <small class="muted">
              {text && degree === null ? 'Write a degree, such as 12.5, 12°30\' or 12°30\' Leo.'
                : `Everything within ${orb}° of it on the ${sizeLabel(modulus)} dial.`}
            </small>
          </label>
          {degree !== null && (
            <>
              <button type="button" class="link-button" onClick={() => onPointer(toDial(degree))}>Put the pointer on {dm(toDial(degree))}</button>
              <AxisTable items={onAxis(lons, degree, orb, modulus, half)} name={name} pair={pair} />
            </>
          )}
        </>
      )}
    </section>
  );
}

function AxisTable({ items, name, pair }: {
  items: AxisItem[]; name: (r: AxisItem) => string; pair: (r: AxisItem) => preact.JSX.Element;
}) {
  if (!items.length) return <p class="muted small">Nothing within orb.</p>;
  return (
    <table class="table table--compact data-table">
      <thead><tr><th>Factor</th><th /><th>Orb</th></tr></thead>
      <tbody>
        {items.map((r) => (
          <tr key={`${r.a}-${r.b}`} title={`${name(r)} at ${zodiac(r.lon)}`}>
            <td>{pair(r)}</td>
            <td>{name(r)}</td>
            <td class="num">{dm(r.orb)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function SortTable({ rows, name, pair, near, modulus, onPick }: {
  rows: SortRow[]; name: (r: SortRow) => string; pair: (r: SortRow) => preact.JSX.Element;
  near: number; modulus: number; onPick: (r: SortRow) => void;
}) {
  // The row nearest the pointer is marked, so the sort reads from where you are.
  const gap = (r: SortRow) => { const d = Math.abs(r.dial - near) % modulus; return Math.min(d, modulus - d); };
  const nearest = rows.reduce<SortRow | null>((best, r) => (best === null || gap(r) < gap(best) ? r : best), null);
  const box = useRef<HTMLDivElement>(null);
  const key = nearest ? `${nearest.a}-${nearest.b}` : '';
  // Keep the row at the pointer in view, so the sort reads from where you are.
  useEffect(() => {
    const row = box.current?.querySelector<HTMLElement>('tr.is-focus');
    const area = box.current;
    if (row && area) area.scrollTop = row.offsetTop - area.clientHeight / 2;
  }, [key]);
  return (
    <div class="sort-table" ref={box}>
      <table class="table table--compact data-table">
        <thead><tr><th>Dial</th><th>Factor</th><th /></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.a}-${r.b}`} class={`${r.b ? '' : 'is-factor'}${r === nearest ? ' is-focus' : ''}`}
                onClick={() => onPick(r)} style={{ cursor: 'pointer' }} title={`${name(r)} at ${zodiac(r.lon)}`}>
              <td class="num">{dm(r.dial)}</td>
              <td>{pair(r)}</td>
              <td>{name(r)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A midpoint and the factor it's nearest to, within orb. */
type Exact = SortRow & { to: SortRow; orb: number };

/** The midpoints within orb of a factor (not one of their own), closest to exact first. With
 * `half`, half the dial away counts too (45° on the 90° dial). Each midpoint is listed once, with
 * the factor it's closest to. */
export function closest(rows: SortRow[], orb: number, modulus: number, half: boolean): Exact[] {
  const factors = rows.filter((r) => r.b === null);
  const gap = (x: number, y: number) => {
    const d = (((x - y) % modulus) + modulus) % modulus;
    const plain = Math.min(d, modulus - d);
    return half ? Math.min(plain, Math.abs(modulus / 2 - plain)) : plain;
  };
  const found: Exact[] = [];
  for (const m of rows) {
    if (m.b === null) continue;
    let best: Exact | null = null;
    for (const f of factors) {
      if (f.a === m.a || f.a === m.b) continue;
      const d = gap(m.dial, f.dial);
      if (d <= orb && (!best || d < best.orb)) best = { ...m, to: f, orb: d };
    }
    if (best) found.push(best);
  }
  return found.sort((x, y) => x.orb - y.orb);
}

function ExactTable({ rows, name, pair, onPick }: {
  rows: Exact[]; name: (r: SortRow) => string; pair: (r: SortRow) => preact.JSX.Element; onPick: (r: Exact) => void;
}) {
  if (!rows.length) return <p class="muted small">No midpoints within orb of a factor.</p>;
  return (
    <div class="sort-table">
      <table class="table table--compact data-table">
        <thead><tr><th>Midpoint</th><th /><th>Factor</th><th class="num">Orb</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.a}-${r.b}`} onClick={() => onPick(r)} style={{ cursor: 'pointer' }}
                title={`${name(r)} = ${name(r.to)}, ${dm(r.orb)} from exact`}>
              <td>{pair(r)}</td>
              <td class="muted">=</td>
              <td>{pair(r.to)} {name(r.to)}</td>
              <td class="num">{dm(r.orb)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
