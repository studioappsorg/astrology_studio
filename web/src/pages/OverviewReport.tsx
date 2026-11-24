/**
 * AstrologyStudio ·
 * web/src/pages/OverviewReport.tsx
 *
 * The Overview tab on the chart screen:
 *
 * the basics read before anything else. Elements and modalities and the chart signature,
 * polarity, the Sun, Moon and rising sign with the chart ruler, the Moon's phase and sect,
 * hemispheres and house types, the chart's shape, stelliums and aspect patterns, and dignities,
 * receptions and the final dispositor. The working is in overview.ts.
 *
 * Copyright (c) 2026 Gavin Melhuish
 * MIT License; see LICENSE in the project root.
 * SPDX-License-Identifier: MIT
 */

import type { ComponentChildren } from 'preact';
import type { FoundAspect, Point } from '../api';
import { dm, houseOf, signIndex, SIGN_GLYPHS, textGlyph } from '../astro';
import {
  balance, COUNTING_LABELS, COUNTING_NOTES, dignityList, ELEMENT_NAMES, emphasis, houses, isCounting, isDayChart, isRulers, MODALITY_NAMES,
  moonPhase, patterns, PLANETS, rulerOf, rulership, shape, SHAPES, SIGN_NAMES, stelliums, unaspected,
  type Balance, type Counting, type Rulers,
} from '../overview';
import { usePref } from '../prefs';

export interface OverviewChart {
  name: string;
  line: string;
  points: Record<string, Point>;
  houses: number[] | null;
  aspects: FoundAspect[];
  timeUnknown: boolean;
}

const ORDINAL = ['', '1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th', '10th', '11th', '12th'];
const ELEMENT_CLASS = ['fire', 'earth', 'air', 'water'];
const PHASE_MEANING: Record<string, string> = {
  New: 'instinctive, starting fresh, projecting into the future',
  Crescent: 'pushing forward, breaking free of the past',
  'First quarter': 'action, building, meeting challenges head on',
  Gibbous: 'refining, analysing, perfecting',
  Full: 'awareness, relationship, seeing things objectively',
  Disseminating: 'sharing, teaching, spreading what has been learned',
  'Last quarter': 'reorienting, questioning, changing direction',
  Balsamic: 'completing, letting go, preparing for something new',
};
const SHAPE_HINT = 'Marc Edmund Jones’s seven patterns, from how the ten planets are spread round the wheel.';

/** The counting and rulership choices, remembered for each person (the client sheet uses the counting too). */
export function useOverviewChoices(): { counting: Counting; setCounting: (c: Counting) => void; rulers: Rulers; setRulers: (r: Rulers) => void } {
  const [counting, setCounting] = usePref<Counting>('overview-counting', 'planets', isCounting);
  const [rulers, setRulers] = usePref<Rulers>('overview-rulers', 'modern', isRulers);
  return { counting, setCounting, rulers, setRulers };
}

/** The element × modality table, with totals; used on the client sheet too. */
export function BalanceTable({ result, glyph, compact }: { result: Balance; glyph: (k: string) => ComponentChildren; compact?: boolean }) {
  return (
    <table class={`em-table${compact ? ' em-table--compact' : ''}`}>
      <thead>
        <tr>
          <th />
          {MODALITY_NAMES.map((m) => <th key={m} scope="col" title={m}>{compact ? m.slice(0, 3) : m}</th>)}
          <th scope="col" class="em-table__total" title="Total">{compact ? 'Tot' : 'Total'}</th>
        </tr>
      </thead>
      <tbody>
        {ELEMENT_NAMES.map((e, i) => (
          <tr key={e}>
            <th scope="row"><span class={`em-dot em-dot--${ELEMENT_CLASS[i]}`} aria-hidden="true" />{e}</th>
            {MODALITY_NAMES.map((m, j) => (
              <td key={m} class={result.signature.elements.includes(i) && result.signature.modalities.includes(j) ? 'is-signature' : ''}>
                {result.grid[i]![j]!.map((k) => <span key={k} class="em-table__body">{glyph(k)}</span>)}
              </td>
            ))}
            <td class="em-table__total">{result.elements[i]!.score}</td>
          </tr>
        ))}
        <tr class="em-table__totals">
          <th scope="row">Total</th>
          {result.modalities.map((m, j) => <td key={j}>{m.score}</td>)}
          <td class="em-table__total">{result.total}</td>
        </tr>
      </tbody>
    </table>
  );
}

