/**
 * AstrologyStudio ·
 * web/src/pages/Account.tsx
 *
 * Your account:
 *
 * your password (or ephemeralREST sign-in), your ephemeralREST key, and downloading or deleting
 * your data.
 *
 * Copyright (c) 2026 Gavin Melhuish
 * MIT License; see LICENSE in the project root.
 * SPDX-License-Identifier: MIT
 */

import { useState } from 'preact/hooks';
import { api, type KeyStatus } from '../api';
import { useSession } from '../session';
import { Button, Checkbox, describe, Field, formatDate, Loading, Notice, PageHeader, useLoad, useSubmit } from '../ui';
import { plainWording } from '../hosted';

export function Account() {
  const { session } = useSession();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [done, setDone] = useState(false);
  const { busy, error, onSubmit } = useSubmit(async () => {
    setDone(false);
    await api('/auth/password', 'POST', { current_password: current, new_password: next });
    setCurrent('');
    setNext('');
    setDone(true);
  });

  return (
    <>
      <PageHeader title="Your account" intro={`Logged in as ${session.user.email}.`} />
      {!plainWording() && <EphemeralKey />}
      {session.user.signs_in_with === 'ephemeral' ? (
        <section class="card form-card">
          <h2>Password</h2>
          <p class="muted">
            {plainWording()
              ? 'Your password is kept with your account on the sign-in site, the one the emailed links took you to. Change it there, or use its "Forgot password".'
              : <>You log in with your ephemeralREST account, so your password is kept by ephemeralREST. Change it there
                (or use "Forgot password" on its site); then use the new one here. Your key is renewed each time you log in.</>}
          </p>
        </section>
      ) : (
      <form class="card form-card" onSubmit={onSubmit}>
        <h2>Change password</h2>
        {error && <Notice tone="error">{error}</Notice>}
        {done && <Notice tone="success">Password changed. You've been logged out on your other devices.</Notice>}
        <Field
          label="Current password"
          type="password"
          value={current}
          onValue={setCurrent}
          autoComplete="current-password"
          required
        />
        <Field
          label="New password"
          type="password"
          value={next}
          onValue={setNext}
          autoComplete="new-password"
          hint="At least 10 characters."
          required
        />
        <div class="actions">
          <Button type="submit" variant="primary" busy={busy}>Change password</Button>
        </div>
      </form>
      )}
      <YourData />
      {!session.user.is_owner && <DeleteAccount ephemeral={session.user.signs_in_with === 'ephemeral'} email={session.user.email} />}
    </>
  );
}

/** A copy of everything kept here for you, as one file. */
function YourData() {
  return (
    <section class="card form-card">
      <h2>Your data</h2>
      <p class="muted">
        Download a copy of everything AstrologyStudio keeps for you: your chart list with birth details, notes, folders,
        ratings and tags, and all your settings, themes, layouts and presets. It's one JSON file.
      </p>
      <div class="actions"><a class="btn" href="/api/v1/account/export" download>Download my data</a></div>
    </section>
  );
}

/** Delete your own account, after confirming with your password (or your email, if you log in
 * through ephemeralREST). Optionally take your charts off your chart list too. */
function DeleteAccount({ ephemeral, email }: { ephemeral: boolean; email: string }) {
  const [confirmText, setConfirmText] = useState('');
  const [removeCharts, setRemoveCharts] = useState(false);
  const { busy, error, onSubmit } = useSubmit(async () => {
    if (!confirm('Delete your account now? This can\'t be undone.')) return;
    await api('/account/delete', 'POST', ephemeral
      ? { email: confirmText, remove_charts: removeCharts }
      : { password: confirmText, remove_charts: removeCharts });
    window.location.href = '/?deleted=1';
  });
  return (
    <form class="card form-card card--danger" onSubmit={onSubmit}>
      <h2>Delete your account</h2>
      <p class="muted">
        Removes your account and everything kept here for you: settings, themes, layouts, presets, notes and folders.
        You'll be logged out everywhere. Download your data first if you want a copy.
      </p>
      {error && <Notice tone="error">{error}</Notice>}
      <Checkbox label="Also delete my charts" checked={removeCharts} onChecked={setRemoveCharts}
                hint={plainWording() ? 'Otherwise they\'re kept, in case you come back.' : 'Takes every chart off your ephemeralREST chart list. Otherwise they stay there, for other apps you use them in or for an account here later.'} />
      {ephemeral ? (
        <Field label="Type your email address to confirm" value={confirmText} onValue={setConfirmText} placeholder={email} required />
      ) : (
        <Field label="Your password, to confirm" type="password" value={confirmText} onValue={setConfirmText} autoComplete="current-password" required />
      )}
      <div class="actions"><Button type="submit" variant="danger" busy={busy} disabled={!confirmText}>Delete my account</Button></div>
    </form>
  );
}

function EphemeralKey() {
  const [status, reload] = useLoad(() => api<KeyStatus>('/account/ephemeral-key'));
  return (
    <section class="card form-card">
      <h2>Your ephemeralREST key</h2>
      <Loading result={status}>
        {() => status.state === 'ready' && <ApiKeyForm status={status.data} onSaved={reload} />}
      </Loading>
    </section>
  );
}

/** Enter, replace or forget your own ephemeralREST key. The key is checked before it's saved. */
export function ApiKeyForm({ status, onSaved, disabled }: { status: KeyStatus; onSaved: () => void; disabled?: boolean }) {
  const [key, setKey] = useState('');
  const [forgetError, setForgetError] = useState<string | null>(null);
  const { busy, error, onSubmit } = useSubmit(async () => {
    await api('/account/ephemeral-key', 'PUT', { api_key: key });
    setKey('');
    onSaved();
  });
  const forget = () => {
    if (!confirm('Forget your key? You won\'t be able to open or calculate charts until you add one again.')) return;
    api('/account/ephemeral-key', 'DELETE').then(onSaved).catch((e: unknown) => setForgetError(describe(e)));
  };
  return (
    <form class="form" onSubmit={onSubmit}>
      {status.configured && (
        <dl class="facts">
          <div><dt>Key</dt><dd><code>{status.prefix}…</code></dd></div>
          {status.identity?.name && <div><dt>Account</dt><dd>{status.identity.name} ({status.identity.identifier})</dd></div>}
          <div><dt>Checked</dt><dd>{formatDate(status.checked_at ?? null)}</dd></div>
        </dl>
      )}
      {error && <Notice tone="error">{error}</Notice>}
      {forgetError && <Notice tone="error">{forgetError}</Notice>}
      <Field label={status.configured ? 'Replace with a new key' : 'API key'} type="password" value={key} onValue={setKey}
             autoComplete="off" placeholder="eph_…"
             hint="From the email ephemeralREST sent when you set your password. It's stored encrypted and never shown again."
             required />
      <div class="actions">
        <Button type="submit" variant="primary" busy={busy} disabled={disabled}>Check and save</Button>
        {status.configured && <Button variant="danger" onClick={forget}>Forget key</Button>}
      </div>
    </form>
  );
}
