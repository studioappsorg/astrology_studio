/**
 * AstrologyStudio ·
 * web/src/components/ChartSlots.tsx
 *
 * The chart slots at the top of the chart screen's panel, and the dialog that fills them: one or two
 * charts shown together, chart 1 (normally the natal chart) inside and chart 2 (transits, a partner's
 * chart...) outside it, on the wheel and the dial alike. Each slot holds a saved chart, a new chart, or a chart derived from another
 * (transits, progressions, solar arc, solar and lunar returns, harmonics, and the composite and
 * Davison charts of two charts). New charts and derived charts are kept in your list from then on,
 * under the chart they were made from: ephemeralREST keeps most of them; composite and Davison
 * charts are kept here and worked out from their two charts each time they're shown. Harmonic
 * charts are worked out each time and aren't kept.
 *
 * Copyright (c) 2026 Gavin Melhuish
 * MIT License; see LICENSE in the project root.
 * SPDX-License-Identifier: MIT
 */

import { useState } from 'preact/hooks';
import { api, type ChartSummary, type DerivedDetail, type DerivedKind } from '../api';
import { PlaceField } from '../pages/ChartForm';
import { HouseSystemSelect } from './HouseSystemSelect';
import { useDefaults } from '../defaults';
import { Button, Checkbox, Field, Notice, useSubmit } from '../ui';
import { useView } from '../view';
import { Modal, ModalBody, ModalFooter } from './Modal';
import { date as fmtDate, time as fmtTime } from '../fmt';
import { plainWording } from '../hosted';

/** What a slot holds. A derived chart remembers its parent, which the page's address names. */
export interface SlotRef {
  id: string;
  derived: boolean;
  parent?: string;
}

export const isSlotRef = (v: unknown): v is SlotRef =>
  typeof v === 'object' && v !== null && typeof (v as SlotRef).id === 'string' && typeof (v as SlotRef).derived === 'boolean'
  && ((v as SlotRef).parent === undefined || typeof (v as SlotRef).parent === 'string');

export const DERIVED_LABELS: Record<DerivedKind, string> = {
  transits: 'Transits',
  progressed: 'Progressed',
  solar_arc: 'Solar arc',
  solar_return: 'Solar return',
  lunar_return: 'Lunar return',
  harmonic: 'Harmonic',
  composite: 'Composite',
  davison: 'Davison',
};

/** The My View feature each kind of derived chart belongs to. */
const DERIVED_FEATURE: Record<DerivedKind, string> = {
  transits: 'transits',
  progressed: 'progressions',
  solar_arc: 'solar_arc',
  solar_return: 'returns',
  lunar_return: 'returns',
  harmonic: 'harmonics',
  composite: 'composite',
  davison: 'davison',
};

/** The kinds of derived chart this person has switched on in My View. */
export function useDerivedKinds(): DerivedKind[] {
  const { feature } = useView();
  return (Object.keys(DERIVED_LABELS) as DerivedKind[]).filter((k) => feature(DERIVED_FEATURE[k]));
}

/** One line under a derived chart's name: what it is and when. */
export function derivedLine(d: DerivedDetail): string {
  if (d.kind === 'harmonic') return `Harmonic ${d.harmonic ?? ''} · every position × ${d.harmonic ?? 'n'}`;
  if (d.kind === 'composite') return 'Composite · the midpoints of the two charts';
  if (d.kind === 'davison') {
    const when = d.moment_utc ? `${d.moment_utc.replace('T', ' ').slice(0, 16)} UT` : '';
    return ['Davison', when, d.location.name].filter(Boolean).join(' · ');
  }
  const label = DERIVED_LABELS[d.kind as DerivedKind] ?? 'Derived chart';
  const when = d.moment_utc ? `${d.moment_utc.replace('T', ' ').slice(0, 16)} UT` : d.reference_date ?? '';
  const to = d.kind === 'progressed' || d.kind === 'solar_arc' ? ' to' : '';
  return [`${label}${to} ${when}`.trim(), d.location.name].filter(Boolean).join(' · ');
}

