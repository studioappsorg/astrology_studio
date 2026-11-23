/**
 * AstrologyStudio ·
 * web/src/pages/Together.tsx
 *
 * Two charts:
 *
 * synastry (bi-wheel and inter-aspects), the composite chart, or the Davison chart.
 *
 * Copyright (c) 2026 Gavin Melhuish
 * MIT License; see LICENSE in the project root.
 * SPDX-License-Identifier: MIT
 */

import { useRef, useState } from 'preact/hooks';
import { api, type ChartData, type ChartDetail, type ChartSummary, type FoundAspect } from '../api';
import { AspectGrid } from '../components/AspectGrid';
import { ChartPicker, ChartTools } from '../components/ChartPicker';
import { ExportButtons } from '../components/Export';
import { Workspace } from '../components/Workspace';
import { Wheel } from '../components/Wheel';
import { oneOf, usePref } from '../prefs';
import { Loading, useLoad } from '../ui';
import { useView } from '../view';
import { AspectList, birthLine, EmptyWorkspace, SimpleChart, useGlyphs, useShownKeys } from './ChartView';

type Mode = 'synastry' | 'composite' | 'davison';
const MODES: Array<[Mode, string]> = [['synastry', 'Synastry'], ['composite', 'Composite'], ['davison', 'Davison']];

interface Synastry {
  a: ChartData;
  b: ChartData;
  aspects: FoundAspect[];
}

export function Together({ id }: { id: string }) {
  const { feature } = useView();
  const [chart] = useLoad(() => api<ChartDetail>(`/charts/${id}`), [id]);
  const [list] = useLoad(() => api<{ data: ChartSummary[] }>('/charts'));
  const modes = MODES.filter(([m]) => feature(m));
  const [modePref, setMode] = usePref<Mode>('together-mode', 'synastry', oneOf<Mode>('synastry', 'composite', 'davison'));
  const mode = modes.some(([m]) => m === modePref) ? modePref : modes[0]?.[0] ?? 'synastry';
  const [other, setOther] = useState('');
  const others = list.state === 'ready' ? list.data.data.filter((c) => c.id !== id) : [];
  const name = chart.state === 'ready' ? chart.data.name : '';

  const top = (
    <>
      {chart.state === 'ready' && <ChartPicker id={id} name={name} line={birthLine(chart.data)} screen="/with" />}
      <ChartTools id={id} current="/with" feature={feature} />
      <div class="panel-form">
        <label class="inline-select"><span>With</span>
          <select value={other} onChange={(e) => setOther(e.currentTarget.value)}>
            <option value="">Choose a chart</option>
            {others.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <div class="segmented" role="group" aria-label="How">
          {modes.map(([m, label]) => (
            <button key={m} type="button" class={mode === m ? 'is-active' : ''} onClick={() => setMode(m)}>{label}</button>
          ))}
        </div>
      </div>
    </>
  );
  if (!other) return <EmptyWorkspace top={top} message="Choose the other chart." />;
  if (mode === 'synastry') return <SynastryView id={id} other={other} top={top} />;
  return <Combined id={id} other={other} mode={mode} top={top} />;
}

function SynastryView({ id, other, top }: { id: string; other: string; top: preact.ComponentChildren }) {
  const [data] = useLoad(() => api<Synastry>(`/charts/${id}/synastry?with=${other}`), [id, other]);
  const glyphs = useGlyphs();
  const { catalog } = useView();
  const [focus, setFocus] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const keysA = useShownKeys(data.state === 'ready' ? data.data.a.points : {});
  const keysB = useShownKeys(data.state === 'ready' ? data.data.b.points : {});
  const label = (k: string) => catalog.bodies.find((b) => b.key === k)?.label ?? k;
  return (
    <Loading result={data}>
      {() => {
        if (data.state !== 'ready') return null;
        const { a, b } = data.data;
        const inA = new Set(keysA);
        const inB = new Set(keysB);
        const found = data.data.aspects.filter((x) => inA.has(x.a) && inB.has(x.b));
        // The wheel draws lines from an outer-ring body (a) to an inner-ring body (b).
        const cross = { aspects: found.map((x) => ({ ...x, a: x.b, b: x.a })), from: b.points };
        return (
          <Workspace panel={
            <>
              {top}
              <h3 class="subhead">{a.name} (rows) to {b.name} (columns)</h3>
              <AspectGrid rows={keysA} columns={keysB} aspects={found} glyphs={glyphs} focus={focus} onFocus={setFocus} />
              <AspectList aspects={found} glyphs={glyphs} label={label} joiner={[initial(a.name), initial(b.name)]} />
            </>
          } stageFooter={
            <div class="wheel-actions">
              <span class="muted small">Inside: {a.name}. <span class="layer-key layer-key--1" />Outside: {b.name}.</span>
              <ExportButtons target={box} name={`${a.name} and ${b.name}`} />
            </div>
          }>
            <div class="stage-chart" ref={box}>
              <Wheel rings={[{ points: a.points, keys: keysA }, { points: b.points, keys: keysB }]} houses={a.houses}
                     aspects={[]} cross={cross} glyphs={glyphs} focus={focus} onFocus={setFocus} title="Synastry" />
            </div>
          </Workspace>
        );
      }}
    </Loading>
  );
}

const initial = (name: string) => name.trim().split(/\s+/).map((w) => w[0]).join('').slice(0, 3);

function Combined({ id, other, mode, top }: { id: string; other: string; mode: 'composite' | 'davison'; top: preact.ComponentChildren }) {
  const [data] = useLoad(() => api<ChartData & { aspects: FoundAspect[]; datetime_utc: string }>(`/charts/${id}/${mode}?with=${other}`), [id, other, mode]);
  return (
    <Loading result={data}>
      {() => data.state === 'ready' && (
        <SimpleChart data={data.data} title={data.data.name} top={
          <>
            {top}
            <p class="muted small">{mode === 'davison'
              ? `Midpoint in time and space: ${data.data.datetime_utc.replace('T', ' ').slice(0, 16)} UT at ${data.data.location.name}.`
              : 'Each body and house cusp at the nearer midpoint of the two charts.'}</p>
          </>
        } />
      )}
    </Loading>
  );
}
