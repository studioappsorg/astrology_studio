/**
 * AstrologyStudio ·
 * web/src/components/Events.tsx
 *
 * Events beside the chart wheel:
 *
 * every exact transit, progression or solar arc aspect to chart 1 over a range of dates, by month.
 * Hovering an event shows its natal body on the wheel. Which bodies move, and which natal ones
 * they aspect, can be chosen (and are remembered for each kind).
 *
 * Copyright (c) 2026 Gavin Melhuish
 * MIT License; see LICENSE in the project root.
 * SPDX-License-Identifier: MIT
 */

import { useState } from 'preact/hooks';
import { api } from '../api';
import { ASPECT_INFO, textGlyph, zodiac } from '../astro';
import { date as fmtDate, retroMark, time as fmtTime } from '../fmt';
import { oneOf, usePref } from '../prefs';
import type { CatalogBody as BodyInfo } from '../api';
import { Button, Checkbox, describe } from '../ui';
import { useView } from '../view';

type Layer = 'transits' | 'progressions' | 'solar_arc';
interface Event { at: string; mover: string; target: string; aspect: string; retro: boolean; lon: number }

const iso = (d: Date) => d.toISOString().slice(0, 10);
const LIMIT_YEARS: Record<Layer, number> = { transits: 2, progressions: 100, solar_arc: 100 };
/** A chosen set of bodies, or null for the usual set. */
type Choice = string[] | null;
const isChoice = (v: unknown): v is Choice => v === null || (Array.isArray(v) && v.every((x) => typeof x === 'string'));
/** Points that only exist in the birth chart: transiting or progressed bodies can't be them. */
const FIXED_GROUPS = new Set(['Angles', 'Lots']);

