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
import { api, type AuthStatus, type Calculation, type Connection, type Limits, type SiteKeyStatus } from '../api';
import { emptyLimits, LimitFields } from '../components/Activity';
import { useSession } from '../session';
import { Link } from '../router';
import { Button, Checkbox, describe, Field, Loading, Notice, PageHeader, Select, useLoad, useSubmit } from '../ui';
import { Profiles } from './Profiles';
import { EmailSettings } from './EmailSettings';
import { EmailDelivery, EmailDesigns } from './EmailDesigns';
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
        {section === 'email' && <><EmailSettings /><EmailDelivery /><EmailDesigns /></>}
        {section === 'accounts' && <><Registration /><DefaultLimits /></>}
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
          ? <><ConnectionForm current={connection.data} onSaved={reload} /><SiteKey /></>
          : <ConnectionFacts current={connection.data} />)}
      </Loading>
    </section>
  );
}

/** The site key: an ephemeralREST domain key for this site's address, so sign-up and password
 * emails link back to this site's own pages instead of ephemeralREST's. */
function SiteKey() {
  const [status, reload] = useLoad(() => api<SiteKeyStatus>('/connection/site-key'));
  const [key, setKey] = useState('');
  const [forgetError, setForgetError] = useState<string | null>(null);
  const { busy, error, onSubmit } = useSubmit(async () => {
    await api('/connection/site-key', 'PUT', { api_key: key });
    setKey('');
    reload();
  });
  const forget = () => {
    if (!confirm('Forget the site key? Sign-up emails will link to ephemeralREST\'s pages again.')) return;
    api('/connection/site-key', 'DELETE').then(reload).catch((e: unknown) => setForgetError(describe(e)));
  };
  return (
    <form class="form" onSubmit={onSubmit}>
      <h3>Site key</h3>
      <p class="muted">
        A domain key for this site's address, from ephemeralREST. With one, people sign up and reset their password on
        this site's own pages, and the emailed links come back here. Without one, those links go to ephemeralREST's site.
      </p>
      <Loading result={status}>
        {() => status.state === 'ready' && (
          <>
            {status.data.configured && (
              <dl class="facts">
                <div><dt>Key</dt><dd><code>{status.data.prefix}…</code> for {status.data.domain}</dd></div>
                <div><dt>Emailed links</dt><dd>{status.data.links_here
                  ? `Come back to ${status.data.origin}`
                  : `Go to ephemeralREST's pages${status.data.reason ? `: ${status.data.reason}` : ''}`}</dd></div>
              </dl>
            )}
            {error && <Notice tone="error">{error}</Notice>}
            {forgetError && <Notice tone="error">{forgetError}</Notice>}
            <Field label={status.data.configured ? 'Replace the site key' : 'Site key'} type="password" value={key} onValue={setKey}
                   autoComplete="off" placeholder="eph_…" id="field-site-key" required
                   hint={`It must be for ${new URL(status.data.origin).hostname} (or the domain it's part of). Saving it registers this address with the key.`} />
            <div class="actions">
              <Button type="submit" variant="primary" busy={busy}>Check and save</Button>
              {status.data.configured && <Button variant="danger" onClick={forget}>Forget site key</Button>}
            </div>
          </>
        )}
      </Loading>
    </form>
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
        Let people create their own accounts from the login page. Each account is made with ephemeralREST.
        With a site key (in the ephemeralREST section) it all happens on this site: one emailed link, choose a
        password, done. Without one, they verify their email and set a password on ephemeralREST's site, then log in
        here with an emailed code.
      </p>
      {error && <Notice tone="error">{error}</Notice>}
      <Loading result={status}>
        {() => status.state === 'ready' && (
          <>
            <Checkbox label="Allow new people to create accounts" checked={status.data.registration_open} onChecked={change} />
            {status.data.registration_open && (
              <p class="muted small">Sign-up emails link to {status.data.signup_flow === 'here' ? 'this site' : "ephemeralREST's site"}.</p>
            )}
          </>
        )}
      </Loading>
    </section>
  );
}

/** Limits for everyone without their own, and the time zone hours and days are counted in. */
function DefaultLimits() {
  const [current] = useLoad(() => api<{ limits: Limits; time_zone: string }>('/settings/default-limits'));
  const [values, setValues] = useState<Limits>(emptyLimits());
  const [zone, setZone] = useState('');
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (current.state === 'ready') { setValues(current.data.limits); setZone(current.data.time_zone); }
  }, [current.state]);
  const { busy, error, onSubmit } = useSubmit(async () => {
    setSaved(false);
    await api('/settings/default-limits', 'PUT', { limits: values, time_zone: zone.trim() || 'UTC' });
    setSaved(true);
  });
  return (
    <section class="card form-card">
      <h2>Limits</h2>
      <p class="muted">
        How many calls this site may send to ephemeralREST for each person, for everyone without limits of their own
        (set those in Users). Charts already loaded cost nothing, and you're never limited. Leave a box empty for no limit.
      </p>
      <form class="form" onSubmit={onSubmit}>
        {error && <Notice tone="error">{error}</Notice>}
        {saved && <Notice tone="success">Saved.</Notice>}
        <LimitFields value={values} onValue={(v) => { setValues(v); setSaved(false); }} idPrefix="default-limit" />
        <Field label="Time zone" value={zone} onValue={(v) => { setZone(v); setSaved(false); }} id="limits-time-zone"
               placeholder="UTC" hint="Where hours, days, weeks (from Monday) and months start, such as Australia/Perth." />
        <div class="actions"><Button type="submit" variant="primary" busy={busy}>Save limits</Button></div>
      </form>
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
