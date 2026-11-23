/**
 * AstrologyStudio ·
 * web/src/pages/Settings.tsx
 *
 * Install settings (the ephemeralREST address), your defaults, and Your view (features and bodies).
 *
 * Copyright (c) 2026 Gavin Melhuish
 * MIT License; see LICENSE in the project root.
 * SPDX-License-Identifier: MIT
 */

import { useEffect, useState } from 'preact/hooks';
import { api, type AuthStatus, type Calculation, type Connection } from '../api';
import { useSession } from '../session';
import { Link } from '../router';
import { Button, Checkbox, describe, Field, Loading, Notice, PageHeader, Select, useLoad, useSubmit } from '../ui';
import { Profiles } from './Profiles';
import { PROFILE_CHANGED, useAppearance } from '../appearance';
import { PlaceField } from './ChartForm';
import { saveDefaults, useDefaults } from '../defaults';
import { plainWording } from '../hosted';

export function SettingsPage() {
  const { session } = useSession();
  const [connection, reload] = useLoad(() => api<Connection>('/connection'));
  const [profilesKey, setProfilesKey] = useState(0);
  return (
    <>
      <PageHeader title="Settings" />
      <div class="columns">
        {!plainWording() && <section class="card form-card">
          <h2>ephemeralREST</h2>
          <Loading result={connection}>
            {() =>
              connection.state === 'ready' &&
              (session.user.is_owner ? (
                <ConnectionForm current={connection.data} onSaved={reload} />
              ) : (
                <ConnectionFacts current={connection.data} />
              ))
            }
          </Loading>
        </section>}
        <DefaultsCard onSaved={() => setProfilesKey((k) => k + 1)} />
        {session.user.is_owner && <Registration />}
        {session.user.is_owner && <SiteThemes />}
        <section class="card form-card">
          <h2>Your view</h2>
          <p class="muted">Which features, bodies and points you see, your theme, and how charts and dials are drawn.</p>
          <div class="actions"><Link href="/view" class="btn">Open Your view</Link></div>
        </section>
      </div>
      <Profiles key={profilesKey} />
    </>
  );
}

/** Your default house system (for profiles without their own) and your default place. */
function DefaultsCard({ onSaved }: { onSaved: () => void }) {
  const defaults = useDefaults();
  const [calc] = useLoad(() => api<Calculation>('/preferences/calculation'));
  const [system, setSystem] = useState('');
  const [place, setPlace] = useState('');
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (defaults) { setSystem(defaults.house_system); setPlace(defaults.place); }
  }, [defaults?.house_system, defaults?.place]);
  const { busy, error, onSubmit } = useSubmit(async () => {
    setSaved(false);
    await saveDefaults({ house_system: system, place: place.trim() });
    setSaved(true);
    window.dispatchEvent(new Event(PROFILE_CHANGED)); // charts on screen redraw their houses
    onSaved();
  });
  const systems = calc.state === 'ready' ? calc.data.house_systems : [];
  return (
    <section class="card form-card">
      <h2>Defaults</h2>
      <form class="form" onSubmit={onSubmit}>
        {error && <Notice tone="error">{error}</Notice>}
        {saved && <Notice tone="success">Saved.</Notice>}
        <Select label="Default house system" value={system} onValue={(v) => { setSystem(v); setSaved(false); }} id="field-default-house-system"
                options={systems.map((h): [string, string] => [h.key, h.label])}
                hint="Used by calculation profiles set to “My default”, and by charts set to Default." />
        <PlaceField value={place} onValue={(v) => { setPlace(v); setSaved(false); }} id="default-place" label="Default location" required={false}
                    hint="Where you usually are. New charts start with it, and transits and returns are worked out for it. Leave empty for none." />
        <div class="actions"><Button type="submit" variant="primary" busy={busy}>Save defaults</Button></div>
      </form>
    </section>
  );
}

