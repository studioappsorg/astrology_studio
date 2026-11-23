/**
 * AstrologyStudio ·
 * web/src/pages/ChartForm.tsx
 *
 * New chart, or editing one:
 *
 * a dialog in the middle of the screen, like the chart screen's Change dialog (editing opens over
 * the chart). Correcting birth data recalculates the chart for everyone who has it.
 *
 * Copyright (c) 2026 Gavin Melhuish
 * MIT License; see LICENSE in the project root.
 * SPDX-License-Identifier: MIT
 */

import { useEffect, useRef, useState } from 'preact/hooks';
import { api, type ChartDetail, type Folder } from '../api';
import { offsetText } from '../astro';
import { closeTab, refreshCharts } from '../frame/store';
import { navigate } from '../router';
import { PROFILE_CHANGED } from '../appearance';
import { Button, Checkbox, CopyText, describe, Field, Loading, Notice, Select, TextArea, useDebounced, useLoad, useSubmit } from '../ui';
import { plainWording } from '../hosted';
import { Modal, ModalBody, ModalFooter } from '../components/Modal';
import { HouseSystemSelect } from '../components/HouseSystemSelect';
import { TagInput } from '../components/TagInput';
import { useDefaults } from '../defaults';

const RATINGS: Array<[string, string]> = [
  ['', 'Not rated'], ['AA', 'AA: from a birth record'], ['A', 'A: from memory or news'], ['B', 'B: biography'],
  ['C', 'C: caution, source unclear'], ['DD', 'DD: conflicting'], ['X', 'X: no time'], ['XX', 'XX: no date or time'],
];

export function NewChart() {
  return <ChartForm />;
}

export function EditChart({ id }: { id: string }) {
  const [chart] = useLoad(() => api<ChartDetail>(`/charts/${id}`), [id]);
  return <Loading result={chart}>{() => chart.state === 'ready' && <ChartForm existing={chart.data} />}</Loading>;
}

