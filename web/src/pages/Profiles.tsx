/**
 * AstrologyStudio ·
 * web/src/pages/Profiles.tsx
 *
 * Calculation profiles:
 *
 * named sets of house system, zodiac and aspect orbs. One is active.
 *
 * Copyright (c) 2026 Gavin Melhuish
 * MIT License; see LICENSE in the project root.
 * SPDX-License-Identifier: MIT
 */

import { useState } from 'preact/hooks';
import { api, type Calculation, type Profile } from '../api';
import { textGlyph } from '../astro';
import { Button, describe, Loading, Notice, Select, useLoad } from '../ui';
import { PROFILE_CHANGED } from '../appearance';
import { plainWording } from '../hosted';

export function Profiles() {
  const [calc, reload] = useLoad(() => api<Calculation>('/preferences/calculation'));
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = (p: Promise<unknown>) => { setError(null); p.then(reload).catch((e: unknown) => setError(describe(e))); };

  return (
    <section class="card form-card profiles">
      <div class="profiles__head">
        <div>
          <h2>Calculation profiles</h2>
          <p class="muted small">House system, zodiac and aspect orbs. Keep several and switch between them on any chart.</p>
        </div>
        {calc.state === 'ready' && (
          <Button onClick={() => {
            const name = prompt('Name for the new profile', 'My profile');
            if (name) run(api('/preferences/profiles', 'POST', { name, copy_from: calc.data.active }));
          }}>Add a profile</Button>
        )}
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      <Loading result={calc}>
        {() => calc.state === 'ready' && (
          <div class="profile-list">
            {calc.data.profiles.map((p) => (
              <div key={p.id} class={`profile${p.id === calc.data.active ? ' is-active' : ''}`}>
                <div class="profile__row">
                  <div>
                    <strong>{p.name}</strong> {p.id === calc.data.active && <span class="badge badge--accent">In use</span>}
                    <div class="muted small">
                      {calc.data.house_systems.find((h) => h.key === (p.house_system ?? calc.data.defaults.house_system))?.label} houses{p.house_system ? '' : ' (default)'} · {p.zodiac === 'sidereal'
                        ? `Sidereal (${calc.data.ayanamsas.find((a) => a.key === p.ayanamsa)?.label})` : 'Tropical'} · {Object.values(p.aspects).filter((a) => a.on).length} aspects
                    </div>
                  </div>
                  <div class="row-actions">
                    {p.id !== calc.data.active && <Button onClick={() => run(api(`/preferences/profiles/${p.id}/activate`, 'POST').then(() => window.dispatchEvent(new Event(PROFILE_CHANGED))))}>Use</Button>}
                    <Button onClick={() => setEditing(editing === p.id ? null : p.id)}>{editing === p.id ? 'Close' : 'Edit'}</Button>
                    {calc.data.profiles.length > 1 && (
                      <Button variant="danger" onClick={() => confirm(`Remove the profile "${p.name}"?`) && run(api(`/preferences/profiles/${p.id}`, 'DELETE'))}>Remove</Button>
                    )}
                  </div>
                </div>
                {editing === p.id && <ProfileEditor profile={p} calc={calc.data} onSaved={reload} />}
              </div>
            ))}
          </div>
        )}
      </Loading>
    </section>
  );
}

function ProfileEditor({ profile, calc, onSaved }: { profile: Profile; calc: Calculation; onSaved: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const save = (change: Record<string, unknown>) => {
    setError(null);
    api(`/preferences/profiles/${profile.id}`, 'PATCH', change).then(onSaved).catch((e: unknown) => setError(describe(e)));
  };
  return (
    <div class="profile__editor">
      {error && <Notice tone="error">{error}</Notice>}
      <div class="form-grid form-grid--3">
        <label class="field">
          <span>Name</span>
          <input value={profile.name} onChange={(e) => save({ name: e.currentTarget.value })} />
        </label>
        <Select label="House system" value={profile.house_system ?? ''} onValue={(v) => save({ house_system: v })}
                options={[
                  ['', `My default (${calc.house_systems.find((h) => h.key === calc.defaults.house_system)?.label ?? calc.defaults.house_system})`],
                  ...calc.house_systems.map((h): [string, string] => [h.key, h.label]),
                ]} />
        <Select label="Zodiac" value={profile.zodiac} onValue={(v) => save({ zodiac: v })}
                options={[['tropical', 'Tropical'], ['sidereal', calc.sidereal_supported ? 'Sidereal' : plainWording() ? 'Sidereal (coming)' : 'Sidereal (needs ephemeralREST support)']]} />
      </div>
      {profile.zodiac === 'sidereal' && (
        <>
          <Select label="Ayanamsa" value={profile.ayanamsa} onValue={(v) => save({ ayanamsa: v })}
                  options={calc.ayanamsas.map((a): [string, string] => [a.key, a.label])} />
          {!calc.sidereal_supported && <p class="muted small">Saved for when {plainWording() ? 'it\'s available' : 'ephemeralREST supports it'}. Charts stay tropical until then.</p>}
        </>
      )}
      <label class="field field--narrow">
        <span>Largest orb for transits, progressions and directions</span>
        <span class="with-unit"><input type="number" min={0.1} max={5} step={0.1} value={profile.moving_orb} class="orb-input"
               onChange={(e) => save({ moving_orb: Number(e.currentTarget.value) })} />°</span>
        <small class="muted">Each aspect's own orb is used when it's smaller.</small>
      </label>
      <Select label="Part of Fortune" value={profile.lot_formula ?? 'day'} onValue={(v) => save({ lot_formula: v as 'day' | 'sect' })}
              options={[['day', 'Same day and night (Asc + Moon − Sun)'], ['sect', 'Reverse at night (traditional)']]} />
      <p class="muted small">The Hellenistic chart always reverses it at night. The other lots always do.</p>
      <table class="table table--compact aspect-settings">
        <thead><tr><th>Aspect</th><th>Angle</th><th>On</th><th>Orb</th></tr></thead>
        <tbody>
          {calc.aspects.map((a) => {
            const setting = profile.aspects[a.key] ?? { on: false, orb: a.default_orb };
            return (
              <tr key={a.key}>
                <td><span class={`glyph aspect-name--${a.kind}`} style={{ color: `var(--t-aspect-${a.key})` }}>{textGlyph(a.glyph)}</span> {a.name}{a.major ? '' : <span class="muted small"> minor</span>}</td>
                <td class="num">{a.angle}°</td>
                <td><input type="checkbox" checked={setting.on} aria-label={`${a.name} on`}
                           onChange={(e) => save({ aspects: { [a.key]: { on: e.currentTarget.checked } } })} /></td>
                <td>
                  <input type="number" min={0} max={15} step={0.5} value={setting.orb} class="orb-input" aria-label={`${a.name} orb`}
                         onChange={(e) => save({ aspects: { [a.key]: { orb: Number(e.currentTarget.value) } } })} />°
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