/** "Fixed water: Scorpio", or both when two elements or modalities tie. */
export function signatureText(result: Balance): string {
  const { signs } = result.signature;
  if (!signs.length) return '—';
  const text = signs.map((s) => `${MODALITY_NAMES[s % 3]!.toLowerCase()} ${ELEMENT_NAMES[s % 4]!.toLowerCase()}: ${SIGN_NAMES[s]}`).join(', or ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function OverviewReport({ chart, shown, glyphs, label, choice, focus, onFocus }: {
  chart: OverviewChart; shown: string[]; glyphs: Record<string, string>; label: (k: string) => string;
  choice?: ComponentChildren; focus: string | null; onFocus: (k: string | null) => void;
}) {
  const { counting, setCounting, rulers, setRulers } = useOverviewChoices();
  const { points } = chart;
  const glyph = (k: string) => (
    <span class={`glyph ov-glyph${focus === k ? ' is-focus' : ''}`} title={label(k)}
          onMouseEnter={() => onFocus(k)} onMouseLeave={() => onFocus(null)}>{textGlyph(glyphs[k] ?? k.slice(0, 2))}</span>
  );
  const glyphs_ = (keys: string[]) => (keys.length ? keys.map((k) => <span key={k}>{glyph(k)}</span>) : <span class="muted">none</span>);
  const signGlyph = (s: number) => <span class="glyph">{SIGN_GLYPHS[s]}</span>;
  const planets = PLANETS.filter((k) => points[k] && shown.includes(k));
  const lons = Object.fromEntries(planets.map((k) => [k, points[k]!.lon]));
  const result = balance(points, shown, counting);
  const cusps = chart.houses;
  const h = cusps ? houses(points, shown, cusps) : null;
  const where = (k: string) => {
    const p = points[k];
    if (!p) return '';
    const house = cusps ? houseOf(p.lon, cusps) : null;
    return `${dm(p.lon % 30)} ${SIGN_NAMES[signIndex(p.lon)]}${house ? `, ${ORDINAL[house]} house` : ''}`;
  };
  const asc = points.asc;
  const ruler = asc ? rulerOf(signIndex(asc.lon), 'traditional') : null;
  const modernRuler = asc ? rulerOf(signIndex(asc.lon), 'modern') : null;
  const phase = points.sun && points.moon ? moonPhase(points.sun.lon, points.moon.lon) : null;
  const retro = planets.filter((k) => points[k]!.retro);
  const form = shape(lons);
  const patternKeys = [...planets, ...['asc', 'mc'].filter((k) => points[k] && shown.includes(k))];
  const found = patterns(patternKeys, chart.aspects);
  const signStelliums = stelliums(Object.fromEntries(planets.map((k) => [k, signIndex(points[k]!.lon)])));
  const houseStelliums = h ? stelliums(h.houseOf) : [];
  const lonely = unaspected(planets, patternKeys, chart.aspects);
  const rule = rulership(lons, rulers);
  const digs = dignityList(lons);
  const count = (keys: string[]) => keys.length;
  const ofTen = planets.length;

  const notes: string[] = [];
  result.elements.forEach((e, i) => {
    const w = emphasis(e.score, result.total, 4);
    if (w === 'strong') notes.push(`${ELEMENT_NAMES[i]} is strong (${e.score} of ${result.total}).`);
    if (w === 'missing') notes.push(`No ${ELEMENT_NAMES[i]!.toLowerCase()}: astrologers often see a missing element as something to develop, or something sought in others.`);
    if (w === 'weak') notes.push(`${ELEMENT_NAMES[i]} is weak (${e.score} of ${result.total}).`);
  });
  result.modalities.forEach((m, i) => {
    const w = emphasis(m.score, result.total, 3);
    if (w === 'strong') notes.push(`${MODALITY_NAMES[i]} is strong (${m.score} of ${result.total}).`);
    if (w === 'missing') notes.push(`No ${MODALITY_NAMES[i]!.toLowerCase()} signs.`);
  });

  const tools = (
    <>
      {choice}
      <label class="inline-select"><span>Count</span>
        <select value={counting} aria-label="What to count" onChange={(e) => setCounting(e.currentTarget.value as Counting)}>
          {(Object.keys(COUNTING_LABELS) as Counting[]).map((c) => <option key={c} value={c}>{COUNTING_LABELS[c]}</option>)}
        </select>
      </label>
      <label class="inline-select"><span>Rulers</span>
        <select value={rulers} aria-label="Rulerships" onChange={(e) => setRulers(e.currentTarget.value as Rulers)}>
          <option value="modern">Modern</option>
          <option value="traditional">Traditional</option>
        </select>
      </label>
    </>
  );

  const pair = (a: string, aKeys: string[], b: string, bKeys: string[], hint: string) => (
    <div class="ov-split">
      <div class="ov-split__bar" aria-hidden="true">
        <span style={{ flex: Math.max(count(aKeys), 0.001) }} class="ov-split__a" />
        <span style={{ flex: Math.max(count(bKeys), 0.001) }} class="ov-split__b" />
      </div>
      <div class="ov-split__labels">
        <span><strong>{a}</strong> {count(aKeys)} {glyphs_(aKeys)}</span>
        <span><strong>{b}</strong> {count(bKeys)} {glyphs_(bKeys)}</span>
      </div>
      <p class="muted small">{hint}</p>
    </div>
  );
  const lean = (aKeys: string[], bKeys: string[], a: string, b: string) =>
    count(aKeys) > count(bKeys) + 1 ? a : count(bKeys) > count(aKeys) + 1 ? b : 'Evenly balanced.';

  return (
    <div class="report overview">
      <header class="report__head">
        <div>
          <h2 class="report__name">{chart.name}</h2>
          <p class="report__line">{chart.line}</p>
          <p class="report__what">Overview: the balance of the chart, its signature, shape and patterns</p>
        </div>
        <div class="report__tools">{tools}</div>
      </header>

      <div class="overview__cards">
        <section class="report__card overview__wide" aria-labelledby="ov-balance">
          <h3 class="report__section" id="ov-balance">Elements and modalities</h3>
          <div class="ov-balance">
            <BalanceTable result={result} glyph={glyph} />
            <div class="ov-signature">
              <p class="ov-signature__label">Chart signature</p>
              <p class="ov-signature__signs">{result.signature.signs.map((s) => <span key={s}>{signGlyph(s)}</span>)}</p>
              <p class="ov-signature__text">{signatureText(result)}</p>
              <p class="muted small">
                The element and the modality with the most planets meet in one sign. Its character runs through the whole
                chart, whether or not any planet is in it.
                {result.signature.signs.length > 1 && ' With a tie, read each, and weigh which is backed by the Sun, Moon or Ascendant.'}
              </p>
              <div class="ov-polarity">
                {pair('Active', [...result.elements[0]!.keys, ...result.elements[2]!.keys], 'Receptive', [...result.elements[1]!.keys, ...result.elements[3]!.keys],
                  'Polarity: fire and air are active and outgoing; earth and water receptive and inward.')}
              </div>
            </div>
          </div>
          <ul class="ov-notes">
            {notes.map((n) => <li key={n}>{n}</li>)}
            {result.singletons.map((s) => (
              <li key={`${s.kind}-${s.key}`}>{glyph(s.key)} {label(s.key)} is the only planet in {s.kind === 'element' ? ELEMENT_NAMES[s.index]!.toLowerCase() : `a ${MODALITY_NAMES[s.index]!.toLowerCase()} sign`}: a <em>singleton</em>, which carries that quality for the whole chart.</li>
            ))}
          </ul>
          <p class="muted small">Counted: {COUNTING_NOTES[counting]}. Elements are also called triplicities, modalities quadruplicities.</p>
        </section>

        <section class="report__card" aria-labelledby="ov-core">
          <h3 class="report__section" id="ov-core">Sun, Moon, Ascendant and chart ruler</h3>
          <dl class="ov-facts">
            {points.sun && <><dt>{glyph('sun')} Sun</dt><dd>{where('sun')}</dd></>}
            {points.moon && <><dt>{glyph('moon')} Moon</dt><dd>{where('moon')}</dd></>}
            {asc && <><dt>AC Ascendant</dt><dd>{where('asc')}{chart.timeUnknown && <span class="muted"> (birth time unknown)</span>}</dd></>}
            {ruler && (
              <>
                <dt>Chart ruler</dt>
                <dd>
                  {glyph(ruler)} {label(ruler)} in {where(ruler)}
                  {modernRuler !== ruler && <> · modern {glyph(modernRuler!)} {label(modernRuler!)} in {where(modernRuler!)}</>}
                </dd>
              </>
            )}
            {phase && (
              <>
                <dt>Moon phase</dt>
                <dd>{phase.name} ({phase.waxing ? 'waxing' : 'waning'}, {Math.round(phase.angle)}° ahead of the Sun): {PHASE_MEANING[phase.name]}</dd>
              </>
            )}
            {cusps && points.sun && <><dt>Sect</dt><dd>{isDayChart(points.sun.lon, cusps) ? 'Day chart: the Sun above the horizon' : 'Night chart: the Sun below the horizon'}</dd></>}
            <dt>Retrograde</dt><dd>{retro.length ? glyphs_(retro) : 'none'}</dd>
          </dl>
          <p class="muted small">The chart ruler rules the sign on the Ascendant; its sign and house colour the whole chart.</p>
        </section>

        <section class="report__card" aria-labelledby="ov-shape">
          <h3 class="report__section" id="ov-shape">Chart shape</h3>
          {form ? (
            <>
              <p class="ov-shape__name">{form.name}</p>
              <p>{SHAPES[form.name]}</p>
              {form.key && <p>{form.role === 'handle' ? 'Handle' : 'Leading planet'}: {glyph(form.key)} {label(form.key)} in {where(form.key)}</p>}
              <p class="muted small">{SHAPE_HINT}</p>
            </>
          ) : <p class="muted small">Switch on at least five planets to see the chart's shape.</p>}
        </section>

        {h ? (
          <section class="report__card" aria-labelledby="ov-houses">
            <h3 class="report__section" id="ov-houses">Hemispheres and houses</h3>
            {chart.timeUnknown && <p class="muted small">The birth time is unknown, so these are for noon and may not be right.</p>}
            {pair('Above', h.above, 'Below', h.below,
              `Above the horizon (houses 7–12): outward, public life. Below (1–6): inner, personal life. ${lean(h.above, h.below, 'Leans above.', 'Leans below.')}`)}
            {pair('East', h.east, 'West', h.west,
              `East (houses 10–3, the Ascendant's side): self-directed. West (4–9): shaped by others and relationships. ${lean(h.east, h.west, 'Leans east.', 'Leans west.')}`)}
            <table class="ov-table">
              <tbody>
                {[['1st quadrant', 'houses 1–3: self'], ['2nd quadrant', 'houses 4–6: home and daily life'], ['3rd quadrant', 'houses 7–9: others'], ['4th quadrant', 'houses 10–12: society']].map(([q, d], i) => (
                  <tr key={q}><th>{q}</th><td class="muted">{d}</td><td>{glyphs_(h.quadrants[i]!)}</td></tr>
                ))}
                <tr><th>Angular</th><td class="muted">1, 4, 7, 10: action, visibility</td><td>{glyphs_(h.angular)}</td></tr>
                <tr><th>Succedent</th><td class="muted">2, 5, 8, 11: stability, resources</td><td>{glyphs_(h.succedent)}</td></tr>
                <tr><th>Cadent</th><td class="muted">3, 6, 9, 12: learning, adapting</td><td>{glyphs_(h.cadent)}</td></tr>
              </tbody>
            </table>
            <p class="muted small">Of {ofTen} planets.</p>
          </section>
        ) : (
          <section class="report__card">
            <h3 class="report__section">Hemispheres and houses</h3>
            <p class="muted small">This chart has no houses.</p>
          </section>
        )}

        <section class="report__card" aria-labelledby="ov-patterns">
          <h3 class="report__section" id="ov-patterns">Patterns</h3>
          <ul class="ov-list">
            {found.map((p) => (
              <li key={`${p.name}-${p.keys.join()}`}>
                <strong>{p.name}</strong> {glyphs_(p.keys)}
                {p.apex && <span class="muted"> · {p.name === 'Kite' ? 'tail' : 'apex'} {glyph(p.apex)} {label(p.apex)}</span>}
              </li>
            ))}
            {signStelliums.map((s) => <li key={`s${s.at}`}><strong>Stellium in {SIGN_NAMES[s.at]}</strong> {glyphs_(s.keys)}</li>)}
            {houseStelliums.map((s) => <li key={`h${s.at}`}><strong>Stellium in the {ORDINAL[s.at]} house</strong> {glyphs_(s.keys)}</li>)}
            {lonely.map((k) => <li key={`u${k}`}><strong>Unaspected</strong> {glyph(k)} {label(k)}: no major aspect, so it tends to act on its own.</li>)}
            {!found.length && !signStelliums.length && !houseStelliums.length && !lonely.length && <li class="muted">No major patterns.</li>}
          </ul>
          <p class="muted small">
            Grand trines, kites, grand crosses, mystic rectangles, T-squares and yods, found with your aspects and orbs; a stellium is
            three or more planets in one sign or house.
          </p>
        </section>

        <section class="report__card" aria-labelledby="ov-rulers">
          <h3 class="report__section" id="ov-rulers">Dignities and rulerships</h3>
          <dl class="ov-facts">
            <dt>Dignities</dt>
            <dd>{digs.length ? digs.map((d) => <span key={d.key} class="ov-chip">{glyph(d.key)} {label(d.key)}: {d.dignity}</span>) : 'none'}</dd>
            <dt>Mutual receptions</dt>
            <dd>{rule.receptions.length ? rule.receptions.map(([a, b]) => <span key={a + b} class="ov-chip">{glyph(a)} {label(a)} and {glyph(b)} {label(b)}</span>) : 'none'}</dd>
            <dt>Final dispositor</dt>
            <dd>
              {rule.final ? <>{glyph(rule.final)} {label(rule.final)}: every chain of rulers leads back to it.</>
                : rule.own.length ? <>None. In their own signs: {glyphs_(rule.own)}</> : 'None: the rulers go round in circles.'}
            </dd>
          </dl>
          <p class="muted small">
            Dom domicile, Exalt exaltation, Detr detriment, Fall fall. A planet's dispositor is the ruler of the sign it's in; two planets
            in each other's signs are in mutual reception. Using {rulers} rulers.
          </p>
        </section>
      </div>
    </div>
  );
}
