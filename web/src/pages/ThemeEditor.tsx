/**
 * AstrologyStudio ·
 * web/src/pages/ThemeEditor.tsx
 *
 * The theme editor (/view/themes/{id}):
 *
 * grouped colour controls on the left, a live preview of the canvas with a wheel and a dial on the
 * right. Nothing changes anywhere else until Save.
 *
 * Copyright (c) 2026 Gavin Melhuish
 * MIT License; see LICENSE in the project root.
 * SPDX-License-Identifier: MIT
 */

import { useState } from 'preact/hooks';
import { useAppearance, type BodyMode, type Dash, type SignMode, type Theme } from '../appearance';
import { ASPECT_INFO } from '../astro';
import { ThemePreview } from '../components/ThemePreview';
import { contrast, flipped } from '../colour';
import type { Theme as Mode } from '../theme';
import { navigate } from '../router';
import { Button, describe, EmptyState, Field, Notice, PageHeader } from '../ui';

const SIGN_MODES: Array<[SignMode, string]> = [['element', 'By element'], ['modality', 'By modality'], ['sign', 'Each sign'], ['plain', 'Plain']];
const BODY_MODES: Array<[BodyMode, string]> = [['single', 'One colour'], ['element', 'By the element of the sign'], ['sect', 'By sect'], ['body', 'Each body']];
const DASHES: Array<[Dash, string]> = [['solid', 'Solid'], ['dashed', 'Dashed'], ['dotted', 'Dotted']];

/** Which tokens a group shows, given the theme's choices. */
function shownTokens(group: string, tokens: string[], theme: Theme): string[] {
  if (group === 'signs') {
    const keep = theme.signs === 'element' ? ['fire', 'earth', 'air', 'water']
      : theme.signs === 'modality' ? ['cardinal', 'fixed', 'mutable']
      : theme.signs === 'sign' ? tokens.filter((t) => !['fire', 'earth', 'air', 'water', 'cardinal', 'fixed', 'mutable', 'sign-text'].includes(t))
      : [];
    return [...keep, 'sign-text'];
  }
  if (group === 'bodies') {
    if (theme.bodies === 'single') return ['body'];
    if (theme.bodies === 'element') return tokens.filter((t) => t.startsWith('ink-'));
    if (theme.bodies === 'sect') return ['sect-day', 'sect-night', 'body'];
    return tokens.filter((t) => t.startsWith('body-'));
  }
  return tokens;
}

// ---------------------------------------------------------------------------
// Contrast (WCAG 2): text needs 4.5:1 against its background, large symbols and quiet text 3:1.

/** For a text token: what it's read against, and the ratio it needs. */
function contrastCheck(token: string, c: Record<string, string>, theme: Theme): { against: string[]; need: number } | null {
  switch (token) {
    case 'canvas-text': return { against: ['canvas'], need: 4.5 };
    case 'text': return { against: ['chart-bg'], need: 4.5 };
    case 'muted': case 'house-number': return { against: ['chart-bg'], need: 3 };
    case 'angle-text': return { against: ['angle'], need: 4.5 };
    case 'tree-text': return { against: ['canvas'], need: 4.5 };
    case 'body': return { against: ['chart-bg'], need: 3 };
    case 'sign-text': {
      const bands = theme.signs === 'element' ? ['fire', 'earth', 'air', 'water'] : theme.signs === 'modality' ? ['cardinal', 'fixed', 'mutable']
        : theme.signs === 'sign' ? ['aries', 'taurus', 'gemini', 'cancer', 'leo', 'virgo', 'libra', 'scorpio', 'sagittarius', 'capricorn', 'aquarius', 'pisces']
        : ['chart-bg'];
      return { against: bands.filter((k) => c[k]), need: 3 };
    }
    default:
      return token.startsWith('aspect-') || token.startsWith('ink-') || token.startsWith('body-') || token.startsWith('sect-')
        ? { against: ['chart-bg'], need: 3 } : null;
  }
}

