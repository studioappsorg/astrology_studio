/**
 * AstrologyStudio ·
 * web/src/pages/AppearanceTab.tsx
 *
 * My View → Appearance:
 *
 * the theme gallery (choose, copy, edit, share, import) and the display options (symbols, sizes,
 * line weight, and how degrees, dates and times are written).
 *
 * Copyright (c) 2026 Gavin Melhuish
 * MIT License; see LICENSE in the project root.
 * SPDX-License-Identifier: MIT
 */

import { useRef, useState } from 'preact/hooks';
import { useAppearance, type Appearance, type Theme } from '../appearance';
import { ThemePreview } from '../components/ThemePreview';
import { navigate } from '../router';
import { useSession } from '../session';
import { Button, describe, Notice } from '../ui';
import { useView } from '../view';
import { useStatusBar } from '../frame/layout';

const KIND_LABEL: Record<Theme['kind'], string> = { builtin: 'Built-in', site: 'For everyone', own: 'Yours' };

/** A theme as a file someone else can import. */
export function exportTheme(theme: Theme): void {
  const { name, base, version, signs, bodies, dashes, light, dark } = theme;
  const blob = new Blob([JSON.stringify({ astrologystudio_theme: version, name, base, version, signs, bodies, dashes, light, dark }, null, 2)],
    { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${name.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') || 'theme'}.theme.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function AppearanceTab() {
  const { view, appearance, theme: active, mode, change, copyTheme, importTheme, deleteTheme, publishTheme } = useAppearance();
  const { session } = useSession();
  const owner = session.user.is_owner;
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const run = (p: Promise<unknown>, message?: string) => {
    setError(null);
    setDone(null);
    p.then(() => message && setDone(message)).catch((e: unknown) => setError(describe(e)));
  };

  const duplicate = (t: Theme) => run(copyTheme(`${t.name} copy`, t.id).then((id) => navigate(`/view/themes/${id}`)));
  const remove = (t: Theme) => confirm(`Delete the theme “${t.name}”?`) && run(deleteTheme(t.id));
  const publish = (t: Theme) =>
    confirm(`Publish “${t.name}” for everyone on this install? A copy is published; later changes to yours aren't.`)
    && run(publishTheme(t.id), `“${t.name}” is now available to everyone.`);
  const onFile = async (e: Event) => {
    const input = e.currentTarget as HTMLInputElement;
    const chosen = input.files?.[0];
    input.value = '';
    if (!chosen) return;
    try {
      const raw: unknown = JSON.parse(await chosen.text());
      run(importTheme(raw), 'Theme added. It\'s at the end of the list.');
    } catch {
      setError('That file isn\'t a theme (it isn\'t JSON).');
    }
  };

  const sections: Array<[Theme['kind'], string]> = [['builtin', 'Built-in themes'], ['site', 'Shared on this install'], ['own', 'Your themes']];

  return (
    <div class="appearance">
      {error && <Notice tone="error">{error}</Notice>}
      {done && <Notice tone="success">{done}</Notice>}
      <section class="card form-card">
        <div class="card-head">
          <div>
            <h2>Theme</h2>
            <p class="muted small">A theme colours the canvas, charts and dials. The ☀/☾ button in the top bar still switches the app between light and dark, and picks the theme's light or dark version.</p>
          </div>
          <div class="card-head__actions">
            <input ref={file} type="file" accept=".json,application/json" class="visually-hidden" onChange={onFile} />
            <Button onClick={() => file.current?.click()}>Import theme…</Button>
          </div>
        </div>
        {sections.map(([kind, title]) => {
          const list = view.themes.filter((t) => t.kind === kind);
          if (!list.length) return kind === 'own'
            ? <p key={kind} class="muted small">To make your own theme, choose Duplicate on any theme.</p>
            : null;
          return (
            <div key={kind}>
              <h3 class="theme-section">{title}</h3>
              <div class="theme-grid">
                {list.map((t) => {
                  const inUse = t.id === active.id;
                  return (
                    <article key={t.id} class={`theme-card${inUse ? ' is-active' : ''}`}>
                      <button type="button" class="theme-card__pick" onClick={() => !inUse && run(change({ theme: t.id }))}
                              aria-pressed={inUse} title={inUse ? 'In use' : `Use ${t.name}`}>
                        <ThemePreview theme={t} mode={mode} />
                      </button>
                      <div class="theme-card__body">
                        <div class="theme-card__name">
                          <strong>{t.name}</strong>
                          {inUse ? <span class="badge badge--accent">In use</span> : <span class="badge">{KIND_LABEL[t.kind]}</span>}
                          {view.site_default === t.id && <span class="badge" title="New accounts start with this theme">Default</span>}
                        </div>
                        <div class="theme-card__actions">
                          {!inUse && <button type="button" class="link-button" onClick={() => run(change({ theme: t.id }))}>Use</button>}
                          {t.kind === 'own' && <button type="button" class="link-button" onClick={() => navigate(`/view/themes/${t.id}`)}>Edit</button>}
                          <button type="button" class="link-button" onClick={() => duplicate(t)}>Duplicate</button>
                          <button type="button" class="link-button" onClick={() => exportTheme(t)}>Export</button>
                          {t.kind === 'own' && owner && <button type="button" class="link-button" onClick={() => publish(t)}>Share with everyone</button>}
                          {t.kind === 'own' && <button type="button" class="link-button link-button--danger" onClick={() => remove(t)}>Delete</button>}
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            </div>
          );
        })}
      </section>
      <DisplayOptions appearance={appearance} change={(p) => run(change(p))} />
    </div>
  );
}

type Choice<K extends keyof Appearance> = Array<[Appearance[K], string]>;

const TEXT: Choice<'text_size'> = [[90, 'Smaller (90%)'], [100, 'Normal'], [115, 'Larger (115%)'], [130, 'Largest (130%)']];
const GLYPH: Choice<'glyph_size'> = [['small', 'Small'], ['medium', 'Medium'], ['large', 'Large']];
const LINES: Choice<'line_weight'> = [['fine', 'Fine'], ['normal', 'Normal'], ['bold', 'Bold (projectors and printing)']];
const DEGREES: Choice<'degrees'> = [['dm', "21°14'"], ['dms', '21°14\'32"'], ['decimal', '21.24°']];
const DATES: Choice<'date_format'> = [['ymd', '1985-06-12'], ['dmy', '12/06/1985'], ['mdy', '06/12/1985']];
const TIMES: Choice<'time_format'> = [['24', '14:30'], ['12', '2:30 pm']];
const RETRO: Choice<'retro'> = [['symbol', '℞ (symbol)'], ['letter', 'R']];
const EXPORT: Choice<'export_bg'> = [['theme', 'The canvas, as you see it'], ['white', 'White'], ['transparent', 'Transparent']];

function Radios<K extends keyof Appearance>({ name, legend, value, choices, onPick, hint }: {
  name: K; legend: string; value: Appearance[K]; choices: Choice<K>; onPick: (v: Appearance[K]) => void; hint?: string;
}) {
  return (
    <fieldset class="switches switches--wide option-row">
      <legend>{legend}</legend>
      <div class="option-row__choices">
        {choices.map(([v, label]) => (
          <label key={String(v)} class="check">
            <input type="radio" name={name} checked={value === v} onChange={() => onPick(v)} />
            <span>{label}</span>
          </label>
        ))}
      </div>
      {hint && <small class="muted">{hint}</small>}
    </fieldset>
  );
}

function DisplayOptions({ appearance: a, change }: { appearance: Appearance; change: (p: Partial<Appearance>) => void }) {
  const { display, update } = useView();
  const [statusBar, setStatusBar] = useStatusBar();
  return (
    <section class="card form-card">
      <h2>Display</h2>
      <div class="options-grid">
        <fieldset class="switches switches--wide option-row">
          <legend>Symbols</legend>
          <div class="option-row__choices">
            <label class="check"><input type="radio" name="glyphs" checked={display.glyphs === 'symbols'} onChange={() => void update({ display: { ...display, glyphs: 'symbols' } })} />
              <span><span class="glyph">☉ ☽ ♂ ♈ ♋</span></span></label>
            <label class="check"><input type="radio" name="glyphs" checked={display.glyphs === 'letters'} onChange={() => void update({ display: { ...display, glyphs: 'letters' } })} />
              <span>Su Mo Ma Ar Cn</span></label>
          </div>
        </fieldset>
        <Radios name="text_size" legend="Text size" value={a.text_size} choices={TEXT} onPick={(v) => change({ text_size: v })}
                hint="Everything in the app, charts included." />
        <Radios name="glyph_size" legend="Symbol size on charts and dials" value={a.glyph_size} choices={GLYPH} onPick={(v) => change({ glyph_size: v })} />
        <Radios name="line_weight" legend="Line weight" value={a.line_weight} choices={LINES} onPick={(v) => change({ line_weight: v })} />
        <Radios name="degrees" legend="Degrees" value={a.degrees} choices={DEGREES} onPick={(v) => change({ degrees: v })} />
        <Radios name="date_format" legend="Dates" value={a.date_format} choices={DATES} onPick={(v) => change({ date_format: v })} />
        <Radios name="time_format" legend="Times" value={a.time_format} choices={TIMES} onPick={(v) => change({ time_format: v })} />
        <Radios name="retro" legend="Retrograde" value={a.retro} choices={RETRO} onPick={(v) => change({ retro: v })} />
        <Radios name="export_bg" legend="Background of saved PNG and SVG" value={a.export_bg} choices={EXPORT} onPick={(v) => change({ export_bg: v })} />
        <fieldset class="switches switches--wide option-row">
          <legend>Motion</legend>
          <label class="check">
            <input type="checkbox" checked={a.reduce_motion} onChange={(e) => change({ reduce_motion: e.currentTarget.checked })} />
            <span>Reduce motion <small class="muted">No animated transitions</small></span>
          </label>
        </fieldset>
        <fieldset class="switches switches--wide option-row">
          <legend>Status bar</legend>
          <label class="check">
            <input type="checkbox" checked={statusBar} onChange={(e) => setStatusBar(e.currentTarget.checked)} />
            <span>Show the status bar <small class="muted">The line along the bottom: ephemeralREST, the chart, the version</small></span>
          </label>
        </fieldset>
      </div>
    </section>
  );
}
