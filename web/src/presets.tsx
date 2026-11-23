/**
 * AstrologyStudio ·
 * web/src/presets.tsx
 *
 * Presets (1.12): a named set of views a chart opens with, plus (optionally) a theme and a
 * calculation profile. Chosen from the picker on the chart screen's title bar:
 *
 * - A one-view preset changes the view on screen.
 * - A preset with several views gives the chart those views, in the same tab. If the chart already
 *   has several views it asks the first time whether to replace them or add after them (with
 *   "Remember my choice").
 *
 * Chart 2 in a preset is a role: none, ask each time (the chart dialog opens for it), a chart
 * worked out for now (transits, progressions, solar arc, returns), or one particular chart.
 * "Save this chart's views as a preset…" makes one from the chart's views; "Open new charts with
 * this preset" makes it the default for charts that have no views yet.
 *
 * A preset refers to layouts, its theme and profile rather than copying them. If one has gone,
 * using the preset falls back to the default for that part and says so. When a chart's views no
 * longer look like its preset's, the picker marks it "(changed)" and offers to save the change.
 *
 * Copyright (c) 2026 Gavin Melhuish
 * MIT License; see LICENSE in the project root.
 * SPDX-License-Identifier: MIT
 */

import { useEffect, useState } from 'preact/hooks';
import { useAppearance, type Preset, type PresetBody, type ViewTemplate } from './appearance';
import { Modal, ModalBody, ModalFooter } from './components/Modal';
import { isModulus, sizeLabel } from './display';
import { templateOf, viewsDiffer } from './presetDiff';
import { layoutResolver, patchFromTemplate, viewsFromPreset } from './presetViews';
import { getPref, setPref, usePref } from './prefs';
import { reportOf } from './report';
import { navigate } from './router';
import { useView } from './view';
import { MAX_VIEWS, setNewChartViews, useActiveView, viewLabel, type ChartViewsHandle } from './views';

const NOTICE = 'astrologystudio:preset-notice';
const isString = (v: unknown): v is string => typeof v === 'string';
type Mode = 'replace' | 'add';
const isMode = (v: unknown): v is Mode | '' => v === 'replace' || v === 'add' || v === '';
/** Your answer to "replace or add" when a preset with several views meets a chart with several. */
export const APPLY_MODE = 'preset-apply-mode';
/** The preset charts with no views yet open with ('' for none). */
export const DEFAULT_PRESET = 'default-preset';

function notify(message: string): void {
  window.dispatchEvent(new CustomEvent(NOTICE, { detail: message }));
}

/** A preset's views, said briefly: "Western · Dial 90° · + partner". */
export function describeViews(p: Preset): string {
  return p.views.map((t) => {
    const base = t.display === 'dial' ? `Dial ${sizeLabel(t.dial_size ?? 90)}` : t.display === 'hellenistic' ? 'Hellenistic' : 'Western';
    const role = t.partner.role;
    const other = role === 'none' ? '' : role === 'ask' ? 'partner (ask)' : role === 'fixed' ? t.partner.chart_name ?? 'a chart'
      : { transits_now: 'transits now', progressions_now: 'progressions', solar_arc_now: 'solar arc', solar_return_next: 'solar return', lunar_return_next: 'lunar return' }[role];
    return t.name ?? (other ? (t.display === 'wheel' ? `+ ${other}` : `${base} + ${other}`) : base);
  }).join(' · ');
}

/** The pre-1.12 fields of a preset, from its first view (kept so older code and clients read it). */
function legacyOf(first: ViewTemplate): Pick<PresetBody, 'display' | 'dial_size' | 'layout' | 'panel'> {
  return {
    display: first.display,
    dial_size: first.display === 'dial' ? first.dial_size : null,
    layout: first.layout,
    panel: { aspectarian: first.report === 'aspects', trees: first.report === 'midpoints', timing: first.report === 'hellenistic' },
  };
}

/** Put a preset to use. On the chart screen it sets the chart's views (`mode` for a preset with
 * several views when the chart has several already); anywhere, it sets the theme and profile and
 * makes its first view the starting point for new views. */
