/**
 * AstrologyStudio ·
 * web/src/pages/PresetsTab.tsx
 *
 * My View → Presets (1.13): every preset, with its views. Edit a preset's name, theme, profile
 * and views (chart type, dial size, layout, report tab, Between and what chart 2 is); add, remove
 * and reorder its views; duplicate, delete and reorder presets; choose the default for new charts
 * and what happens when a preset with several views meets a chart with several.
 *
 * Copyright (c) 2026 Gavin Melhuish
 * MIT License; see LICENSE in the project root.
 * SPDX-License-Identifier: MIT
 */

import { useState } from 'preact/hooks';
import { api, type ChartSummary } from '../api';
import { useAppearance, type PartnerRoleKey, type Preset, type ViewTemplate } from '../appearance';
import { DIAL_MODULI, sizeLabel, useDialSizes, type DisplayKey } from '../display';
import { APPLY_MODE, DEFAULT_PRESET, describeViews } from '../presets';
import { usePref } from '../prefs';
import { Button, describe, Notice, useLoad } from '../ui';
import { useView } from '../view';
import { MAX_VIEWS } from '../views';

const DISPLAYS: Array<[DisplayKey, string, string | null]> = [['wheel', 'Chart wheel', null], ['hellenistic', 'Hellenistic chart', 'hellenistic'], ['dial', 'Dial', 'dials']];
const REPORTS: Array<[ViewTemplate['report'], string, string | null]> = [
  ['chart', 'Chart', null], ['overview', 'Overview', 'overview'], ['aspects', 'Aspects', null], ['midpoints', 'Midpoints', 'midpoints'],
  ['hellenistic', 'Hellenistic', 'hellenistic'], ['events', 'Events', 'time_tools'],
];
const ROLES: Array<[PartnerRoleKey, string, string | null]> = [
  ['none', 'None (one chart)', null],
  ['ask', 'Ask each time', null],
  ['transits_now', 'Transits now', 'transits'],
  ['progressions_now', 'Progressions to the day', 'progressions'],
  ['solar_arc_now', 'Solar arc to the day', 'solar_arc'],
  ['solar_return_next', 'The year\'s solar return', 'returns'],
  ['lunar_return_next', 'The month\'s lunar return', 'returns'],
  ['fixed', 'Always a particular chart', null],
];
const isString = (v: unknown): v is string => typeof v === 'string';

/** The pre-1.12 fields, from a preset's first view (the server keeps them in step). */
function legacy(views: ViewTemplate[]) {
  const first = views[0]!;
  return {
    display: first.display, dial_size: first.display === 'dial' ? first.dial_size : null, layout: first.layout,
    panel: { aspectarian: first.report === 'aspects', trees: first.report === 'midpoints', timing: first.report === 'hellenistic' },
  };
}