function ChartForm({ existing }: { existing?: ChartDetail }) {
  const note = existing?.note;
  const [name, setName] = useState(existing?.name ?? '');
  const [date, setDate] = useState(existing?.date ?? '');
  const [time, setTime] = useState(existing && !note?.time_unknown ? existing.time ?? '' : '');
  const [timeUnknown, setTimeUnknown] = useState(note?.time_unknown ?? false);
  const [place, setPlace] = useState(existing?.place ?? '');
  const [manualOffset, setManualOffset] = useState(Boolean(note?.utc_offset));
  const [offset, setOffset] = useState(note?.utc_offset ?? '');
  const [folder, setFolder] = useState(note?.folder_id ?? '');
  const [tags, setTags] = useState<string[]>(note?.tags ?? []);
  const [known] = useLoad(() => api<{ tags: string[] }>('/charts'));
  const [rating, setRating] = useState(note?.rating ?? '');
  const [source, setSource] = useState(note?.source ?? '');
  const [notes, setNotes] = useState(note?.notes ?? '');
  const [houseSystem, setHouseSystem] = useState(note?.house_system ?? '');
  const [folders] = useLoad(() => api<{ data: Folder[] }>('/folders'));
  // A new chart starts at your default place, until you type another.
  const defaults = useDefaults();
  const placeTouched = useRef(false);
  useEffect(() => {
    if (!existing && !placeTouched.current && defaults?.place) setPlace(defaults.place);
  }, [defaults?.place]);
  const typePlace = (v: string) => { placeTouched.current = true; setPlace(v); };

  const { busy, error, onSubmit } = useSubmit(async () => {
    const body = {
      name, date, time: timeUnknown || !time ? null : time, place,
      utc_offset: manualOffset ? offset.trim() : '',
      folder_id: folder || null,
      tags,
      rating, source, notes, house_system: houseSystem,
    };
    if (existing) {
      const changes: Record<string, unknown> = { name, folder_id: body.folder_id, tags: body.tags, rating, source, notes };
      if (houseSystem !== existing.note.house_system) changes.house_system = houseSystem;
      const birthChanged = date !== existing.date || place !== existing.place || body.utc_offset !== existing.note.utc_offset
        || timeUnknown !== existing.note.time_unknown || (!timeUnknown && time !== (existing.time ?? ''));
      if (birthChanged) Object.assign(changes, { date, time: body.time, time_unknown: timeUnknown || !time, place, utc_offset: body.utc_offset });
      await api(`/charts/${existing.id}`, 'PATCH', changes);
      refreshCharts();
      window.dispatchEvent(new Event(PROFILE_CHANGED)); // the chart behind redraws with the changes
      navigate(`/charts/${existing.id}`);
    } else {
      const created = await api<{ id: string }>('/charts', 'POST', body);
      closeTab('/charts/new', null); // the new chart opens in its own tab instead
      navigate(`/charts/${created.id}`);
    }
  });

  const remove = (chart: ChartDetail) => {
    if (!confirm(`Remove ${chart.name} from your charts?${plainWording() ? '' : ' It stays in ephemeralREST for anyone else who has it.'}`)) return;
    api(`/charts/${chart.id}`, 'DELETE').then(() => navigate('/charts')).catch((e: unknown) => alert(describe(e)));
  };

  const cancel = () => {
    closeTab('/charts/new', null);
    navigate('/charts');
  };

  const fields = (
    <>
      {error && <Notice tone="error">{error}</Notice>}
      <Field label="Name" value={name} onValue={setName} required />
      <div class="form-grid form-grid--3">
        <Field label="Date" type={'date' as 'text'} value={date} onValue={setDate} required />
        <Field label="Time" type={'time' as 'text'} value={timeUnknown ? '' : time} onValue={setTime}
               hint={timeUnknown ? 'Set for noon' : 'Local time at the place'} />
        <div class="field field--check"><Checkbox label="Time unknown" checked={timeUnknown} onChecked={setTimeUnknown} /></div>
      </div>
      <PlaceField value={place} onValue={typePlace} />
      <Checkbox label="Set the UTC offset myself" checked={manualOffset} onChecked={setManualOffset}
                hint="For wartime or local mean time, where the automatic time zone may be wrong." />
      {manualOffset && <Field label="UTC offset" value={offset} onValue={setOffset} placeholder="+10:00" required />}
      {existing && !manualOffset && existing.location.utc_offset_seconds !== null && (
        <p class="muted small">Calculated with {offsetText(existing.location.utc_offset_seconds)}
          {existing.location.daylight_saving ? ' (daylight saving)' : ''}{existing.location.timezone ? `, ${existing.location.timezone}` : ''}.</p>
      )}
      <div class="form-grid">
        <HouseSystemSelect value={houseSystem} onValue={setHouseSystem} id="field-house-system" />
        <Select label="Rodden rating" value={rating} onValue={setRating} options={RATINGS} />
      </div>
      <div class="form-grid">
        <Select label="Folder" value={folder} onValue={setFolder}
                options={[['', 'None'], ...(folders.state === 'ready' ? folders.data.data.map((f): [string, string] => [f.id, f.name]) : [])]} />
        <TagInput value={tags} onValue={setTags} suggestions={known.state === 'ready' ? known.data.tags : []} />
      </div>
      <Field label="Source" value={source} onValue={setSource} placeholder="Birth certificate" />
      <TextArea label="Notes" value={notes} onValue={setNotes} />
    </>
  );

  if (!existing) {
    return (
      <Modal title="New chart" onClose={cancel} wide>
        <form class="modal__form chart-form" onSubmit={onSubmit}>
          <ModalBody>{fields}</ModalBody>
          <ModalFooter>
            <span class="muted small modal__note">Saved to your charts.</span>
            <Button onClick={cancel}>Cancel</Button>
            <Button type="submit" variant="primary" busy={busy}>Calculate and save</Button>
          </ModalFooter>
        </form>
      </Modal>
    );
  }

  const back = () => navigate(`/charts/${existing.id}`);
  return (
    <Modal title={`Edit ${existing.name}`} onClose={back} wide>
      <form class="modal__form chart-form" onSubmit={onSubmit}>
        <ModalBody>
          <p class="muted small">Correcting the date, time or place recalculates the chart for everyone who has it.</p>
          {fields}
          <div class="field">
            <span>Share</span>
            <CopyText text={existing.id} />
            <small class="muted">{plainWording() ? 'Anyone with an account can add this chart with its id.' : 'Anyone using ephemeralREST can add this chart with its id.'}</small>
          </div>
        </ModalBody>
        <ModalFooter>
          <span class="modal__note"><Button variant="danger" onClick={() => remove(existing)}>Remove from my charts</Button></span>
          <Button onClick={back}>Cancel</Button>
          <Button type="submit" variant="primary" busy={busy}>Save</Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}

/** A place name with suggestions from ephemeralREST as you type. Coordinates like "-31.95, 115.86" work too. */
export function PlaceField({ value, onValue, id = 'place', label = 'Place', required = true, hint }: {
  value: string; onValue: (v: string) => void; id?: string; label?: string; required?: boolean; hint?: string;
}) {
  const [options, setOptions] = useState<string[]>([]);
  const typed = useDebounced(value, 300);
  useEffect(() => {
    if (typed.trim().length < 2 || /^-?\d/.test(typed.trim())) { setOptions([]); return; }
    let current = true;
    api<{ data: Array<{ name: string }> }>(`/places?q=${encodeURIComponent(typed.trim())}`)
      .then((r) => current && setOptions(r.data.map((p) => p.name)))
      .catch(() => current && setOptions([]));
    return () => { current = false; };
  }, [typed]);
  return (
    <label class="field" for={`field-${id}`}>
      <span>{label}</span>
      <input id={`field-${id}`} list={`${id}-options`} value={value} onInput={(e) => onValue(e.currentTarget.value)}
             autoComplete="off" placeholder="Perth, Australia" required={required} />
      <datalist id={`${id}-options`}>{options.map((o) => <option key={o} value={o} />)}</datalist>
      <small class="muted">{hint ?? 'A town or city, or latitude and longitude such as -31.95, 115.86.'}</small>
    </label>
  );
}
