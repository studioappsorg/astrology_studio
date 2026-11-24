/**
 * AstrologyStudio ·
 * web/src/pages/MyView.tsx
 *
 * My View:
 *
 * the features, bodies and look you want. Only changes what you see. Six tabs: Features (and
 * default school), Appearance (themes and display options), Charts & dials (dial sizes and
 * layouts), Bodies & points, Aspects (which, orbs, colours) and Presets (sets of views charts open
 * with).
 *
 * Copyright (c) 2026 Gavin Melhuish
 * MIT License; see LICENSE in the project root.
 * SPDX-License-Identifier: MIT
 */

import { useEffect, useState } from 'preact/hooks';
import type { School } from '../api';
import { SCHOOL_DISPLAY } from '../display';
import { BODY_LETTERS, textGlyph } from '../astro';
import { oneOf, usePref } from '../prefs';
import { Button, describe, Notice, PageHeader } from '../ui';
import { useView } from '../view';
import { AppearanceTab } from './AppearanceTab';
import { AspectsTab } from './AspectsTab';
import { PresetsTab } from './PresetsTab';
import { ChartsDialsTab } from './ChartsDialsTab';

type Tab = 'features' | 'appearance' | 'charts' | 'bodies' | 'aspects' | 'presets';
const TABS: Array<[Tab, string]> = [['features', 'Features'], ['appearance', 'Appearance'], ['charts', 'Charts & dials'], ['bodies', 'Bodies & points'], ['aspects', 'Aspects'], ['presets', 'Presets']];
const isTab = oneOf<Tab>('features', 'appearance', 'charts', 'bodies', 'aspects', 'presets');

const FEATURE_HINTS: Record<string, string> = {
  transits: 'Transits around a chart, in event lists and on the dial',
  progressions: 'Secondary progressions, day for a year',
  solar_arc: 'Every natal point moved by the solar arc',
  returns: 'Solar and lunar returns',
  overview: 'The Overview tab: elements and modalities, the chart signature, hemispheres, chart shape, patterns and more',
  synastry: 'Two charts together, with the aspects between them',
  composite: 'The midpoint chart of two charts (Change → Derived chart → Composite)',
  davison: 'The chart for the midpoint in time and space (Change → Derived chart → Davison)',
  hellenistic: 'The Hellenistic chart: lots, sect and dignities, and Timing (profections, zodiacal releasing)',
  dials: 'Cosmobiology dials: 90°, and any other size you switch on under Charts & dials',
  midpoints: 'Midpoint trees, what\'s on the pointer, the midpoint sort and midpoint search, beside the dial',
  harmonics: 'Harmonic charts, from Change → Derived chart on the chart screen',
  heliocentric: 'Positions as seen from the Sun',
  time_tools: 'Lists of exact aspects over a range of dates',
  ephemeris: 'A month of daily positions, with ingresses and stations',
};

const OPENS_ON: Record<string, string> = { wheel: 'opens on the chart wheel', hellenistic: 'opens on the Hellenistic chart', dial: 'opens on the dial' };