export function PresetsTab() {
  const { view, profiles, addPreset, deletePreset, orderPresets } = useAppearance();
  const [defaultPreset, setDefaultPreset] = usePref<string>(DEFAULT_PRESET, '', isString);
  const [mode, setMode] = usePref<string>(APPLY_MODE, '', isString);
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = (p: Promise<unknown>) => { setError(null); p.catch((e: unknown) => setError(describe(e))); };
  const presets = view.presets;
  const move = (i: number, by: -1 | 1) => {
    const ids = presets.map((p) => p.id);
    const [id] = ids.splice(i, 1);
    ids.splice(i + by, 0, id!);
    run(orderPresets(ids));
  };
  const theme = (id: string | null) => (id ? view.themes.find((t) => t.id === id)?.name ?? 'theme deleted' : null);
  const profile = (id: string | null) => (id ? profiles?.profiles.find((p) => p.id === id)?.name ?? 'profile deleted' : null);

  return (
    <div class="columns columns--single">
      <section class="card form-card presets-tab">
        <h2>Presets</h2>
        <p class="muted small">
          A preset is the set of views a chart opens with (chart type, layout, report tab and chart 2), and the theme and
          calculation profile to use. Apply one from the Preset picker on the chart screen. Make one there with <em>Save this
          chart's views as a preset…</em>, or duplicate one here and edit it.
        </p>
        {error && <Notice tone="error">{error}</Notice>}
        <div class="form-grid form-grid--2">
          <label class="field">
            <span>New charts open with</span>
            <select value={presets.some((p) => p.id === defaultPreset) ? defaultPreset : ''} onChange={(e) => setDefaultPreset(e.currentTarget.value)} aria-label="Default preset for new charts">
              <option value="">One view, from your last choices</option>
              {presets.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <small class="muted">Only charts that have no views yet. Charts you've looked at keep theirs.</small>
          </label>
          <label class="field">
            <span>A preset with several views, on a chart with several</span>
            <select value={mode} onChange={(e) => setMode(e.currentTarget.value)} aria-label="Preset with several views on a chart with several">
              <option value="">Ask each time</option>
              <option value="replace">Replace the chart's views</option>
              <option value="add">Add after the chart's views</option>
            </select>
          </label>
        </div>
        {presets.length === 0 ? <p class="muted small">No presets yet.</p> : (
          <ul class="plain-list preset-rows">
            {presets.map((p, i) => (
              <li key={p.id} class="preset-row">
                <div class="preset-row__head">
                  <div class="preset-row__text">
                    <strong>{p.name}</strong>
                    {p.id === defaultPreset && <span class="badge badge--accent">Default for new charts</span>}
                    <div class="preset-row__chips">
                      {describeViews(p).split(' · ').map((label, j) => <span key={j} class="chip">{label}</span>)}
                    </div>
                    {(p.theme || p.profile) && (
                      <small class="muted">{[theme(p.theme) && `Theme: ${theme(p.theme)}`, profile(p.profile) && `Profile: ${profile(p.profile)}`].filter(Boolean).join(' · ')}</small>
                    )}
                  </div>
                  <span class="layout-row__actions">
                    <button type="button" class="link-button" onClick={() => setEditing(editing === p.id ? null : p.id)}>{editing === p.id ? 'Close' : 'Edit'}</button>
                    <button type="button" class="link-button" onClick={() => run(addPreset({ ...legacy(p.views), name: `${p.name} copy`.slice(0, 60), views: p.views, theme: p.theme, profile: p.profile }))}>Duplicate</button>
                    <button type="button" class="link-button" disabled={i === 0} onClick={() => move(i, -1)} aria-label={`Move ${p.name} up`}>↑</button>
                    <button type="button" class="link-button" disabled={i === presets.length - 1} onClick={() => move(i, 1)} aria-label={`Move ${p.name} down`}>↓</button>
                    <button type="button" class="link-button link-button--danger"
                            onClick={() => confirm(`Delete the preset “${p.name}”? Charts keep their views; its layouts, theme and profile stay.`) && run(deletePreset(p.id).then(() => { if (defaultPreset === p.id) setDefaultPreset(''); }))}>Delete</button>
                  </span>
                </div>
                {editing === p.id && <PresetEditor preset={p} onDone={() => setEditing(null)} onError={setError} />}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function PresetEditor({ preset, onDone, onError }: { preset: Preset; onDone: () => void; onError: (m: string | null) => void }) {
  const { view, profiles, patchPreset } = useAppearance();
  const { feature } = useView();
  const [sizes] = useDialSizes();
  const [name, setName] = useState(preset.name);
  const [theme, setTheme] = useState(preset.theme ?? '');
  const [profile, setProfile] = useState(preset.profile ?? '');
  const [views, setViews] = useState<ViewTemplate[]>(preset.views);
  const [busy, setBusy] = useState(false);
  const needsCharts = views.some((v) => v.partner.role === 'fixed');
  const [charts] = useLoad(() => (needsCharts ? api<{ data: ChartSummary[] }>('/charts') : Promise.resolve({ data: [] })), [needsCharts]);
  const chartList = charts.state === 'ready' ? charts.data.data : [];
  const sizeChoices = [...new Set([...DIAL_MODULI.filter((m) => m >= 22.5), ...sizes])].sort((a, b) => b - a);

  const change = (i: number, patch: Partial<ViewTemplate>) => setViews(views.map((v, j) => (j === i ? { ...v, ...patch } : v)));
  const moveView = (i: number, by: -1 | 1) => {
    const next = [...views];
    const [v] = next.splice(i, 1);
    next.splice(i + by, 0, v!);
    setViews(next);
  };
  const save = () => {
    if (!name.trim()) { onError('Give the preset a name.'); return; }
    const fixedWithout = views.findIndex((v) => v.partner.role === 'fixed' && !v.partner.chart);
    if (fixedWithout >= 0) { onError(`View ${fixedWithout + 1}: choose the chart for "Always a particular chart".`); return; }
    setBusy(true);
    onError(null);
    patchPreset(preset.id, { name: name.trim().slice(0, 60), theme: theme || null, profile: profile || null, views, ...legacy(views) })
      .then(onDone)
      .catch((e: unknown) => onError(describe(e)))
      .finally(() => setBusy(false));
  };

  return (
    <div class="preset-editor">
      <div class="form-grid form-grid--3">
        <label class="field"><span>Name</span><input value={name} maxLength={60} onInput={(e) => setName(e.currentTarget.value)} /></label>
        <label class="field"><span>Theme</span>
          <select value={theme} onChange={(e) => setTheme(e.currentTarget.value)}>
            <option value="">Keep the theme in use</option>
            {view.themes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            {preset.theme && !view.themes.some((t) => t.id === preset.theme) && <option value={preset.theme}>(deleted theme)</option>}
          </select>
        </label>
        <label class="field"><span>Calculation profile</span>
          <select value={profile} onChange={(e) => setProfile(e.currentTarget.value)}>
            <option value="">Keep the profile in use</option>
            {(profiles?.profiles ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            {preset.profile && !profiles?.profiles.some((p) => p.id === preset.profile) && <option value={preset.profile}>(deleted profile)</option>}
          </select>
        </label>
      </div>
      <ol class="preset-editor__views">
        {views.map((v, i) => {
          const layouts = view.layouts.filter((l) => l.display === v.display);
          return (
            <li key={i} class="preset-editor__view">
              <div class="preset-editor__view-head">
                <strong>View {i + 1}</strong>
                <span class="layout-row__actions">
                  <button type="button" class="link-button" disabled={i === 0} onClick={() => moveView(i, -1)} aria-label={`Move view ${i + 1} up`}>↑</button>
                  <button type="button" class="link-button" disabled={i === views.length - 1} onClick={() => moveView(i, 1)} aria-label={`Move view ${i + 1} down`}>↓</button>
                  <button type="button" class="link-button link-button--danger" disabled={views.length < 2} onClick={() => setViews(views.filter((_, j) => j !== i))}>Remove</button>
                </span>
              </div>
              <div class="form-grid form-grid--3">
                <label class="field"><span>Name <small class="muted">(optional)</small></span>
                  <input value={v.name ?? ''} maxLength={60} placeholder="From its settings" onInput={(e) => change(i, { name: e.currentTarget.value.trim() ? e.currentTarget.value : null })} />
                </label>
                <label class="field"><span>Chart type</span>
                  <select value={v.display} onChange={(e) => {
                    const display = e.currentTarget.value as DisplayKey;
                    change(i, { display, layout: null, dial_size: display === 'dial' ? v.dial_size ?? 90 : null });
                  }}>
                    {DISPLAYS.filter(([k, , f]) => !f || feature(f) || k === v.display).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                  </select>
                </label>
                {v.display === 'dial' ? (
                  <label class="field"><span>Dial size</span>
                    <select value={String(v.dial_size ?? 90)} onChange={(e) => change(i, { dial_size: Number(e.currentTarget.value) })}>
                      {sizeChoices.map((m) => <option key={m} value={String(m)}>{sizeLabel(m)}</option>)}
                    </select>
                  </label>
                ) : <span />}
                <label class="field"><span>Layout</span>
                  <select value={v.layout ?? ''} onChange={(e) => change(i, { layout: e.currentTarget.value || null })}>
                    <option value="">Your default layout</option>
                    {layouts.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                  </select>
                </label>
                <label class="field"><span>Report tab</span>
                  <select value={v.report} onChange={(e) => change(i, { report: e.currentTarget.value as ViewTemplate['report'] })}>
                    {REPORTS.filter(([k, , f]) => !f || feature(f) || k === v.report).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                  </select>
                </label>
                <label class="field"><span>Chart 2</span>
                  <select value={v.partner.role} onChange={(e) => change(i, { partner: { role: e.currentTarget.value as PartnerRoleKey } })} aria-label={`Chart 2 of view ${i + 1}`}>
                    {ROLES.filter(([k, , f]) => !f || feature(f) || k === v.partner.role).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                  </select>
                </label>
                {v.partner.role === 'fixed' && (
                  <label class="field"><span>Which chart</span>
                    <select value={v.partner.chart?.id ?? ''} onChange={(e) => {
                      const c = chartList.find((x) => x.id === e.currentTarget.value);
                      change(i, { partner: c ? { role: 'fixed', chart: { id: c.id, derived: false }, chart_name: c.name } : { role: 'fixed' } });
                    }}>
                      <option value="">Choose a chart…</option>
                      {v.partner.chart && !chartList.some((c) => c.id === v.partner.chart!.id) && <option value={v.partner.chart.id}>{v.partner.chart_name ?? 'The chart saved with the preset'}</option>}
                      {chartList.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </label>
                )}
                {v.partner.role !== 'none' && (
                  <label class="check preset-editor__between">
                    <input type="checkbox" checked={v.between} onChange={(e) => change(i, { between: e.currentTarget.checked })} />
                    <span>Aspects: between 1 and 2</span>
                  </label>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      <div class="preset-editor__foot">
        <Button disabled={views.length >= MAX_VIEWS} onClick={() => setViews([...views, { name: null, display: 'wheel', dial_size: null, layout: null, report: 'chart', between: false, partner: { role: 'none' } }])}>Add a view</Button>
        <span class="preset-editor__save">
          <Button onClick={onDone}>Cancel</Button>
          <Button variant="primary" busy={busy} onClick={save}>Save preset</Button>
        </span>
      </div>
    </div>
  );
}