export function useApplyPreset(): (preset: Preset, mode?: Mode) => Promise<void> {
  const { view, profiles, change, activateProfile } = useAppearance();
  const { feature } = useView();
  const onScreen = useActiveView();
  return async (preset, mode = 'replace') => {
    const missing: string[] = [];
    const first = preset.views[0]!;
    // The starting point for new views.
    const display = (first.display === 'dial' && !feature('dials')) || (first.display === 'hellenistic' && !feature('hellenistic')) ? 'wheel' : first.display;
    setPref('canvas-display', display);
    if (display === 'dial' && first.dial_size && isModulus(first.dial_size)) {
      const sizes = getPref<number[]>('dial-sizes', [90], (v): v is number[] => Array.isArray(v) && v.every(isModulus));
      if (!sizes.includes(first.dial_size)) setPref('dial-sizes', [...sizes, first.dial_size].sort((a, b) => b - a));
      setPref('dial-modulus', first.dial_size);
    }
    if (first.layout && view.layouts.some((l) => l.id === first.layout && l.display === display)) setPref(`canvas-layout-${display}`, first.layout);
    setPref('chart-report', reportOf(legacyOf(first).panel));
    // Dial sizes the views use are offered in the dial size picker.
    for (const t of preset.views) {
      if (t.display !== 'dial' || !t.dial_size || !isModulus(t.dial_size)) continue;
      const sizes = getPref<number[]>('dial-sizes', [90], (v): v is number[] => Array.isArray(v) && v.every(isModulus));
      if (!sizes.includes(t.dial_size)) setPref('dial-sizes', [...sizes, t.dial_size].sort((a, b) => b - a));
    }
    if (preset.theme) {
      if (view.themes.some((t) => t.id === preset.theme)) {
        if (preset.theme !== view.appearance.theme) await change({ theme: preset.theme });
      } else missing.push('its theme is no longer available, so your current theme stays');
    }
    if (preset.profile) {
      if (profiles?.profiles.some((p) => p.id === preset.profile)) await activateProfile(preset.profile);
      else missing.push('its calculation profile has been deleted, so the current profile stays');
    }
    setPref('preset', preset.id);
    if (onScreen) {
      const built = await viewsFromPreset(preset, onScreen.chartId, feature, view.layouts);
      missing.push(...built.missing);
      const handle = onScreen.handle;
      if (preset.views.length === 1 && mode === 'replace') {
        onScreen.update(patchFromTemplate(first, built.views[0]!));
        handle.setPreset(preset.id);
      } else if (mode === 'add') {
        const room = MAX_VIEWS - handle.views.length;
        handle.addMany(built.views);
        if (room < built.views.length) missing.push(`a chart has at most ${MAX_VIEWS} views, so ${room ? `only ${room} of its views were added` : 'none of its views could be added'}`);
      } else {
        handle.replaceAll(built.views, preset.id);
      }
    }
    if (missing.length) notify(`“${preset.name}”: ${missing.join('; ')}.`);
  };
}

/** Charts with no views yet open with your default preset, if you've chosen one. */
export function NewChartPresets() {
  const { view } = useAppearance();
  const { feature } = useView();
  const [chosen] = usePref<string>(DEFAULT_PRESET, '', isString);
  useEffect(() => {
    const preset = view.presets.find((p) => p.id === chosen);
    setNewChartViews(preset ? async (chartId) => {
      const built = await viewsFromPreset(preset, chartId, feature, view.layouts);
      return built.views.length ? { views: built.views, active: built.views[0]!.id, preset: preset.id } : null;
    } : null);
    return () => setNewChartViews(null);
  }, [chosen, view.presets, view.layouts]);
  return null;
}