export function EventsPane({ chartId, glyphs, onFocus }: {
  chartId: string; glyphs: Record<string, string>; onFocus: (key: string | null) => void;
}) {
  const { feature, catalog, body } = useView();
  const layers = ([['transits', 'Transits'], ['progressions', 'Progressions'], ['solar_arc', 'Solar arc']] as Array<[Layer, string]>)
    .filter(([l]) => feature(l));
  const [layerPref, setLayer] = usePref<Layer>('events-layer', 'transits', oneOf<Layer>('transits', 'progressions', 'solar_arc'));
  const layer = layers.some(([l]) => l === layerPref) ? layerPref : layers[0]?.[0] ?? 'transits';
  const today = new Date();
  const [start, setStart] = useState(iso(today));
  const [end, setEnd] = useState(iso(new Date(today.getFullYear() + 1, today.getMonth(), today.getDate())));
  const [minor, setMinor] = useState(false);
  const [list, setList] = useState<Event[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const label = (k: string) => catalog.bodies.find((b) => b.key === k)?.label ?? k;
  // The bodies on offer: the ones switched on in Your view. Transits and progressions move only
  // real bodies; solar arc moves everything, angles and lots included.
  const shown = catalog.bodies.filter((b) => body(b.key) && b.key !== 'earth');
  const movable = layer === 'solar_arc' ? shown : shown.filter((b) => !FIXED_GROUPS.has(b.group) && b.key !== 'aries_point');
  const usualMovers = layer === 'transits' ? movable.filter((b) => b.key !== 'moon') : movable;
  const [moverPref, setMovers] = usePref<Choice>(`events-movers-${layer.replace('_', '-')}`, null, isChoice);
  const [targetPref, setTargets] = usePref<Choice>('events-targets', null, isChoice);
  const movers = moverPref ? movable.filter((b) => moverPref.includes(b.key)).map((b) => b.key) : usualMovers.map((b) => b.key);
  const targets = targetPref ? shown.filter((b) => targetPref.includes(b.key)).map((b) => b.key) : shown.map((b) => b.key);
  const glyph = (k: string) => <span class="glyph">{textGlyph(glyphs[k] ?? k.slice(0, 2))}</span>;

  const pick = (l: Layer) => {
    setLayer(l);
    setList(null);
    // A sensible range for each: a year of transits, ten years of progressions or solar arc.
    setEnd(iso(new Date(new Date(start).getFullYear() + (l === 'transits' ? 1 : 10), today.getMonth(), today.getDate())));
  };
  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const params = new URLSearchParams({ start, end, layer, majors_only: String(!minor) });
      params.set('movers', movers.join(','));
      params.set('targets', targets.join(','));
      setList((await api<{ events: Event[] }>(`/charts/${chartId}/events?${params.toString()}`)).events);
    } catch (e) {
      setError(describe(e));
    } finally {
      setBusy(false);
    }
  };
  const prefix = layer === 'transits' ? 't' : layer === 'progressions' ? 'p' : 'sa';
  let month = '';

  return (
    <div class="events-pane">
      <form class="events-controls" onSubmit={(e) => { e.preventDefault(); void run(); }}>
        <div class="segmented" role="group" aria-label="Kind of event">
          {layers.map(([l, name]) => (
            <button key={l} type="button" class={layer === l ? 'is-active' : ''} aria-pressed={layer === l} onClick={() => pick(l)}>{name}</button>
          ))}
        </div>
        <div class="events-controls__dates">
          <label class="inline-select"><span>From</span><input type="date" value={start} onChange={(e) => setStart(e.currentTarget.value)} /></label>
          <label class="inline-select"><span>To</span><input type="date" value={end} onChange={(e) => setEnd(e.currentTarget.value)} /></label>
        </div>
        <BodyPicker title={layer === 'transits' ? 'Transiting' : layer === 'progressions' ? 'Progressed' : 'Solar arc'}
                    bodies={movable} chosen={movers} glyphs={glyphs} usual={usualMovers.map((b) => b.key)}
                    onChange={(keys) => { setMovers(keys); setList(null); }} />
        <BodyPicker title="To natal" bodies={shown} chosen={targets} glyphs={glyphs} usual={shown.map((b) => b.key)}
                    onChange={(keys) => { setTargets(keys); setList(null); }} />
        <div class="events-controls__dates">
          <Checkbox label="Minor aspects" checked={minor} onChecked={setMinor} />
          <Button type="submit" variant="primary" busy={busy} disabled={!movers.length || !targets.length}>List events</Button>
        </div>
        <p class="muted small">
          {!movers.length || !targets.length
            ? 'Choose at least one body on each line.'
            : `Up to ${LIMIT_YEARS[layer]} years at a time. Aspects come from your calculation profile${layer === 'transits' && movers.includes('moon') ? '; with the Moon it takes a little longer' : ''}.`}
        </p>
      </form>
      {error && <p class="small field-error">{error}</p>}
      {list && list.length === 0 && <p class="muted small">No exact aspects in that range.</p>}
      {list && list.length > 0 && (
        <div class="timing-scroll events-scroll">
          <table class="table table--compact data-table events-table">
            <tbody>
              {list.map((e) => {
                const at = e.at.replace('Z', '');
                const m = at.slice(0, 7);
                const header = m !== month ? (month = m) : null;
                const info = ASPECT_INFO[e.aspect];
                const day = fmtDate(at.slice(0, 10));
                return [
                  header && (
                    <tr key={`h-${m}`} class="month-row">
                      <td colSpan={4}>{new Date(`${m}-01T12:00:00Z`).toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' })}</td>
                    </tr>
                  ),
                  <tr key={`${e.at}-${e.mover}-${e.target}-${e.aspect}`} onMouseEnter={() => onFocus(e.target)} onMouseLeave={() => onFocus(null)}
                      title={`${prefix} ${label(e.mover)} ${info?.name ?? e.aspect} natal ${label(e.target)}, ${zodiac(e.lon)}`}>
                    <td class="nowrap muted">{layer === 'transits' ? `${day} ${fmtTime(at.slice(11, 16))}` : day}</td>
                    <td class="nowrap">{prefix} {glyph(e.mover)}{e.retro && <span class="retro"> {retroMark()}</span>}</td>
                    <td class="nowrap"><span class="glyph" style={{ color: `var(--t-aspect-${e.aspect})` }}>{textGlyph(info?.glyph ?? '?')}</span></td>
                    <td class="nowrap">n {glyph(e.target)}</td>
                  </tr>,
                ];
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/**
 * A line of body symbols to switch on and off, with All, None and Usual. Changing it stores the
 * full list chosen; Usual goes back to the default (and follows Your view from then on).
 */
function BodyPicker({ title, bodies, chosen, usual, glyphs, onChange }: {
  title: string; bodies: BodyInfo[]; chosen: string[]; usual: string[]; glyphs: Record<string, string>;
  onChange: (keys: string[] | null) => void;
}) {
  const set = new Set(chosen);
  const toggle = (k: string) => onChange(bodies.map((b) => b.key).filter((x) => (x === k ? !set.has(x) : set.has(x))));
  return (
    <div class="body-picker" role="group" aria-label={title}>
      <span class="body-picker__title">{title}</span>
      <span class="body-picker__chips">
        {bodies.map((b) => (
          <button key={b.key} type="button" class={`body-chip${set.has(b.key) ? ' is-on' : ''}`} aria-pressed={set.has(b.key)}
                  aria-label={b.label} title={b.label} onClick={() => toggle(b.key)}>
            {textGlyph(glyphs[b.key] ?? b.glyph ?? b.key.slice(0, 2))}
          </button>
        ))}
      </span>
      <span class="body-picker__links small">
        <button type="button" class="link-button" onClick={() => onChange(bodies.map((b) => b.key))}>All</button>
        <button type="button" class="link-button" onClick={() => onChange([])}>None</button>
        {(chosen.length !== usual.length || usual.some((k) => !set.has(k)))
          && <button type="button" class="link-button" onClick={() => onChange(null)}>Usual</button>}
      </span>
    </div>
  );
}