function lowContrast(token: string, c: Record<string, string>, theme: Theme): string | null {
  const check = contrastCheck(token, c, theme);
  if (!check || !c[token]) return null;
  const worst = Math.min(...check.against.map((k) => contrast(c[token]!, c[k]!)));
  return worst < check.need ? `Low contrast (${worst.toFixed(1)}:1, aim for ${check.need}:1)` : null;
}

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------

export function ThemeEditor({ id }: { id: string }) {
  const { view, catalog, mode: appMode, patchTheme } = useAppearance();
  const saved = view.themes.find((t) => t.id === id);
  const [draft, setDraft] = useState<Theme | null>(saved ?? null);
  const [mode, setMode] = useState<Mode>(appMode);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<Set<string>>(new Set(['canvas', 'chart']));

  if (!saved || !draft) {
    return <EmptyState title="Theme not found">Only your own themes can be edited. <a href="/view">Back to My View</a></EmptyState>;
  }
  if (saved.kind !== 'own') {
    return <EmptyState title="Built-in and shared themes can't be changed">Duplicate it in My View → Appearance, then edit the copy.</EmptyState>;
  }
  const base = view.themes.find((t) => t.id === draft.base && t.kind === 'builtin');
  const colours = draft[mode];
  const setColour = (token: string, value: string) => setDraft({ ...draft, [mode]: { ...colours, [token]: value.toLowerCase() } });
  const changed = JSON.stringify(draft) !== JSON.stringify(saved);
  const back = () => navigate('/view');
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const { name, signs, bodies, dashes, light, dark } = draft;
      await patchTheme(id, { name, signs, bodies, dashes, light, dark });
      back();
    } catch (e) {
      setError(describe(e));
    } finally {
      setBusy(false);
    }
  };
  const toggle = (group: string) => {
    const next = new Set(open);
    if (next.has(group)) next.delete(group); else next.add(group);
    setOpen(next);
  };
  const tokens = catalog?.tokens ?? [];
  const groups = catalog?.groups ?? [];
  const other: Mode = mode === 'light' ? 'dark' : 'light';
  const kindColour = (kind: 'hard' | 'soft' | 'neutral') => {
    const key = Object.entries(ASPECT_INFO).find(([, i]) => i.kind === kind)?.[0];
    return key ? colours[`aspect-${key}`] ?? '#000000' : '#000000';
  };
  const setKind = (kind: 'hard' | 'soft' | 'neutral', value: string) => {
    const updates: Record<string, string> = {};
    for (const [key, info] of Object.entries(ASPECT_INFO)) if (info.kind === kind) updates[`aspect-${key}`] = value.toLowerCase();
    setDraft({ ...draft, [mode]: { ...colours, ...updates } });
  };

  return (
    <div class="editor">
      <PageHeader title={`Edit theme: ${saved.name}`} intro="Changes show in the preview straight away, and everywhere else once you save."
                  actions={<>
                    <Button onClick={back}>Cancel</Button>
                    <Button variant="primary" busy={busy} disabled={!changed} onClick={() => void save()}>Save</Button>
                  </>} />
      {error && <Notice tone="error">{error}</Notice>}
      <div class="editor__layout">
        <div class="editor__controls">
          <section class="card form-card">
            <Field label="Name" value={draft.name} onValue={(name) => setDraft({ ...draft, name })} />
            <div class="editor__mode">
              <div class="segmented" role="group" aria-label="Version being edited">
                {(['light', 'dark'] as Mode[]).map((m) => (
                  <button key={m} type="button" class={mode === m ? 'is-active' : ''} onClick={() => setMode(m)}>{m === 'light' ? 'Light' : 'Dark'}</button>
                ))}
              </div>
              <button type="button" class="link-button"
                      onClick={() => confirm(`Replace the ${other} version with one worked out from the ${mode} version? You can adjust it afterwards.`)
                        && setDraft({ ...draft, [other]: flipped(colours, other) })}>
                Make {other} from {mode}
              </button>
              {base && (
                <button type="button" class="link-button"
                        onClick={() => confirm(`Put every colour back to ${base.name}'s?`)
                          && setDraft({ ...draft, signs: base.signs, bodies: base.bodies, dashes: { ...base.dashes }, light: { ...base.light }, dark: { ...base.dark } })}>
                  Revert to {base.name}
                </button>
              )}
            </div>
          </section>
          {groups.map((g) => {
            const all = tokens.filter((t) => t.group === g.key).map((t) => t.key);
            const shown = shownTokens(g.key, all, draft);
            const isOpen = open.has(g.key);
            return (
              <section key={g.key} class={`card editor-group${isOpen ? ' is-open' : ''}`}>
                <button type="button" class="editor-group__head" aria-expanded={isOpen} onClick={() => toggle(g.key)}>
                  <span>{g.label}</span>
                  <span class="editor-group__swatches" aria-hidden="true">
                    {shown.slice(0, 6).map((k) => <span key={k} style={{ background: colours[k] }} />)}
                  </span>
                </button>
                {isOpen && (
                  <div class="editor-group__body">
                    {g.key === 'signs' && (
                      <label class="field field--inline"><span>Colour signs</span>
                        <select value={draft.signs} onChange={(e) => setDraft({ ...draft, signs: e.currentTarget.value as SignMode })}>
                          {SIGN_MODES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                        </select></label>
                    )}
                    {g.key === 'bodies' && (
                      <label class="field field--inline"><span>Colour bodies</span>
                        <select value={draft.bodies} onChange={(e) => setDraft({ ...draft, bodies: e.currentTarget.value as BodyMode })}>
                          {BODY_MODES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                        </select></label>
                    )}
                    {g.key === 'aspects' && (
                      <div class="colour-row colour-row--shortcut">
                        <span>All hard, soft, neutral</span>
                        <span class="colour-row__trio">
                          {(['hard', 'soft', 'neutral'] as const).map((k) => (
                            <input key={k} type="color" value={kindColour(k).slice(0, 7)} title={`Every ${k} aspect`}
                                   onInput={(e) => setKind(k, e.currentTarget.value)} />
                          ))}
                        </span>
                      </div>
                    )}
                    {shown.map((key) => {
                      const label = tokens.find((t) => t.key === key)?.label ?? key;
                      const warning = lowContrast(key, colours, draft);
                      const aspect = key.startsWith('aspect-') ? key.slice(7) : null;
                      return (
                        <div key={key} class="colour-row">
                          <label for={`c-${key}`}>{label}</label>
                          <span class="colour-row__inputs">
                            <input id={`c-${key}`} type="color" value={(colours[key] ?? '#000000').slice(0, 7)}
                                   onInput={(e) => setColour(key, e.currentTarget.value)} />
                            <HexInput value={colours[key] ?? ''} onValue={(v) => setColour(key, v)} label={label} />
                            {aspect && (
                              <select aria-label={`${label} line`} value={draft.dashes[aspect] ?? 'solid'}
                                      onChange={(e) => setDraft({ ...draft, dashes: { ...draft.dashes, [aspect]: e.currentTarget.value as Dash } })}>
                                {DASHES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                              </select>
                            )}
                          </span>
                          {warning && <small class="colour-row__warning">{warning}</small>}
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            );
          })}
        </div>
        <div class="editor__preview">
          <ThemePreview theme={draft} mode={mode} show="both" twoRings label="Preview" />
          <p class="muted small">Preview of the {mode} version on a sample chart. Chart 2's ring shows how a second chart looks.</p>
        </div>
      </div>
    </div>
  );
}

/** A hex colour typed in; only passed on once it's valid. */
function HexInput({ value, onValue, label }: { value: string; onValue: (v: string) => void; label: string }) {
  const [text, setText] = useState(value);
  const [focused, setFocused] = useState(false);
  const shown = focused ? text : value;
  return (
    <input class="hex-input" value={shown} aria-label={`${label} (hex)`} spellcheck={false} maxLength={9}
           onFocus={() => { setText(value); setFocused(true); }} onBlur={() => setFocused(false)}
           onInput={(e) => {
             const v = e.currentTarget.value.trim();
             setText(v);
             if (/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(v)) onValue(v);
           }} />
  );
}
