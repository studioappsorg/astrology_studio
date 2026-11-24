/**
 * AstrologyStudio ·
 * web/src/pages/Settings.tsx
 *
 * Settings, in sections: Defaults, Calculation (profiles), ephemeralREST, and for the owner Business
 * (details and logo), Email (SMTP), New accounts and Site themes. ?section=email opens on one.
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
import { EmailSettings } from './EmailSettings';
import { LogoSettings } from './LogoSettings';
import { PROFILE_CHANGED, useAppearance } from '../appearance';
import { oneOf } from '../prefs';
import { PlaceField } from './ChartForm';
import { saveDefaults, useDefaults } from '../defaults';
import { plainWording } from '../hosted';

type Section = 'defaults' | 'calculation' | 'ephemeral' | 'business' | 'email' | 'accounts' | 'themes';
const SECTIONS: Array<[Section, string, boolean]> = [
  // [key, label, owner only]
  ['defaults', 'Defaults', false],
  ['calculation', 'Calculation', false],
  ['ephemeral', 'ephemeralREST', false],
  ['business', 'Business', true],
  ['email', 'Email', true],
  ['accounts', 'New accounts', true],
  ['themes', 'Site themes', true],
];
const isSection = oneOf<Section>(...SECTIONS.map(([key]) => key));

/** The section in the address (?section=email), so a reload or a link opens on it. */
function sectionFromAddress(): Section | null {
  const wanted = new URLSearchParams(location.search).get('section');
  return isSection(wanted) ? wanted : null;
}

export function SettingsPage() {
  const { session } = useSession();
  const owner = session.user.is_owner;
  const sections = SECTIONS.filter(([key, , ownerOnly]) => (owner || !ownerOnly) && !(key === 'ephemeral' && plainWording()));
  const [chosen, setChosen] = useState<Section>(() => sectionFromAddress() ?? 'defaults');
  const section = sections.some(([key]) => key === chosen) ? chosen : 'defaults';
  const choose = (next: Section) => {
    setChosen(next);
    const url = new URL(location.href);
    if (next === 'defaults') url.searchParams.delete('section');
    else url.searchParams.set('section', next);
    history.replaceState(null, '', url.pathname + url.search);
  };
  return (
    <>
      <PageHeader title="Settings" />
      <div class="tabs" role="tablist" aria-label="Settings">
        {sections.map(([key, label]) => (
          <button key={key} type="button" role="tab" aria-selected={section === key} class={section === key ? 'is-active' : ''}
                  onClick={() => choose(key)}>{label}</button>
        ))}
      </div>
      <div class="settings-section" role="tabpanel" aria-label={sections.find(([key]) => key === section)?.[1]}>
        {section === 'defaults' && (
          <>
            <DefaultsCard />
            <section class="card form-card">
              <h2>My View</h2>
              <p class="muted">Which features, bodies and points you see, your theme, and how charts and dials are drawn.</p>
              <div class="actions"><Link href="/view" class="btn">Open My View</Link></div>
            </section>
          </>
        )}
        {section === 'calculation' && <Profiles />}
        {section === 'ephemeral' && <EphemeralCard owner={owner} />}
        {section === 'business' && <LogoSettings />}
        {section === 'email' && <EmailSettings />}
        {section === 'accounts' && <Registration />}
        {section === 'themes' && <SiteThemes />}
      </div>
    </>
  );
}

/** The ephemeralREST address everyone here uses: the owner can change it, everyone else sees it. */
function EphemeralCard({ owner }: { owner: boolean }) {
  const [connection, reload] = useLoad(() => api<Connection>('/connection'));
  return (
    <section class="card form-card">
      <h2>ephemeralREST</h2>
      <p class="muted">The calculation service that stores your charts and works out every position.</p>
      <Loading result={connection}>
        {() => connection.state === 'ready' && (owner
          ? <ConnectionForm current={connection.data} onSaved={reload} />
          : <ConnectionFacts current={connection.data} />)}
      </Loading>
    </section>
  );
}

/** Your default house system (for profiles without their own) and your default place. */
function DefaultsCard() {
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
      <p class="muted">Themes you share are offered to everyone here. To share one of yours, choose “Share with everyone” on it in My View → Appearance.</p>
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
