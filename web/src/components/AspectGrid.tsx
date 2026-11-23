/**
 * AstrologyStudio ·
 * web/src/components/AspectGrid.tsx
 *
 * The aspect grid (aspectarian):
 *
 * a triangle for one chart, a square for two.
 *
 * Copyright (c) 2026 Gavin Melhuish
 * MIT License; see LICENSE in the project root.
 * SPDX-License-Identifier: MIT
 */

import type { FoundAspect } from '../api';
import { ASPECT_INFO, textGlyph } from '../astro';

interface Props {
  rows: string[];
  /** Columns for a two-chart grid (rows = inner chart, columns = outer); omit for one chart. */
  columns?: string[];
  aspects: FoundAspect[];
  glyphs: Record<string, string>;
  focus?: string | null;
  onFocus?: (key: string | null) => void;
  /** One chart only: each body's symbol on the diagonal, at the end of its row and the top of its
   * column, instead of a header row and column (the classic aspectarian staircase). */
  diagonal?: boolean;
  /** Aspects by whole sign (the Hellenistic chart): no orbs, an arrow on the overcoming body's
   * side of a square, and pairs in aversion hatched. */
  bySign?: boolean;
  /** Names for hover text, by body key. */
  labels?: Record<string, string>;
}

const ARROW = '\u2191';

export function AspectGrid({ rows, columns, aspects, glyphs, focus, onFocus, diagonal, bySign, labels }: Props) {
  const lookup = new Map<string, FoundAspect>();
  for (const a of aspects) {
    lookup.set(`${a.a}|${a.b}`, a);
    if (!columns) lookup.set(`${a.b}|${a.a}`, a);
  }
  const cols = columns ?? rows;
  const glyph = (k: string) => textGlyph(glyphs[k] ?? k.slice(0, 2));
  const name = (k: string) => labels?.[k] ?? k;
  const cell = (r: string, c: string) => {
    const a = lookup.get(`${r}|${c}`);
    const info = a ? ASPECT_INFO[a.aspect] : undefined;
    if (bySign) {
      // The body that overcomes, as a key, whichever way round the pair was listed.
      const over = a?.overcoming ? (a.overcoming === 'a' ? a.a : a.b) : null;
      const under = over ? (over === r ? c : r) : null;
      const title = !a
        ? `${name(r)} and ${name(c)} are in aversion (no aspect by sign)`
        : `${over ? `${name(over)} overcomes ${name(under!)}` : `${name(r)} ${info?.name ?? a.aspect} ${name(c)}`}`
          + ` (${info?.name.toLowerCase() ?? a.aspect} by sign, ${Math.round(a.degrees_apart ?? 0)}° apart)`;
      return (
        <td key={c} class={a ? `aspect-cell aspect-cell--${info?.kind ?? 'neutral'}` : 'aspect-cell--aversion'}
            onMouseEnter={() => onFocus?.(a ? r : null)} onMouseLeave={() => onFocus?.(null)} title={title}>
          {a && (
            <>
              <span class="aspect-cell__glyph" style={a ? { color: `var(--t-aspect-${a.aspect})` } : undefined}>{textGlyph(info?.glyph ?? '?')}</span>
              {over && <small title={`${name(over)} overcomes`}>{ARROW}{textGlyph(glyphs[over] ?? '')}</small>}
            </>
          )}
        </td>
      );
    }
    return (
      <td key={c} class={a ? `aspect-cell aspect-cell--${info?.kind ?? 'neutral'}` : ''}
          onMouseEnter={() => onFocus?.(a ? r : null)} onMouseLeave={() => onFocus?.(null)}
          title={a ? `${r} ${info?.name ?? a.aspect} ${c}, orb ${a.orb.toFixed(2)}°${a.applying === null ? '' : a.applying ? ', applying' : ', separating'}` : undefined}>
        {a && (
          <>
            <span class="aspect-cell__glyph" style={a ? { color: `var(--t-aspect-${a.aspect})` } : undefined}>{textGlyph(info?.glyph ?? '?')}</span>
            <small>{a.orb.toFixed(0)}{a.applying === null ? '' : a.applying ? 'a' : 's'}</small>
          </>
        )}
      </td>
    );
  };
  if (diagonal && !columns) {
    return (
      <div class="table-scroll">
        <table class="aspect-grid aspect-grid--diagonal">
          <tbody>
            {rows.map((r, ri) => (
              <tr key={r}>
                {rows.slice(0, ri).map((c) => cell(r, c))}
                <th scope="row" title={r}
                    class={`${focus === r ? 'is-focus' : ''}${/^[A-Za-z]/.test(glyphs[r] ?? r) ? ' aspect-grid__letters' : ''}`}>{glyph(r)}</th>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  return (
    <div class="table-scroll">
      <table class="aspect-grid">
        <thead>
          <tr>
            <th />
            {(columns ? cols : cols.slice(0, -1)).map((c) => <th key={c} scope="col" title={c} class={focus === c ? 'is-focus' : ''}>{glyph(c)}</th>)}
          </tr>
        </thead>
        <tbody>
          {(columns ? rows : rows.slice(1)).map((r, ri) => (
            <tr key={r}>
              <th scope="row" title={r} class={focus === r ? 'is-focus' : ''}>{glyph(r)}</th>
              {(columns ? cols : cols.slice(0, ri + 1)).map((c) => {
                // In a single chart, row r is paired only with bodies listed before it.
                const a = lookup.get(columns ? `${c}|${r}` : `${r}|${c}`) ?? lookup.get(`${r}|${c}`);
                const info = a ? ASPECT_INFO[a.aspect] : undefined;
                return (
                  <td key={c} class={a ? `aspect-cell aspect-cell--${info?.kind ?? 'neutral'}` : ''}
                      onMouseEnter={() => onFocus?.(a ? r : null)} onMouseLeave={() => onFocus?.(null)}
                      title={a ? `${r} ${info?.name ?? a.aspect} ${c}, orb ${a.orb.toFixed(2)}°${a.applying === null ? '' : a.applying ? ', applying' : ', separating'}` : undefined}>
                    {a && (
                      <>
                        <span class="aspect-cell__glyph" style={a ? { color: `var(--t-aspect-${a.aspect})` } : undefined}>{textGlyph(info?.glyph ?? '?')}</span>
                        <small>{a.orb.toFixed(0)}{a.applying === null ? '' : a.applying ? 'a' : 's'}</small>
                      </>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
