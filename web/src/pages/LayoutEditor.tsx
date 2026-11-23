/**
 * AstrologyStudio ·
 * web/src/pages/LayoutEditor.tsx
 *
 * The layout editor (/view/layouts/{id}):
 *
 * what a chart wheel, Hellenistic chart or dial draws, with a live preview in the theme in use.
 * Nothing changes elsewhere until Save.
 *
 * Copyright (c) 2026 Gavin Melhuish
 * MIT License; see LICENSE in the project root.
 * SPDX-License-Identifier: MIT
 */

import { useState } from 'preact/hooks';
import { useAppearance, type LayoutOptions } from '../appearance';
import { ThemePreview } from '../components/ThemePreview';
import { navigate } from '../router';
import { Button, describe, EmptyState, Field, Notice, PageHeader } from '../ui';

/** Each option's label, and a label for each of its choices. */
const LABELS: Record<string, [string, Record<string, string>]> = {
  // Chart wheel and Hellenistic chart
  sign_band: ['Zodiac band', { true: 'Show', false: 'Hide' }],
  scale: ['Degree scale', { 1: 'Every degree', 5: 'Every 5°', none: 'None', normal: 'Normal', sparse: 'Numbers only', dense: 'Fine' }],
  houses: ['Houses', { true: 'Show', false: 'Hide' }],
  house_numbers: ['House numbers', { true: 'Show', false: 'Hide' }],
  angles: ['Angles', { badges: 'Badges (AC, MC, DC, IC)', lines: 'Lines with small labels' }],
  labels: ['Degree beside each body', { deg: 'Degrees', degmin: 'Degrees and minutes', none: 'None' }],
  retro: ['Retrograde mark beside each body', { true: 'Show', false: 'Hide' }],
  aspects: ['Aspect lines', { all: 'All', hard: 'Hard aspects only', hover: 'Only for the body under the pointer', none: 'None' }],
  rings: ['Room for bodies', { compact: 'Compact', roomy: 'Roomy (smaller aspect circle)' }],
  glyphs: ['Symbols', { normal: 'Normal', large: 'Large' }],
  // Dial
  numbers: ['Numbers on the scale', { all: 'All', quarters: 'Quarters only' }],
  orbit: ['Crowded symbols', { single: 'Spread along one ring', stacked: 'Stacked on two rings' }],
  pointer: ['Pointer', { both: 'Full line with arrowhead', line: 'Full line', arrow: 'Arrow from the centre' }],
  axis_lines: ['Lines joining midpoints on the pointer', { true: 'Show', false: 'Hide' }],
  trees: ['Midpoint trees', { tree: 'Trees', list: 'One line per midpoint' }],
};

const ORDER: Record<string, string[]> = {
  wheel: ['sign_band', 'scale', 'houses', 'house_numbers', 'angles', 'labels', 'retro', 'aspects', 'rings', 'glyphs'],
  dial: ['scale', 'numbers', 'orbit', 'pointer', 'axis_lines', 'trees', 'glyphs'],
};

export function LayoutEditor({ id }: { id: string }) {
  const { view, catalog, theme, mode, patchLayout } = useAppearance();
  const saved = view.layouts.find((l) => l.id === id);
  const [name, setName] = useState(saved?.name ?? '');
  const [options, setOptions] = useState<LayoutOptions>(saved?.options ?? {});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!saved || saved.kind !== 'own') {
    return <EmptyState title="Layout not found">Only your own layouts can be edited. Duplicate one in Your view → Charts & dials.</EmptyState>;
  }
  const kind = saved.display === 'dial' ? 'dial' : 'wheel';
  const choices = catalog?.options[saved.display] ?? {};
  const changed = name !== saved.name || JSON.stringify(options) !== JSON.stringify(saved.options);
  const back = () => navigate('/view');
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await patchLayout(id, { name, options });
      back();
    } catch (e) {
      setError(describe(e));
    } finally {
      setBusy(false);
    }
  };
  const label = { wheel: 'chart wheel', hellenistic: 'Hellenistic chart', dial: 'dial' }[saved.display];
  return (
    <div class="editor">
      <PageHeader title={`Edit layout: ${saved.name}`} intro={`A layout for the ${label}. Choose it from the Layout picker on the chart screen.`}
                  actions={<>
                    <Button onClick={back}>Cancel</Button>
                    <Button variant="primary" busy={busy} disabled={!changed || !name.trim()} onClick={() => void save()}>Save</Button>
                  </>} />
      {error && <Notice tone="error">{error}</Notice>}
      <div class="editor__layout">
        <div class="editor__controls">
          <section class="card form-card">
            <Field label="Name" value={name} onValue={setName} />
            {ORDER[kind]!.filter((k) => choices[k]).map((key) => {
              const [title, names] = LABELS[key] ?? [key, {}];
              const values = choices[key]!;
              return (
                <label key={key} class="field">
                  <span>{title}</span>
                  <select aria-label={title} value={String(options[key])}
                          onChange={(e) => {
                            const raw = e.currentTarget.value;
                            const value = values.find((v) => String(v) === raw) ?? raw;
                            setOptions({ ...options, [key]: value });
                          }}>
                    {values.map((v) => <option key={String(v)} value={String(v)}>{names[String(v)] ?? String(v)}</option>)}
                  </select>
                </label>
              );
            })}
          </section>
        </div>
        <div class="editor__preview">
          <ThemePreview theme={theme} mode={mode} show={kind}
                        wheelOptions={kind === 'wheel' ? options : null} dialOptions={kind === 'dial' ? options : null} />
          <p class="muted small">Preview on a sample chart, in your theme ({theme.name}).</p>
        </div>
      </div>
    </div>
  );
}
