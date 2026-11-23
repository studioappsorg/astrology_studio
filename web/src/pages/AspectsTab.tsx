/**
 * AstrologyStudio ·
 * web/src/pages/AspectsTab.tsx
 *
 * Your view → Aspects:
 *
 * which aspects you use, their orbs, and their colours.
 *
 * Switching an aspect off means it's not found at all, so it's not drawn on any chart or listed in
 * any report (aspect grids and lists, synastry, Hellenistic aspects by sign, events). On/off and
 * orbs belong to the active calculation profile (the same table as Settings → Calculation
 * profiles), so a preset that switches profile switches them too. Colours are yours, over
 * whichever theme is in use.
 *
 * Copyright (c) 2026 Gavin Melhuish
 * MIT License; see LICENSE in the project root.
 * SPDX-License-Identifier: MIT
 */

import { useEffect, useState } from 'preact/hooks';
import { api, type Calculation } from '../api';
import { useAppearance, PROFILE_CHANGED } from '../appearance';
import { useLineGlyphs } from '../display';
import { ASPECT_INFO, textGlyph } from '../astro';
import { Link } from '../router';
import { Checkbox, describe, Loading, Notice, useLoad } from '../ui';
import { useView } from '../view';

/** The theme's colour for an aspect, as #rrggbb, for the colour picker's starting point. */
function themeColour(key: string): string {
  const probe = document.createElement('span');
  probe.style.color = `var(--t-aspect-${key})`;
  document.body.appendChild(probe);
  const rgb = getComputedStyle(probe).color.match(/\d+/g)?.slice(0, 3).map(Number) ?? [128, 128, 128];
  probe.remove();
  return `#${rgb.map((n) => n.toString(16).padStart(2, '0')).join('')}`;
}

export function AspectsTab() {
  const [calc, reload] = useLoad(() => api<Calculation>('/preferences/calculation'));
  const { switches, update } = useView();
  const { theme, mode } = useAppearance();
  const [lineGlyphs, setLineGlyphs] = useLineGlyphs();
  const [error, setError] = useState<string | null>(null);
  const colours = switches.aspect_colours ?? {};
  // Re-read the theme's colours when the theme, light/dark or your colours change.
  const [, setTick] = useState(0);
  useEffect(() => setTick((n) => n + 1), [theme.id, mode, JSON.stringify(colours)]);
  useEffect(() => {
    window.addEventListener(PROFILE_CHANGED, reload);
    return () => window.removeEventListener(PROFILE_CHANGED, reload);
  }, []);

  const saveProfile = (change: Record<string, { on?: boolean; orb?: number }>) => {
    if (calc.state !== 'ready') return;
    setError(null);
    api(`/preferences/profiles/${calc.data.active}`, 'PATCH', { aspects: change })
      .then(() => window.dispatchEvent(new Event(PROFILE_CHANGED)))
      .catch((e: unknown) => setError(describe(e)));
  };
  const setColour = (key: string, colour: string | null) => {
    setError(null);
    update({ aspect_colours: { [key]: colour } }).catch((e: unknown) => setError(describe(e)));
  };

  return (
    <div class="columns columns--single">
      <section class="card form-card aspects-tab">
        <h2>Aspects</h2>
        {error && <Notice tone="error">{error}</Notice>}
        <Loading result={calc}>
          {() => {
            if (calc.state !== 'ready') return null;
            const profile = calc.data.profiles.find((p) => p.id === calc.data.active) ?? calc.data.profiles[0]!;
            const all = calc.data.aspects;
            const setAll = (which: (major: boolean) => boolean) =>
              saveProfile(Object.fromEntries(all.map((a) => [a.key, { on: which(a.major) }])));
            return (
              <>
                <p class="muted small">
                  Switch off the aspects you don't use: they aren't drawn on charts or listed in any report (aspect
                  grids and lists, synastry, Hellenistic aspects by sign, events). Which aspects are on, and their
                  orbs, belong to your calculation profile <strong>{profile.name}</strong>, so a preset that changes
                  profile changes them too (more in <Link href="/settings">Settings</Link>). Colours are yours, whichever
                  theme you use.
                </p>
                <p class="aspects-tab__quick">
                  <button type="button" class="link-button" onClick={() => setAll(() => true)}>All</button>
                  <button type="button" class="link-button" onClick={() => setAll((major) => major)}>Major only</button>
                  <button type="button" class="link-button" onClick={() => setAll(() => false)}>None</button>
                </p>
                <table class="table table--compact aspect-settings">
                  <thead><tr><th>Use</th><th>Aspect</th><th class="num">Angle</th><th>Orb</th><th>Colour</th></tr></thead>
                  <tbody>
                    {all.map((a) => {
                      const setting = profile.aspects[a.key] ?? { on: false, orb: a.default_orb };
                      const own = colours[a.key];
                      return (
                        <tr key={a.key} class={setting.on ? '' : 'is-off'}>
                          <td><input type="checkbox" checked={setting.on} aria-label={`Use ${a.name}`}
                                     onChange={(e) => saveProfile({ [a.key]: { on: e.currentTarget.checked } })} /></td>
                          <td>
                            <span class="glyph aspect-settings__glyph" style={{ color: `var(--t-aspect-${a.key})` }}>{textGlyph(ASPECT_INFO[a.key]?.glyph ?? a.glyph)}</span>
                            {' '}{a.name}{a.major ? '' : <span class="muted small"> minor</span>}
                          </td>
                          <td class="num">{a.angle}°</td>
                          <td>
                            <input type="number" min={0} max={15} step={0.5} value={setting.orb} class="orb-input" aria-label={`${a.name} orb`}
                                   disabled={!setting.on} onChange={(e) => saveProfile({ [a.key]: { orb: Number(e.currentTarget.value) } })} />°
                          </td>
                          <td class="aspect-settings__colour">
                            <input type="color" value={own ?? themeColour(a.key)} aria-label={`${a.name} colour`}
                                   onChange={(e) => setColour(a.key, e.currentTarget.value)} />
                            {own
                              ? <button type="button" class="link-button" onClick={() => setColour(a.key, null)} title="Use the theme's colour again">Theme colour</button>
                              : <span class="muted small">Theme</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <Checkbox label="Show each aspect's symbol in the middle of its line" checked={lineGlyphs} onChecked={setLineGlyphs}
                          hint="On the chart wheel and the Hellenistic chart." />
              </>
            );
          }}
        </Loading>
      </section>
    </div>
  );
}