/** The preset picker, in the chart screen's title bar. */
export function PresetPicker() {
  const { view, appearance, profiles, patchPreset } = useAppearance();
  const onScreen = useActiveView();
  const apply = useApplyPreset();
  const [modePref] = usePref<Mode | ''>(APPLY_MODE, '', isMode);
  const [saving, setSaving] = useState(false);
  const [asking, setAsking] = useState<Preset | null>(null);
  if (!onScreen) return null;
  const handle = onScreen.handle;
  const presets = view.presets;
  const active = presets.find((p) => p.id === handle.preset) ?? null;
  const resolve = layoutResolver(view.layouts);
  const now = handle.views.map((v) => templateOf(v, resolve));
  const changed = active ? viewsDiffer(active, now, resolve) : false;
  const use = (preset: Preset, mode?: Mode) => void apply(preset, mode).catch((e: unknown) => notify(String(e)));

  const choose = (preset: Preset) => {
    // A preset with several views, on a chart with several of its own: replace or add?
    if (preset.views.length > 1 && handle.views.length > 1) {
      if (modePref) use(preset, modePref);
      else setAsking(preset);
      return;
    }
    use(preset);
  };
  const onChange = (value: string) => {
    if (value === '__new') setSaving(true);
    else if (value === '__manage') navigate('/view?tab=presets');
    else if (value === '__save' && active) {
      // Keep the preset's own choice of chart 2 where a view's chart 2 is still the kind it made.
      const views = now.map((t, i) => {
        const own = active.views[i];
        return own && t.partner.role !== 'none' && own.partner.role !== 'none' ? { ...t, partner: own.partner } : t;
      });
      void patchPreset(active.id, { views, ...legacyOf(views[0]!), theme: appearance.theme, profile: profiles?.active ?? null })
        .then(() => notify(`Saved the changes to “${active.name}”.`));
    } else if (value === '') handle.setPreset(null);
    else {
      const preset = presets.find((p) => p.id === value);
      if (preset) choose(preset);
    }
  };

  return (
    <>
      <label class="display-picker display-picker--preset">
        <span class="visually-hidden">Preset</span>
        <select value={active ? active.id : ''} onChange={(e) => {
          const value = e.currentTarget.value;
          // Reset the select itself for the actions; the chart's preset decides what it shows.
          e.currentTarget.value = active ? active.id : '';
          onChange(value);
        }} aria-label="Preset" title={active ? `Preset: ${active.name}${changed ? ' (changed)' : ''}` : 'Presets'}>
          <option value="">{presets.length ? 'No preset' : 'Presets'}</option>
          {presets.map((p) => (
            <option key={p.id} value={p.id}>
              {p.id === active?.id && changed ? `${p.name} (changed)` : p.name}
              {p.views.length > 1 ? ` · ${p.views.length} views` : p.display === 'dial' && p.dial_size ? ` · ${sizeLabel(p.dial_size)}` : ''}
            </option>
          ))}
          <option disabled>──────────</option>
          {active && changed && <option value="__save">Save changes to “{active.name}”</option>}
          <option value="__new">Save this chart's views as a preset…</option>
          <option value="__manage">Manage presets…</option>
        </select>
      </label>
      {saving && <SavePresetModal handle={handle} onClose={() => setSaving(false)} />}
      {asking && (
        <ApplyModeModal preset={asking} count={handle.views.length}
                        onChoose={(mode, remember) => {
                          if (remember) setPref(APPLY_MODE, mode);
                          use(asking, mode);
                          setAsking(null);
                        }}
                        onClose={() => setAsking(null)} />
      )}
    </>
  );
}

/** "Replace these views, or add after them?" for a preset with several views. */
function ApplyModeModal({ preset, count, onChoose, onClose }: {
  preset: Preset; count: number; onChoose: (mode: Mode, remember: boolean) => void; onClose: () => void;
}) {
  const [remember, setRemember] = useState(false);
  return (
    <Modal title={`Use “${preset.name}”`} onClose={onClose}>
      <ModalBody>
        <p>This chart already has {count} views. Use the preset's {preset.views.length} views ({describeViews(preset)}) instead of them, or add them after?</p>
        <label class="check">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.currentTarget.checked)} />
          <span>Remember my choice <small class="muted">(change it in Your view → Presets)</small></span>
        </label>
      </ModalBody>
      <ModalFooter>
        <button type="button" class="btn" onClick={onClose}>Cancel</button>
        <button type="button" class="btn" onClick={() => onChoose('add', remember)}>Add after them</button>
        <button type="button" class="btn btn--primary" onClick={() => onChoose('replace', remember)} data-autofocus>Replace them</button>
      </ModalFooter>
    </Modal>
  );
}