function ConnectionFacts({ current }: { current: Connection }) {
  return (
    <dl class="facts">
      <div><dt>Address</dt><dd>{current.url ?? 'Not set'}</dd></div>
      <div><dt>Status</dt><dd>{current.reachable ? 'Answering' : current.problem ?? 'Not connected'}</dd></div>
    </dl>
  );
}

export function ConnectionForm({ current, onSaved }: { current: Connection; onSaved: () => void }) {
  const [url, setUrl] = useState(current.url ?? '');
  const [saved, setSaved] = useState(false);
  const { busy, error, onSubmit } = useSubmit(async () => {
    setSaved(false);
    await api('/connection', 'PUT', { url });
    setSaved(true);
    onSaved();
  });
  return (
    <form class="form" onSubmit={onSubmit}>
      {current.url && !current.reachable && <Notice tone="error">{current.problem ?? "ephemeralREST isn't answering."}</Notice>}
      {error && <Notice tone="error">{error}</Notice>}
      {saved && <Notice tone="success">Connected.</Notice>}
      <Field label="ephemeralREST address" type="url" value={url} onValue={setUrl} placeholder="https://api.example.com"
             hint="Used by everyone on this install. It's checked before it's saved." required />
      <div class="actions"><Button type="submit" variant="primary" busy={busy}>Save and check</Button></div>
    </form>
  );
}

/** Whether new people can create their own accounts (through ephemeralREST) from the login page. */
function Registration() {
  const [status, reload] = useLoad(() => api<AuthStatus>('/auth/status'));
  const [error, setError] = useState<string | null>(null);
  const change = (open: boolean) => {
    setError(null);
    api('/auth/registration', 'PUT', { open }).then(reload).catch((e: unknown) => setError(describe(e)));
  };
  return (
    <section class="card form-card">
      <h2>New accounts</h2>
      <p class="muted">
        Let people create their own accounts from the login page. Each account is made with ephemeralREST:
        they verify their email, set a password there, then log in here with an emailed code.
      </p>
      {error && <Notice tone="error">{error}</Notice>}
      <Loading result={status}>
        {() => status.state === 'ready' && (
          <Checkbox label="Allow new people to create accounts" checked={status.data.registration_open} onChecked={change} />
        )}
      </Loading>
    </section>
  );
}

/** Themes everyone on this install can choose, and the theme new accounts start with (owner). */
function SiteThemes() {
  const { view, withdrawTheme, setSiteDefault } = useAppearance();
  const [error, setError] = useState<string | null>(null);
  const run = (p: Promise<unknown>) => { setError(null); p.catch((e: unknown) => setError(describe(e))); };
  const site = view.themes.filter((t) => t.kind === 'site');
  const choices = view.themes.filter((t) => t.kind === 'builtin' || t.kind === 'site');
  return (
    <section class="card form-card">
      <h2>Site themes</h2>
      <p class="muted">Themes you share are offered to everyone here. To share one of yours, choose “Share with everyone” on it in Your view → Appearance.</p>
      {error && <Notice tone="error">{error}</Notice>}
      <label class="field">
        <span>Theme for new accounts</span>
        <select value={view.site_default} onChange={(e) => run(setSiteDefault(e.currentTarget.value))}>
          {choices.map((t) => <option key={t.id} value={t.id}>{t.name}{t.kind === 'site' ? ' (shared)' : ''}</option>)}
        </select>
        <small class="muted">People who have already chosen a theme keep theirs.</small>
      </label>
      {site.length > 0 ? (
        <ul class="plain-list">
          {site.map((t) => (
            <li key={t.id} class="plain-list__row">
              <span>{t.name}</span>
              <button type="button" class="link-button link-button--danger"
                      onClick={() => confirm(`Stop sharing “${t.name}”? Anyone using it goes back to the theme for new accounts.`) && run(withdrawTheme(t.id))}>
                Stop sharing
              </button>
            </li>
          ))}
        </ul>
      ) : <p class="muted small">No themes shared yet.</p>}
    </section>
  );
}
