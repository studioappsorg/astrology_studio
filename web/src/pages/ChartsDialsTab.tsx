/**
 * AstrologyStudio ·
 * web/src/pages/ChartsDialsTab.tsx
 *
 * My View → Charts & dials:
 *
 * which dial sizes are offered, the layouts each chart type can be drawn with (chosen from the
 * Layout picker in the top bar on the chart screen), and whether the chart wheel draws lines from
 * moved-aside symbols to their ticks.
 *
 * Copyright (c) 2026 Gavin Melhuish
 * MIT License; see LICENSE in the project root.
 * SPDX-License-Identifier: MIT
 */

import { useState } from 'preact/hooks';
import { useAppearance, type Layout } from '../appearance';
import { DIAL_MODULI, isModulus, MIN_DIAL, sizeLabel, useDialSizes, useLayout, useLeaderLines, type DisplayKey } from '../display';
import { navigate } from '../router';
import { Button, Checkbox, describe, Notice } from '../ui';
import { useView } from '../view';

const DISPLAY_NAMES: Record<DisplayKey, string> = { wheel: 'Chart wheel', hellenistic: 'Hellenistic chart', dial: 'Dial' };

export function ChartsDialsTab() {
  const { feature } = useView();
  const [error, setError] = useState<string | null>(null);
  const displays: DisplayKey[] = ['wheel', ...(feature('hellenistic') ? ['hellenistic' as const] : []), ...(feature('dials') ? ['dial' as const] : [])];
  return (
    <div class="columns">
      {error && <Notice tone="error">{error}</Notice>}
      <section class="card form-card">
        <h2>Layouts</h2>
        <p class="muted small">A layout is what a chart type draws: rings, the degree scale, labels and so on. Choose one here or from the Layout picker on the chart screen. To make your own, duplicate any layout.</p>
        {displays.map((d) => <LayoutList key={d} display={d} onError={setError} />)}
      </section>
      <div class="stack">
        <WheelLines />
        {feature('dials') && <DialSizes />}
      </div>
    </div>
  );
}

function LayoutList({ display, onError }: { display: DisplayKey; onError: (m: string | null) => void }) {
  const { view, copyLayout, deleteLayout } = useAppearance();
  const [chosen, choose] = useLayout(display);
  const layouts = view.layouts.filter((l) => l.display === display);
  const run = (p: Promise<unknown>) => { onError(null); p.catch((e: unknown) => onError(describe(e))); };
  const duplicate = (l: Layout) => run(copyLayout(`${l.name === 'Default layout' ? 'My layout' : `${l.name} copy`}`, l.id)
    .then((id) => navigate(`/view/layouts/${id}`)));
  return (
    <fieldset class="switches switches--wide layout-list">
      <legend>{DISPLAY_NAMES[display]}</legend>
      {layouts.map((l) => (
        <div key={l.id} class="layout-row">
          <label class="check">
            <input type="radio" name={`layout-${display}`} checked={chosen.id === l.id} onChange={() => choose(l.id)} />
            <span>{l.name}{l.kind === 'own' && <small class="muted"> yours</small>}</span>
          </label>
          <span class="layout-row__actions">
            {l.kind === 'own' && <button type="button" class="link-button" onClick={() => navigate(`/view/layouts/${l.id}`)}>Edit</button>}
            <button type="button" class="link-button" onClick={() => duplicate(l)}>Duplicate</button>
            {l.kind === 'own' && (
              <button type="button" class="link-button link-button--danger"
                      onClick={() => confirm(`Delete the layout “${l.name}”?`) && run(deleteLayout(l.id))}>Delete</button>
            )}
          </span>
        </div>
      ))}
    </fieldset>
  );
}

/** Lines from moved-aside symbols back to their ticks on the chart wheel's graduation. */
function WheelLines() {
  const [leaders, setLeaders] = useLeaderLines();
  return (
    <section class="card form-card">
      <h2>Chart wheel</h2>
      <Checkbox label="Lines from each symbol to its place on the graduation" checked={leaders} onChecked={setLeaders}
                hint="Where bodies are close together their symbols are spread apart. These lines lead each moved symbol back to its tick on the graduation, which always marks the body's exact place. For the chart wheel and the Hellenistic chart." />
    </section>
  );
}

function DialSizes() {
  const [sizes, setSizes] = useDialSizes();
  const [text, setText] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const offered = [...new Set([...DIAL_MODULI, ...sizes])].sort((a, b) => b - a);
  const add = () => {
    const value = Number(text.replace('°', '').replace(',', '.'));
    if (!isModulus(value)) {
      setProblem(`A dial size must divide 360° evenly (360, 180, 120, 90, 72, 60, 45, 40, 36, 30, 24, 22.5 …), and be at least ${MIN_DIAL}°.`);
      return;
    }
    setProblem(null);
    setText('');
    setSizes([...sizes, value]);
  };
  return (
    <section class="card form-card">
      <h2>Dial sizes</h2>
      <p class="muted small">The sizes offered beside the chart type when Dial is chosen. With only one on, Dial draws that size.</p>
      <fieldset class="switches dial-sizes">
        <legend class="visually-hidden">Dial sizes</legend>
        {offered.map((m) => {
          const on = sizes.includes(m);
          const last = on && sizes.length === 1;
          return (
            <label key={m} class="check" title={last ? 'Keep at least one size' : undefined}>
              <input type="checkbox" checked={on} disabled={last}
                     onChange={(e) => setSizes(e.currentTarget.checked ? [...sizes, m] : sizes.filter((x) => x !== m))} />
              <span>{sizeLabel(m)}</span>
            </label>
          );
        })}
      </fieldset>
      <div class="inline-add">
        <label class="field field--inline">
          <span>Another size</span>
          <input value={text} inputMode="decimal" placeholder="e.g. 72" onInput={(e) => setText(e.currentTarget.value)}
                 onKeyDown={(e) => e.key === 'Enter' && add()} />
        </label>
        <Button onClick={add} disabled={!text.trim()}>Add</Button>
      </div>
      {problem && <small class="field-error">{problem}</small>}
    </section>
  );
}