/** Save this chart's views as a preset: choose which, and what each chart 2 should be. */
function SavePresetModal({ handle, onClose }: { handle: ChartViewsHandle; onClose: () => void }) {
  const { view, appearance, profiles, addPreset } = useAppearance();
  const [name, setName] = useState('');
  const [included, setIncluded] = useState<boolean[]>(() => handle.views.map(() => true));
  const [exact, setExact] = useState<boolean[]>(() => handle.views.map(() => false));
  const [asDefault, setAsDefault] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const resolve = layoutResolver(view.layouts);
  const save = async (e: Event) => {
    e.preventDefault();
    const label = name.trim();
    if (!label) { setError('Give the preset a name.'); return; }
    const views = handle.views.map((v, i) => (included[i] ? templateOf(v, resolve, exact[i]) : null)).filter((t): t is ViewTemplate => t !== null);
    if (!views.length) { setError('Tick at least one view.'); return; }
    setBusy(true);
    try {
      const id = await addPreset({ name: label.slice(0, 60), views, ...legacyOf(views[0]!), theme: appearance.theme, profile: profiles?.active ?? null });
      handle.setPreset(id);
      setPref('preset', id);
      if (asDefault) setPref(DEFAULT_PRESET, id);
      notify(`Saved “${label}”${asDefault ? ', and new charts will open with it' : ''}.`);
      onClose();
    } catch (err) {
      setError(String(err));
      setBusy(false);
    }
  };
  const roleName = (i: number) => {
    const v = handle.views[i]!;
    return v.partner_role ? { transits_now: 'Transits now', progressions_now: 'Progressions to the day', solar_arc_now: 'Solar arc to the day', solar_return_next: 'That year\'s solar return', lunar_return_next: 'That month\'s lunar return' }[v.partner_role]
      : 'Ask each time';
  };
  return (
    <Modal title="Save this chart's views as a preset" onClose={onClose} wide>
      <form onSubmit={(e) => void save(e)}>
        <ModalBody>
          {error && <div class="notice notice--error" role="alert">{error}</div>}
          <label class="field">
            <span>Name</span>
            <input value={name} onInput={(e) => setName(e.currentTarget.value)} placeholder="For example “Full reading” or “Relationship”" maxLength={60} />
          </label>
          <div class="preset-save__views">
            {handle.views.map((v, i) => (
              <div key={v.id} class="preset-save__view">
                <label class="check">
                  <input type="checkbox" checked={included[i]} onChange={(e) => setIncluded(included.map((x, j) => (j === i ? e.currentTarget.checked : x)))} />
                  <span><strong>{viewLabel(v)}</strong></span>
                </label>
                {v.partner && (
                  <div class="segmented preset-save__chart2" role="group" aria-label={`Chart 2 of ${viewLabel(v)}`}>
                    <button type="button" class={exact[i] ? '' : 'is-active'} aria-pressed={!exact[i]} onClick={() => setExact(exact.map((x, j) => (j === i ? false : x)))}>{roleName(i)}</button>
                    <button type="button" class={exact[i] ? 'is-active' : ''} aria-pressed={exact[i]} onClick={() => setExact(exact.map((x, j) => (j === i ? true : x)))}>Always {v.partner_name ?? 'this chart'}</button>
                  </div>
                )}
              </div>
            ))}
          </div>
          <p class="muted small">The preset also keeps your current theme and calculation profile, and switches to them when it's used.</p>
          <label class="check">
            <input type="checkbox" checked={asDefault} onChange={(e) => setAsDefault(e.currentTarget.checked)} />
            <span>Open new charts with this preset</span>
          </label>
        </ModalBody>
        <ModalFooter>
          <button type="button" class="btn" onClick={onClose}>Cancel</button>
          <button type="submit" class="btn btn--primary" disabled={busy}>{busy ? 'Saving…' : 'Save preset'}</button>
        </ModalFooter>
      </form>
    </Modal>
  );
}

/** A short message after using or saving a preset, under the top bar. */
export function PresetNotice() {
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const show = (e: Event) => {
      setMessage((e as CustomEvent<string>).detail);
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => setMessage(null), 7000);
    };
    window.addEventListener(NOTICE, show);
    return () => { window.removeEventListener(NOTICE, show); if (timer) clearTimeout(timer); };
  }, []);
  if (!message) return null;
  return (
    <div class="preset-notice" role="status">
      <span>{message}</span>
      <button type="button" class="link-button" onClick={() => setMessage(null)} aria-label="Dismiss">×</button>
    </div>
  );
}
