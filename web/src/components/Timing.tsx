/**
 * AstrologyStudio ·
 * web/src/components/Timing.tsx
 *
 * Timing for the Hellenistic chart:
 *
 * annual profections (the sign and lord of each year of life) and zodiacal releasing from the Lot
 * of Spirit or Fortune. The choices sit in the chart screen's panel (TimingControls); the years
 * and periods fill the area left of the chart (TimingPane), which marks the signs in play on the
 * wheel through `onMark`.
 *
 * Copyright (c) 2026 Gavin Melhuish
 * MIT License; see LICENSE in the project root.
 * SPDX-License-Identifier: MIT
 */

import { useRef, useState } from 'preact/hooks';
import { api } from '../api';
import { textGlyph } from '../astro';
import { oneOf, usePref } from '../prefs';
import { Loading, useLoad } from '../ui';

const SIGNS = ['aries', 'taurus', 'gemini', 'cancer', 'leo', 'virgo', 'libra', 'scorpio', 'sagittarius', 'capricorn', 'aquarius', 'pisces'];
const SIGN_GLYPH = ['♈', '♉', '♊', '♋', '♌', '♍', '♎', '♏', '♐', '♑', '♒', '♓'];
const signIndex = (name: string) => SIGNS.indexOf(name);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const ordinal = (n: number) => `${n}${n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th'}`;

interface ProfectionYear {
  age: number; start: string; end: string; sign: string; lord: string; house: number;
  planets: string[]; from_fortune: number | null; from_spirit: number | null;
}
interface Profections { current_age: number | null; years: ProfectionYear[]; sect: 'day' | 'night'; asc_sign: string }
interface ZrPeriod {
  level: number; sign: string; start: string; end: string; loosing: boolean;
  angular_from_fortune: 1 | 4 | 7 | 10 | null; periods?: ZrPeriod[];
}
interface Releasing { from: 'spirit' | 'fortune'; year_days: number; lot_sign: string; fortune_sign: string; birth_utc: string; periods: ZrPeriod[] }

export type Technique = 'profections' | 'releasing';
type From = 'spirit' | 'fortune';
type Year = '360' | '365.25';

/** The Timing choices, shared by the panel and the pane. */
export function useTimingChoices() {
  const [technique, setTechnique] = usePref<Technique>('timing-technique', 'profections', oneOf<Technique>('profections', 'releasing'));
  const [from, setFrom] = usePref<From>('timing-zr-from', 'spirit', oneOf<From>('spirit', 'fortune'));
  const [year, setYear] = usePref<Year>('timing-zr-year', '360', oneOf<Year>('360', '365.25'));
  const [toAge, setToAge] = usePref<number>('timing-zr-to-age', 90, (v): v is number => typeof v === 'number' && v >= 1 && v <= 120);
  return { technique, setTechnique, from, setFrom, year, setYear, toAge, setToAge };
}

/** The Timing choices in the chart screen's panel. */
export function TimingControls() {
  const c = useTimingChoices();
  return (
    <div class="panel-form timing-options">
      <div class="segmented" role="group" aria-label="Technique">
        {([['profections', 'Profections'], ['releasing', 'Zodiacal releasing']] as const).map(([t, label]) => (
          <button key={t} type="button" class={c.technique === t ? 'is-active' : ''} aria-pressed={c.technique === t}
                  onClick={() => c.setTechnique(t)}>{label}</button>
        ))}
      </div>
      {c.technique === 'releasing' && (
        <>
          <div class="panel-row">
            <div class="segmented" role="group" aria-label="Release from">
              {(['spirit', 'fortune'] as const).map((f) => (
                <button key={f} type="button" class={c.from === f ? 'is-active' : ''} aria-pressed={c.from === f} onClick={() => c.setFrom(f)}>
                  From {f === 'spirit' ? 'Spirit' : 'Fortune'}
                </button>
              ))}
            </div>
          </div>
          <div class="panel-row">
            <label class="inline-select"><span>Year</span>
              <select value={c.year} onChange={(e) => c.setYear(e.currentTarget.value as Year)}>
                <option value="360">360 days (Valens)</option>
                <option value="365.25">365.25 days</option>
              </select>
            </label>
            <label class="inline-select"><span>To age</span>
              <input type="number" class="orb-input" min={1} max={120} value={c.toAge}
                     onChange={(e) => c.setToAge(Math.min(120, Math.max(1, Math.round(Number(e.currentTarget.value) || 90))))} />
            </label>
          </div>
        </>
      )}
    </div>
  );
}