export function SlotCard({ index, selected, name, line, loading, error, canClear, onSelect, onChange, onClear }: {
  index: number;
  selected: boolean;
  /** null: nothing chosen yet. */
  name: string | null;
  line: string;
  loading: boolean;
  error: string | null;
  canClear: boolean;
  onSelect: () => void;
  onChange: () => void;
  onClear: () => void;
}) {
  const stop = (fn: () => void) => (e: Event) => { e.stopPropagation(); fn(); };
  return (
    <div class={`slot${selected ? ' is-selected' : ''}`} role="button" tabIndex={0} aria-pressed={selected}
         onClick={onSelect} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onSelect())}>
      <div class="slot__head">
        <span class="slot__label"><span class={`layer-key layer-key--${index}`} />Chart {index + 1}
          <span class="slot__role">{index === 0 ? 'inner' : 'outer'}</span></span>
        <span class="slot__actions">
          <button type="button" class="link-button" onClick={stop(onChange)}>Change</button>
          {canClear && <button type="button" class="link-button slot__clear" aria-label={`Clear chart ${index + 1}`} title="Clear" onClick={stop(onClear)}>×</button>}
        </span>
      </div>
      {loading ? <p class="muted small">Loading…</p> : error ? <p class="small slot__error">{error}</p> : name === null ? (
        <button type="button" class="slot__choose" onClick={stop(onChange)}>Choose a chart…</button>
      ) : (
        <>
          <p class="slot__name" title={name}>{name}</p>
          <p class="slot__line">{line}</p>
        </>
      )}
    </div>
  );
}

type Mode = 'saved' | 'new' | 'derived';
/** Worked out for where you are (your default location) unless you say otherwise. */
const NOW_KINDS = new Set<string>(['transits', 'solar_return', 'lunar_return']);

/** The dialog for choosing what goes in a chart slot: a saved chart, a new one, or one derived from a saved chart. */
export function ChartModal({ index, charts, defaultParent, onPicked, onClose, onListChanged }: {
  index: number;
  charts: ChartSummary[] | null;
  /** The chart a derived chart is worked out from, unless you choose another. */
  defaultParent: string | null;
  onPicked: (ref: SlotRef) => void;
  onClose: () => void;
  onListChanged: () => void;
}) {
  const [mode, setMode] = useState<Mode>('saved');
  const kinds = useDerivedKinds();
  const modes: Array<[Mode, string]> = [['saved', 'Saved chart'], ['new', 'New chart'], ...(kinds.length ? [['derived', 'Derived chart'] as [Mode, string]] : [])];
  const tabs = (
    <div class="segmented modal__tabs" role="tablist" aria-label="Chart source">
      {modes.map(([m, label]) => (
        <button key={m} type="button" role="tab" aria-selected={mode === m} class={mode === m ? 'is-active' : ''} onClick={() => setMode(m)}>{label}</button>
      ))}
    </div>
  );
  const made = (ref: SlotRef) => { onListChanged(); onPicked(ref); };
  return (
    <Modal title={`Chart ${index + 1}`} onClose={onClose}>
      {mode === 'saved' && <SavedList tabs={tabs} charts={charts} onPicked={onPicked} onCancel={onClose} />}
      {mode === 'new' && <NewChartForm tabs={tabs} index={index} onPicked={made} onCancel={onClose} />}
      {mode === 'derived' && <DerivedForm tabs={tabs} index={index} charts={charts} defaultParent={defaultParent} onPicked={made} onCancel={onClose} />}
    </Modal>
  );
}

