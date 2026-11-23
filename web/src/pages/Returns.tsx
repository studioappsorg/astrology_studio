/**
 * AstrologyStudio ·
 * web/src/pages/Returns.tsx
 *
 * Solar and lunar returns, calculated by ephemeralREST, optionally with the natal chart around them.
 *
 * Copyright (c) 2026 Gavin Melhuish
 * MIT License; see LICENSE in the project root.
 * SPDX-License-Identifier: MIT
 */

import { useState } from 'preact/hooks';
import { api, type ChartData, type ChartDetail, type FoundAspect } from '../api';
import { oneOf, usePref } from '../prefs';
import { ChartPicker, ChartTools } from '../components/ChartPicker';
import { Button, Checkbox, Field, Loading, Notice, useLoad, useSubmit } from '../ui';
import { useView } from '../view';
import { useDefaults } from '../defaults';
import { birthLine, EmptyWorkspace, SimpleChart } from './ChartView';

type Kind = 'solar' | 'lunar';
type ReturnChart = ChartData & { aspects: FoundAspect[]; kind: Kind; return_utc: string | null };
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function Returns({ id }: { id: string }) {
  const [chart] = useLoad(() => api<ChartDetail>(`/charts/${id}`), [id]);
  return <Loading result={chart}>{() => chart.state === 'ready' && <ReturnsScreen chart={chart.data} />}</Loading>;
}

function ReturnsScreen({ chart }: { chart: ChartDetail }) {
  const defaults = useDefaults();
  const now = new Date();
  const [kind, setKind] = usePref<Kind>('return-kind', 'solar', oneOf<Kind>('solar', 'lunar'));
  const [year, setYear] = useState(String(now.getFullYear()));
  const [month, setMonth] = useState(String(now.getMonth() + 1));
  const [place, setPlace] = useState('');
  const [withNatal, setWithNatal] = useState(false);
  const [result, setResult] = useState<ReturnChart | null>(null);
  const { busy, error, onSubmit } = useSubmit(async () => {
    const body: Record<string, unknown> = { kind, year: Number(year), place };
    if (kind === 'lunar') body.month = Number(month);
    setResult(await api<ReturnChart>(`/charts/${chart.id}/returns`, 'POST', body));
  });
  const { feature } = useView();
  const top = (
    <>
      <ChartPicker id={chart.id} name={chart.name} line={birthLine(chart)} screen="/returns" />
      <ChartTools id={chart.id} current="/returns" feature={feature} />
      <form class="panel-form" onSubmit={onSubmit}>
        <div class="segmented" role="group" aria-label="Return">
          <button type="button" class={kind === 'solar' ? 'is-active' : ''} onClick={() => setKind('solar')}>Solar return</button>
          <button type="button" class={kind === 'lunar' ? 'is-active' : ''} onClick={() => setKind('lunar')}>Lunar return</button>
        </div>
        <div class="panel-row">
          <label class="inline-select"><span>Year</span>
            <input type="number" min={1800} max={2199} value={year} onInput={(e) => setYear(e.currentTarget.value)} class="year-input" />
          </label>
          {kind === 'lunar' && (
            <label class="inline-select"><span>Month</span>
              <select value={month} onChange={(e) => setMonth(e.currentTarget.value)}>
                {MONTHS.map((m, i) => <option key={m} value={String(i + 1)}>{m}</option>)}
              </select>
            </label>
          )}
        </div>
        <Field label="Where (optional)" value={place} onValue={setPlace} placeholder={defaults?.place || chart.place || 'Birth place'} />
        <Button type="submit" variant="primary" busy={busy}>Calculate</Button>
      </form>
      {error && <Notice tone="error">{error}</Notice>}
      {result && (
        <div class="panel-result">
          <p><strong>{result.kind === 'solar' ? 'Solar' : 'Lunar'} return</strong> {result.return_utc?.replace('T', ' ').slice(0, 16)} UT · {result.location.name}</p>
          <Checkbox label="Show the natal chart around it" checked={withNatal} onChecked={setWithNatal} />
        </div>
      )}
    </>
  );
  if (!result) return <EmptyWorkspace top={top} message="Choose a year and press Calculate." />;
  return <SimpleChart data={result} title={`${result.kind} return`} top={top}
                      outer={withNatal ? { points: chart.points, label: `${chart.name}, natal` } : null} />;
}