export function MyView() {
  const { catalog, feature, body, display, update, limitToSchool } = useView();
  const [tab, setTab] = usePref<Tab>('view-tab', 'features', isTab);
  // ?tab=presets (Manage presets… in the preset picker) opens on that tab.
  useEffect(() => {
    const wanted = new URLSearchParams(location.search).get('tab');
    if (isTab(wanted) && wanted !== tab) setTab(wanted);
  }, []);
  const schools = catalog.schools ?? [];
  const school = display.school ?? 'self';
  const own = school === 'self';
  const schoolLabel = schools.find((x) => x.key === school)?.label ?? 'Self-selected';
  const limit = () => {
    const info = schools.find((x) => x.key === school);
    if (!info) return;
    const off = catalog.features.filter((f) => !info.features.includes(f.key) && feature(f.key)).map((f) => f.label);
    const on = catalog.features.filter((f) => info.features.includes(f.key) && !feature(f.key)).map((f) => f.label);
    const message = (own ? 'Go back to the most common techniques?' : `Switch off everything ${info.label} doesn't use?`)
      + (off.length ? `\n\nFeatures switched off: ${off.join(', ')}.` : '')
      + (on.length ? `\n\nFeatures switched on: ${on.join(', ')}.` : '')
      + (own ? '\n\nBodies go back to the usual list too.' : '\n\nBodies are set to the school\'s list too.')
      + ' You can switch anything back on afterwards.';
    if (confirm(message)) run(limitToSchool(school));
  };
  const [error, setError] = useState<string | null>(null);
  const run = (p: Promise<void>) => { setError(null); p.catch((e: unknown) => setError(describe(e))); };
  const groups = [...new Set(catalog.bodies.map((b) => b.group))];
  const setGroup = (group: string, on: boolean) =>
    run(update({ bodies: Object.fromEntries(catalog.bodies.filter((b) => b.group === group).map((b) => [b.key, on])) }));

  return (
    <>
      <PageHeader title="My View" intro="Switch off what you don't use, and choose how charts look. It only changes what you see."
                  actions={<Button onClick={() => confirm('Put every feature, body, display choice and aspect colour back to how it started?') && run(update({ reset: true }))}>Reset to defaults</Button>} />
      {error && <Notice tone="error">{error}</Notice>}
      <div class="tabs" role="tablist" aria-label="My View">
        {TABS.map(([key, label]) => (
          <button key={key} type="button" role="tab" aria-selected={tab === key} class={tab === key ? 'is-active' : ''}
                  onClick={() => setTab(key)}>{label}</button>
        ))}
      </div>
      {tab === 'appearance' && <AppearanceTab />}
      {tab === 'charts' && <ChartsDialsTab />}
      {tab === 'aspects' && <AspectsTab />}
      {tab === 'presets' && <PresetsTab />}
      {tab === 'features' && <div class="columns">
        <section class="card form-card">
          <h2>Features</h2>
          <p class="muted small">Natal charts, positions, aspects and houses are always there.</p>
          <div class="feature-list">
            {catalog.features.map((f) => (
              <label key={f.key} class="feature-row">
                <input type="checkbox" checked={feature(f.key)} onChange={(e) => run(update({ features: { [f.key]: e.currentTarget.checked } }))} />
                <span><strong>{f.label}</strong><small class="muted">{FEATURE_HINTS[f.key] ?? ''}</small></span>
              </label>
            ))}
          </div>
        </section>
        <div>
          <section class="card form-card">
            <h2>Default school</h2>
            <p class="muted small">Choosing a school doesn't switch anything on or off. With Self-selected you mix and match: start from the most common techniques and switch on what you need from any school under Features and Bodies &amp; points. With Modern Western, Hellenistic or Cosmobiology, charts open on that school's chart type each visit.</p>
            <fieldset class="switches switches--wide">
              <legend class="visually-hidden">Default school</legend>
              {schools.map((x) => (
                <label key={x.key} class="check">
                  <input type="radio" name="school" checked={school === x.key}
                         onChange={() => run(update({ display: { ...display, school: x.key as School } }))} />
                  <span><strong>{x.label}</strong> <small class="muted">{x.hint || OPENS_ON[SCHOOL_DISPLAY[x.key] ?? '']}</small></span>
                </label>
              ))}
            </fieldset>
            <Button onClick={limit}>{own ? 'Back to the most common techniques' : `Show only what ${schoolLabel} uses`}</Button>
          </section>
        </div>
      </div>}
      {tab === 'bodies' && <div class="columns columns--single">
        <div>
          <section class="card form-card">
            <h2>Bodies and points</h2>
            {groups.map((group) => (
              <fieldset key={group} class="switches">
                <legend>{group} <button type="button" class="link-button" onClick={() => setGroup(group, true)}>all</button>
                  <button type="button" class="link-button" onClick={() => setGroup(group, false)}>none</button></legend>
                {catalog.bodies.filter((b) => b.group === group).map((b) => (
                  <label key={b.key} class="check">
                    <input type="checkbox" checked={body(b.key)} onChange={(e) => run(update({ bodies: { [b.key]: e.currentTarget.checked } }))} />
                    <span><span class="glyph">{textGlyph(display.glyphs === 'letters' ? BODY_LETTERS[b.key] ?? b.glyph : b.glyph)}</span> {b.label}</span>
                  </label>
                ))}
              </fieldset>
            ))}
          </section>
        </div>
      </div>}
    </>
  );
}