/** The years or periods for a chart, in the area left of the wheel. */
export function TimingPane({ id, glyphs, onMark }: {
  id: string; glyphs: Record<string, string>;
  /** The signs to mark on the wheel, and the body to pick out (the lord of the year). */
  onMark: (marks: Record<number, string>, focus: string | null) => void;
}) {
  const c = useTimingChoices();
  const g = (k: string) => <span class="glyph">{textGlyph(glyphs[k] ?? '')}</span>;
  const sg = (name: string) => <span class="glyph">{SIGN_GLYPH[signIndex(name)]}</span>;
  return c.technique === 'profections'
    ? <ProfectionsList id={id} g={g} sg={sg} onMark={onMark} />
    : <ReleasingList key={`${id}-${c.from}-${c.year}-${c.toAge}`} id={id} from={c.from} year={c.year} toAge={c.toAge} sg={sg} onMark={onMark} />;
}

function ProfectionsList({ id, g, sg, onMark }: {
  id: string; g: (k: string) => preact.JSX.Element; sg: (s: string) => preact.JSX.Element;
  onMark: (marks: Record<number, string>, focus: string | null) => void;
}) {
  const today = new Date();
  const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const [data] = useLoad(() => api<Profections>(`/charts/${id}/profections?today=${iso}`), [id]);
  const [picked, setPicked] = useState<number | null>(null);
  const shown = useRef<string | null>(null);
  return (
    <Loading result={data}>
      {() => {
        if (data.state !== 'ready') return null;
        const age = picked ?? data.data.current_age ?? 0;
        const row = data.data.years[age]!;
        const signature = `${id}|${age}`;
        if (shown.current !== signature) {
          shown.current = signature;
          queueMicrotask(() => onMark({ [signIndex(row.sign)]: 'primary' }, row.lord));
        }
        return (
          <div class="timing-pane__body">
            <div class="timing-summary">
              <div class="muted small">Age {row.age} · {row.start.slice(0, 4)}–{row.end.slice(0, 4)}</div>
              <div class="timing-summary__main">{sg(row.sign)} {cap(row.sign)} year · lord {g(row.lord)} {cap(row.lord)}</div>
              <div class="muted small">{ordinal(row.house)} from the Ascendant
                {row.from_fortune ? ` · ${ordinal(row.from_fortune)} from Fortune` : ''}
                {row.planets.length > 0 && <> · activates {row.planets.map((p) => <span key={p}>{g(p)}</span>)}</>}</div>
            </div>
            <div class="timing-scroll">
              <table class="table table--compact data-table timing-table">
                <thead><tr><th>Age</th><th>Year</th><th>Sign</th><th>Lord</th><th>Natal</th></tr></thead>
                <tbody>
                  {data.data.years.map((y) => (
                    <tr key={y.age} class={`${y.age === age ? 'is-focus' : ''}${y.age === data.data.current_age ? ' is-current' : ''}`}
                        onClick={() => setPicked(y.age)} style={{ cursor: 'pointer' }}>
                      <td class="num">{y.age}</td>
                      <td class="muted num">{y.start.slice(0, 4)}</td>
                      <td class="nowrap">{sg(y.sign)} {cap(y.sign)}</td>
                      <td>{g(y.lord)}</td>
                      <td>{y.planets.map((p) => <span key={p}>{g(p)}</span>)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      }}
    </Loading>
  );
}

function ReleasingList({ id, from, year, toAge, sg, onMark }: {
  id: string; from: From; year: Year; toAge: number; sg: (s: string) => preact.JSX.Element;
  onMark: (marks: Record<number, string>, focus: string | null) => void;
}) {
  const [data] = useLoad(
    () => api<Releasing>(`/charts/${id}/releasing?from=${from}&year=${year}&levels=2&to_age=${toAge}`),
    [id, from, year, toAge],
  );
  const [open, setOpen] = useState<string | null>(null);
  const [level3, setLevel3] = useState<Record<string, ZrPeriod[] | 'loading' | 'error'>>({});
  const now = new Date().toISOString();
  const marked = useRef<string>('');
  const isNow = (p: ZrPeriod) => p.start <= now && now < p.end;

  const loadLevel3 = (p: ZrPeriod) => {
    const key = p.start;
    if (level3[key]) return;
    setLevel3((m) => ({ ...m, [key]: 'loading' }));
    api<Releasing>(`/charts/${id}/releasing?from=${from}&year=${year}&levels=3&start=${p.start.slice(0, 10)}&end=${p.end.slice(0, 10)}`)
      .then((r) => {
        const l2 = r.periods.flatMap((l1) => l1.periods ?? []).find((x) => x.start === p.start);
        setLevel3((m) => ({ ...m, [key]: (l2?.periods ?? []).filter((x) => x.start < p.end && x.end > p.start) }));
      })
      .catch(() => setLevel3((m) => ({ ...m, [key]: 'error' })));
  };

  return (
    <Loading result={data}>
      {() => {
        if (data.state !== 'ready') return null;
        const periods = data.data.periods;
        const currentL1 = periods.find(isNow);
        const currentL2 = currentL1?.periods?.find(isNow);
        const selectedL1 = open ? periods.find((p) => p.start === open) : null;
        const markL1 = selectedL1 ?? currentL1;
        const markL2 = !selectedL1 || selectedL1 === currentL1 ? currentL2 : null;
        const signature = `${id}|${markL1?.start ?? ''}|${markL2?.start ?? ''}`;
        if (marked.current !== signature) {
          marked.current = signature;
          const m: Record<number, string> = {};
          if (markL2) m[signIndex(markL2.sign)] = 'secondary';
          if (markL1) m[signIndex(markL1.sign)] = 'primary';
          queueMicrotask(() => onMark(m, null));
        }
        return (
          <div class="timing-pane__body">
            <div class="timing-summary">
              <div class="muted small">From the Lot of {from === 'spirit' ? 'Spirit' : 'Fortune'} in {cap(data.data.lot_sign)} · peaks are angular from Fortune ({cap(data.data.fortune_sign)})</div>
              {currentL1 && (
                <div class="timing-summary__main">Now: {sg(currentL1.sign)} {cap(currentL1.sign)}
                  {currentL2 && <> → {sg(currentL2.sign)} {cap(currentL2.sign)}</>}</div>
              )}
            </div>
            <div class="timing-scroll">
              <ol class="zr-list">
                {periods.map((p) => {
                  const expanded = open === p.start;
                  return (
                    <li key={p.start} class={`zr zr--l1${isNow(p) ? ' is-current' : ''}`}>
                      <button type="button" class="zr__row" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : p.start)}>
                        <span class="zr__caret" aria-hidden="true">{expanded ? '▾' : '▸'}</span>
                        <ZrLabel p={p} sg={sg} />
                      </button>
                      {expanded && (
                        <ol class="zr-list zr-list--l2">
                          {(p.periods ?? []).map((q) => {
                            const l3 = level3[q.start];
                            const shownL3 = Array.isArray(l3);
                            return (
                              <li key={q.start} class={`zr zr--l2${isNow(q) ? ' is-current' : ''}`}>
                                <button type="button" class="zr__row" aria-expanded={shownL3}
                                        onClick={() => (shownL3 || l3 === 'error'
                                          ? setLevel3((m) => { const n = { ...m }; delete n[q.start]; return n; })
                                          : loadLevel3(q))}>
                                  <span class="zr__caret" aria-hidden="true">{shownL3 ? '▾' : '▸'}</span>
                                  <ZrLabel p={q} sg={sg} />
                                </button>
                                {l3 === 'loading' && <p class="muted small zr__note">Loading…</p>}
                                {l3 === 'error' && <p class="muted small zr__note">Couldn't load level 3.</p>}
                                {shownL3 && (
                                  <ol class="zr-list zr-list--l3">
                                    {l3.map((r) => (
                                      <li key={r.start} class={`zr zr--l3${isNow(r) ? ' is-current' : ''}`}>
                                        <div class="zr__row"><ZrLabel p={r} sg={sg} /></div>
                                      </li>
                                    ))}
                                  </ol>
                                )}
                              </li>
                            );
                          })}
                        </ol>
                      )}
                    </li>
                  );
                })}
              </ol>
            </div>
          </div>
        );
      }}
    </Loading>
  );
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** A period's dates, as short as its level allows: years, then months, then days. */
function span(p: ZrPeriod): string {
  const [ys, ms, ds] = p.start.slice(0, 10).split('-').map(Number) as [number, number, number];
  const [ye, me, de] = p.end.slice(0, 10).split('-').map(Number) as [number, number, number];
  if (p.level === 1) return `${ys} – ${ye}`;
  if (p.level === 2) return `${MONTHS[ms - 1]} ${ys} – ${MONTHS[me - 1]} ${ye}`;
  return ys === ye ? `${ds} ${MONTHS[ms - 1]} – ${de} ${MONTHS[me - 1]} ${ye}` : `${ds} ${MONTHS[ms - 1]} ${ys} – ${de} ${MONTHS[me - 1]} ${ye}`;
}

function ZrLabel({ p, sg }: { p: ZrPeriod; sg: (s: string) => preact.JSX.Element }) {
  const peak = p.angular_from_fortune;
  return (
    <>
      <span class="zr__sign">{sg(p.sign)} {cap(p.sign)}</span>
      <span class="zr__dates" title={`${p.start.slice(0, 10)} to ${p.end.slice(0, 10)}`}>{span(p)}</span>
      {peak && <span class={`zr__peak${peak === 10 ? ' zr__peak--top' : ''}`} title={`${ordinal(peak)} sign from Fortune`}>{peak === 10 ? 'peak' : ordinal(peak)}</span>}
      {p.loosing && <span class="zr__loosing" title="Loosing of the bond">loosing</span>}
    </>
  );
}