function SavedList({ tabs, charts, onPicked, onCancel }: {
  tabs: preact.ComponentChildren; charts: ChartSummary[] | null; onPicked: (ref: SlotRef) => void; onCancel: () => void;
}) {
  const [q, setQ] = useState('');
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const hit = (text: string) => words.every((w) => text.toLowerCase().includes(w));
  const matches = (charts ?? [])
    .map((c) => {
      const own = hit(`${c.name} ${c.date ?? ''} ${c.place ?? ''} ${c.tags.join(' ')}`);
      const derived = c.derived.filter((d) => own || hit(`${d.name} ${d.date ?? ''}`));
      return { c, own, derived };
    })
    .filter((m) => m.own || m.derived.length > 0)
    .slice(0, 60);
  return (
    <>
    <ModalBody>
    {tabs}
    <div class="slot-list">
      <input type="search" class="slot-list__search" placeholder="Search your charts" value={q} aria-label="Search your charts"
             onInput={(e) => setQ(e.currentTarget.value)} />
      <ul>
        {charts === null && <li class="muted small">Loading…</li>}
        {charts !== null && matches.length === 0 && <li class="muted small">No charts match</li>}
        {matches.map(({ c, derived }) => (
          <li key={c.id}>
            <button type="button" onClick={() => onPicked({ id: c.id, derived: false })}>
              <strong>{c.name}{c.tags.map((t) => <span key={t} class="badge">{t}</span>)}</strong>
              <small>{[fmtDate(c.date), c.time_unknown ? '' : fmtTime(c.time), c.place].filter(Boolean).join(' · ')}</small>
            </button>
            {derived.length > 0 && (
              <ul class="slot-list__derived">
                {derived.map((d) => (
                  <li key={d.id}>
                    <button type="button" onClick={() => onPicked({ id: d.id, derived: true, parent: c.id })}>
                      <span>{d.name.startsWith(`${c.name} — `) ? d.name.slice(c.name.length + 3) : d.name}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </div>
    </ModalBody>
    <ModalFooter><Button onClick={onCancel}>Cancel</Button></ModalFooter>
    </>
  );
}

function NewChartForm({ tabs, index, onPicked, onCancel }: {
  tabs: preact.ComponentChildren; index: number; onPicked: (ref: SlotRef) => void; onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [timeUnknown, setTimeUnknown] = useState(false);
  const defaults = useDefaults();
  const [placeTyped, setPlace] = useState<string | null>(null);
  const place = placeTyped ?? defaults?.place ?? '';
  const [houseSystem, setHouseSystem] = useState('');
  const { busy, error, onSubmit } = useSubmit(async () => {
    const created = await api<{ id: string }>('/charts', 'POST', {
      name, date, time: timeUnknown || !time ? null : time, place, house_system: houseSystem,
    });
    onPicked({ id: created.id, derived: false });
  });
  return (
    <form class="modal__form" onSubmit={onSubmit}>
      <ModalBody>
      {tabs}
      <div class="slot-form">
      {error && <Notice tone="error">{error}</Notice>}
      <Field label="Name" value={name} onValue={setName} id={`slot${index}-name`} required />
      <div class="form-grid">
        <Field label="Date" type={'date' as 'text'} value={date} onValue={setDate} id={`slot${index}-date`} required />
        <Field label="Time" type={'time' as 'text'} value={timeUnknown ? '' : time} onValue={setTime} id={`slot${index}-time`} />
      </div>
      <Checkbox label="Time unknown (set for noon)" checked={timeUnknown} onChecked={setTimeUnknown} />
      <PlaceField value={place} onValue={setPlace} id={`slot${index}-place`} hint="A town or city." />
      <HouseSystemSelect value={houseSystem} onValue={setHouseSystem} id={`slot${index}-houses`} />
      </div>
      </ModalBody>
      <ModalFooter>
        <span class="muted small modal__note">Saved to your charts.</span>
        <Button onClick={onCancel}>Cancel</Button>
        <Button type="submit" variant="primary" busy={busy}>Calculate</Button>
      </ModalFooter>
    </form>
  );
}

/** The time now on this computer's clock, as HH:MM. */
const nowTime = () => {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

/** Today on this computer's calendar (toISOString would give the UTC date). */
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

function DerivedForm({ tabs, index, charts, defaultParent, onPicked, onCancel }: {
  tabs: preact.ComponentChildren; index: number; charts: ChartSummary[] | null; defaultParent: string | null;
  onPicked: (ref: SlotRef) => void; onCancel: () => void;
}) {
  const [parent, setParent] = useState(defaultParent ?? charts?.[0]?.id ?? '');
  const kinds = useDerivedKinds();
  const [kindPref, setKind] = useState<DerivedKind>(kinds[0] ?? 'transits');
  const kind = kinds.includes(kindPref) ? kindPref : kinds[0] ?? 'transits';
  const [date, setDate] = useState(today);
  const [time, setTime] = useState(nowTime);
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [month, setMonth] = useState(String(new Date().getMonth() + 1));
  const [place, setPlace] = useState('');
  const [harmonic, setHarmonic] = useState('5');
  const [other, setOther] = useState('');
  const pairKind = kind === 'composite' || kind === 'davison';
  const defaults = useDefaults();
  const others = (charts ?? []).filter((c) => c.id !== parent);
  const otherId = others.some((c) => c.id === other) ? other : others[0]?.id ?? '';
  const dated = kind === 'transits' || kind === 'progressed' || kind === 'solar_arc';
  const { busy, error, onSubmit } = useSubmit(async () => {
    if (kind === 'harmonic') {
      const n = Math.round(Number(harmonic));
      if (!(n >= 1 && n <= 180)) throw new Error('Choose a harmonic from 1 to 180.');
      // Worked out from the chart each time it's shown: nothing to calculate or keep now.
      onPicked({ id: `harmonic-${n}-${parent}`, derived: true, parent });
      return;
    }
    if (pairKind) {
      if (!otherId) throw new Error('Choose the second chart.');
      // Kept with the From chart, so it's listed under it from then on (still worked out from the
      // two charts each time it's shown).
      const made = await api<DerivedDetail>(`/charts/${parent}/derived`, 'POST', {
        kind, other: otherId, place: kind === 'davison' ? place.trim() : '',
      });
      onPicked({ id: made.id, derived: true, parent });
      return;
    }
    const body: Record<string, unknown> = { kind, place };
    if (dated) body.date = date;
    if (kind === 'transits' && time) body.time = time;
    else body.year = Number(year);
    if (kind === 'lunar_return') body.month = Number(month);
    const made = await api<DerivedDetail>(`/charts/${parent}/derived`, 'POST', body);
    onPicked({ id: made.id, derived: true, parent });
  });
  return (
    <form class="modal__form" onSubmit={onSubmit}>
      <ModalBody>
      {tabs}
      <div class="slot-form">
      {error && <Notice tone="error">{error}</Notice>}
      <label class="field" for={`slot${index}-parent`}>
        <span>From</span>
        <select id={`slot${index}-parent`} value={parent} onChange={(e) => setParent(e.currentTarget.value)} required>
          {(charts ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </label>
      <label class="field" for={`slot${index}-kind`}>
        <span>Chart</span>
        <select id={`slot${index}-kind`} value={kind} onChange={(e) => setKind(e.currentTarget.value as DerivedKind)}>
          {kinds.map((k) => <option key={k} value={k}>{DERIVED_LABELS[k]}</option>)}
        </select>
      </label>
      {pairKind ? (
        <label class="field" for={`slot${index}-other`}>
          <span>With</span>
          <select id={`slot${index}-other`} value={otherId} onChange={(e) => setOther(e.currentTarget.value)} required>
            {others.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <small class="muted">{kind === 'composite'
            ? 'Each position is the midpoint of the two charts\' positions, and so are the house cusps.'
            : 'The chart for the moment and place midway between the two births.'}</small>
        </label>
      ) : kind === 'harmonic' ? (
        <div class="harmonic-field">
          <Field label="Harmonic" type={'number' as 'text'} value={harmonic} onValue={setHarmonic} id={`slot${index}-harmonic`}
                 hint="Every position multiplied by this number. Conjunctions in it are this harmonic's aspects in the chart." required />
          <div class="segmented" role="group" aria-label="Common harmonics">
            {[4, 5, 7, 9, 16].map((h) => (
              <button key={h} type="button" class={harmonic === String(h) ? 'is-active' : ''} onClick={() => setHarmonic(String(h))}>H{h}</button>
            ))}
          </div>
        </div>
      ) : kind === 'transits' ? (
        <div class="form-grid">
          <Field label="Date" type={'date' as 'text'} value={date} onValue={setDate} id={`slot${index}-when`} required />
          <Field label="Time" type={'time' as 'text'} value={time} onValue={setTime} id={`slot${index}-time`}
                 hint="Local time at the place." />
        </div>
      ) : dated ? (
        <Field label={kind === 'progressed' ? 'Progressed to' : 'Directed to'} type={'date' as 'text'} value={date} onValue={setDate}
               id={`slot${index}-when`} required />
      ) : (
        <div class="form-grid">
          <Field label="Year" type={'number' as 'text'} value={year} onValue={setYear} id={`slot${index}-year`} required />
          {kind === 'lunar_return' && (
            <Field label="Month" type={'number' as 'text'} value={month} onValue={setMonth} id={`slot${index}-month`} required />
          )}
        </div>
      )}
      {kind !== 'harmonic' && kind !== 'composite' && (
        <PlaceField value={place} onValue={setPlace} id={`slot${index}-where`} label="Where (optional)" required={false}
                    hint={kind === 'davison' ? 'Leave empty for the place midway between the two births.'
                      : NOW_KINDS.has(kind) && defaults?.place ? `For the houses. Leave empty for your default location, ${defaults.place}.`
                      : 'For the houses. Leave empty for the birth place.'} />
      )}
      </div>
      </ModalBody>
      <ModalFooter>
        <span class="muted small modal__note">{kind === 'harmonic' ? 'Worked out from the chart each time; not added to your list.'
          : pairKind ? 'Kept in your chart list, under the From chart.'
          : (plainWording() ? 'Kept in your chart list, under its chart.' : 'Kept in ephemeralREST, listed under its chart.')}</span>
        <Button onClick={onCancel}>Cancel</Button>
        <Button type="submit" variant="primary" busy={busy} disabled={!parent}>{kind === 'harmonic' || pairKind ? 'Show' : 'Calculate'}</Button>
      </ModalFooter>
    </form>
  );
}
