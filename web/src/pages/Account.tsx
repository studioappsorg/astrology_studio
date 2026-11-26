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
import { api, type KeyStatus, type SignupSent, type Usage } from '../api';
import { Activity, UsageLines } from '../components/Activity';
import { KeyActions } from '../components/KeyActions';
import { Modal, ModalBody, ModalFooter } from '../components/Modal';
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
      {plainWording() ? <BringCharts /> : <EphemeralKey />}
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
      {!session.user.is_owner && <YourUsage />}
      <section class="card">
        <h2>Your activity</h2>
        <p class="muted">Logins and changes to your account, newest first. Something you don't recognise? Change your password.</p>
        <Activity path="/account/activity" />
      </section>
      <YourData />
      {!session.user.is_owner && <DeleteAccount ephemeral={session.user.signs_in_with === 'ephemeral'} email={session.user.email} />}
    </>
  );
}

/** How much of your limits you've used (only shown when there are some). */
function YourUsage() {
  const [usage] = useLoad(() => api<Usage>('/account/usage'));
  if (usage.state !== 'ready' || Object.values(usage.data.periods).every((p) => p.limit === null)) return null;
  return (
    <section class="card form-card">
      <h2>Your limits</h2>
      <p class="muted">How many new calculations this site makes for you. Looking at charts you've already opened doesn't count.</p>
      <UsageLines usage={usage.data} />
    </section>
  );
}

/** A copy of everything kept here for you, as one file. */
function YourData() {
  return (
    <section class="card form-card">
      <h2>Your data</h2>
      <p class="muted">
        Download a copy of everything AstrologyStudio keeps for you: your chart list with birth details, notes, folders,
        ratings and tags, your activity, and all your settings, themes, layouts and presets. It's one JSON file.
      </p>
      <div class="actions"><a class="btn" href="/api/v1/account/export" download>Download my data</a></div>
      <Organisation />
    </section>
  );
}

/** Bring folders, tags, ratings and notes across from another site's "Download my data" file. */
function Organisation() {
  const [result, setResult] = useState<{ imported: number; skipped: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pick = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setResult(null);
    setBusy(true);
    try {
      const data: unknown = JSON.parse(await file.text());
      setResult(await api('/account/organisation', 'POST', data));
    } catch (e) {
      setError(e instanceof SyntaxError ? "That file isn't an AstrologyStudio download." : describe(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <h3>From another site</h3>
      <p class="muted">
        Moved here from another AstrologyStudio site? Choose the file you downloaded there to bring across your
        folders, tags, ratings and notes, for the charts you have here. Running it again doesn't make copies.
      </p>
      {error && <Notice tone="error">{error}</Notice>}
      {result && <Notice tone="success">
        Brought across {result.imported} chart{result.imported === 1 ? "'s" : "s'"} details.
        {result.skipped > 0 && ` ${result.skipped} weren't for charts you have here, so they were left out.`}
      </Notice>}
      <label class="btn" aria-busy={busy}>
        Choose a downloaded file
        <input type="file" accept="application/json,.json" class="visually-hidden" disabled={busy}
               onChange={(e) => { const input = e.currentTarget; void pick(input.files?.[0]); input.value = ''; }} />
      </label>
    </>
  );
}

/** For a hosted site, where ephemeralREST stays out of sight: log in with the account from the
 * other site, and its key (and so its charts) come here. */
function BringCharts() {
  const [status, reload] = useLoad(() => api<KeyStatus>('/account/ephemeral-key'));
  return (
    <section class="card form-card">
      <h2>Bring your charts from another site</h2>
      <p class="muted">Used AstrologyStudio on another site that works with this one? Log in with that account here and
        its charts come with it.</p>
      <Loading result={status}>{() => status.state === 'ready' && <KeyFromElsewhere onSaved={reload} />}</Loading>
      {status.state === 'ready' && status.data.configured && (
        <>
          <h3>Your access key</h3>
          <p class="muted">You only need this to use your charts on another site or in another app.</p>
          <KeyActions onReplaced={reload} />
        </>
      )}
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

/** A key that would hide some of your charts waits for an answer: add them to its list, leave
 * them where they are, or keep the key you have. */
function ChartsChoice({ missing, onDone }: { missing: number; onDone: (result: KeyStatus) => void }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const answer = (choice: 'add' | 'leave' | 'cancel') => {
    setBusy(true);
    setError(null);
    api<KeyStatus>('/account/ephemeral-key/pending', 'POST', { choice })
      .then(onDone)
      .catch((e: unknown) => { setError(describe(e)); setBusy(false); });
  };
  const charts = missing === 1 ? '1 of your charts isn\'t' : `${missing} of your charts aren't`;
  return (
    <Modal title="Your charts" onClose={() => answer('cancel')}>
      <ModalBody>
        <p>{charts} on this key's chart list. If you switch without adding them, they won't show here any more
          (they're not deleted: the old key still has them).</p>
        {error && <Notice tone="error">{error}</Notice>}
      </ModalBody>
      <ModalFooter>
        <Button onClick={() => answer('cancel')} disabled={busy}>Keep my current key</Button>
        <Button onClick={() => answer('leave')} disabled={busy}>Switch, leave them</Button>
        <Button variant="primary" onClick={() => answer('add')} busy={busy}>Switch and add them</Button>
      </ModalFooter>
    </Modal>
  );
}

/** Saving a key can come back "choose": show the question, then carry on. */
function useKeyOutcome(onSaved: () => void) {
  const [missing, setMissing] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const handle = (result: KeyStatus) => {
    if (result.status === 'choose') { setMissing(result.missing ?? 0); return; }
    setMissing(null);
    if (result.status === 'cancelled') setMessage('Kept your current key.');
    else setMessage(result.added ? `Key saved, and ${result.added} chart${result.added === 1 ? '' : 's'} added to its list.` : 'Key saved.');
    onSaved();
  };
  const dialog = missing !== null && <ChartsChoice missing={missing} onDone={handle} />;
  return { handle, dialog, message, clear: () => setMessage(null) };
}

/** Enter, replace or forget your own ephemeralREST key. The key is checked before it's saved. */
export function ApiKeyForm({ status, onSaved, disabled, inSetup }: {
  status: KeyStatus; onSaved: () => void; disabled?: boolean; inSetup?: boolean;
}) {
  const [key, setKey] = useState('');
  const [forgetError, setForgetError] = useState<string | null>(null);
  const outcome = useKeyOutcome(onSaved);
  const { busy, error, onSubmit } = useSubmit(async () => {
    outcome.clear();
    outcome.handle(await api<KeyStatus>('/account/ephemeral-key', 'PUT', { api_key: key }));
    setKey('');
  });
  const forget = () => {
    if (!confirm('Forget your key? You won\'t be able to open or calculate charts until you add one again.')) return;
    api('/account/ephemeral-key', 'DELETE').then(onSaved).catch((e: unknown) => setForgetError(describe(e)));
  };
  return (
    <>
    <form class="form" onSubmit={onSubmit}>
      {outcome.dialog}
      {outcome.message && <Notice tone="success">{outcome.message}</Notice>}
      {status.configured && (
        <dl class="facts">
          <div><dt>Key</dt><dd><code>{status.prefix}…</code></dd></div>
          {status.identity?.name && <div><dt>Account</dt><dd>{status.identity.name} ({status.identity.identifier})</dd></div>}
          <div><dt>Checked</dt><dd>{formatDate(status.checked_at ?? null)}</dd></div>
        </dl>
      )}
      {error && <Notice tone="error">{error}</Notice>}
      {forgetError && <Notice tone="error">{forgetError}</Notice>}
      <Field label={status.configured ? 'Use a different key' : 'API key'} type="password" value={key} onValue={setKey}
             autoComplete="off" placeholder="eph_…"
             hint="From the email ephemeralREST sent when you set your password. It's stored encrypted and never shown again."
             required />
      <div class="actions">
        <Button type="submit" variant="primary" busy={busy} disabled={disabled}>Check and save</Button>
        {status.configured && <Button variant="danger" onClick={forget}>Forget key</Button>}
      </div>
    </form>
    {status.configured && !inSetup && <KeyActions onReplaced={onSaved} />}
    <details class="disclosure">
      <summary>Use my key from another site</summary>
      <p class="muted">Log in with the ephemeralREST account you used there; its key, and the charts on it, come here.</p>
      <KeyFromElsewhere onSaved={onSaved} disabled={disabled} />
    </details>
    {!status.configured && (
      <details class="disclosure">
        <summary>I don't have a key</summary>
        <NoKey disabled={disabled} />
      </details>
    )}
    </>
  );
}

/** Log in to an ephemeralREST account (email, password, then the emailed code) to fetch its key. */
function KeyFromElsewhere({ onSaved, disabled }: { onSaved: () => void; disabled?: boolean }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'login' | 'code'>('login');
  const outcome = useKeyOutcome(() => { setStep('login'); setPassword(''); setCode(''); onSaved(); });
  const { busy, error, onSubmit } = useSubmit(async () => {
    outcome.clear();
    if (step === 'login') {
      const result = await api<KeyStatus | { two_factor: true }>('/account/ephemeral-key/login', 'POST', { email, password });
      if ('two_factor' in result) setStep('code');
      else outcome.handle(result);
    } else {
      outcome.handle(await api<KeyStatus>('/account/ephemeral-key/login/code', 'POST', { email, code }));
    }
  });
  return (
    <form class="form" onSubmit={onSubmit}>
      {outcome.dialog}
      {outcome.message && <Notice tone="success">{outcome.message}</Notice>}
      {error && <Notice tone="error">{error}</Notice>}
      {step === 'login' ? (
        <>
          <Field label="Email" type="email" value={email} onValue={setEmail} autoComplete="off" required id="elsewhere-email" />
          <Field label="Password" type="password" value={password} onValue={setPassword} autoComplete="off" required id="elsewhere-password" />
        </>
      ) : (
        <Field label="Code" value={code} onValue={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))} id="elsewhere-code"
               inputMode="numeric" autoComplete="one-time-code" placeholder="123456" required
               hint={`We've emailed a 6-digit code to ${email}.`} />
      )}
      <div class="actions">
        <Button type="submit" variant="primary" busy={busy} disabled={disabled}>{step === 'login' ? 'Log in' : 'Get my key'}</Button>
        {step === 'code' && <Button onClick={() => setStep('login')}>Back</Button>}
      </div>
    </form>
  );
}

/** Ask ephemeralREST for an account; the key from it is saved here when the link is used. */
function NoKey({ disabled }: { disabled?: boolean }) {
  const { session } = useSession();
  const [name, setName] = useState(session.user.name ?? '');
  const [email, setEmail] = useState(session.user.email);
  const [sent, setSent] = useState<SignupSent | null>(null);
  const { busy, error, onSubmit } = useSubmit(async () => {
    setSent(await api<SignupSent>('/account/ephemeral-key/request', 'POST', { name, email }));
  });
  if (sent) {
    return sent.flow === 'here' ? (
      <Notice tone="success">We've emailed a link to <strong>{sent.email}</strong>. Open it (in any browser) and choose a
        password: your new key is saved here straight away. Reload this page afterwards.</Notice>
    ) : (
      <Notice tone="success">ephemeralREST has emailed <strong>{sent.email}</strong> a link to verify the address, then one to
        set a password. A third email brings your key: paste it above. (Or use "Use my key from another site" once the
        password is set.)</Notice>
    );
  }
  return (
    <form class="form" onSubmit={onSubmit}>
      <p class="muted">We'll make you an ephemeralREST account. It's free, and the same account works in other apps that use
        ephemeralREST.</p>
      {error && <Notice tone="error">{error}</Notice>}
      <Field label="Name" value={name} onValue={setName} autoComplete="name" required id="nokey-name" />
      <Field label="Email" type="email" value={email} onValue={setEmail} autoComplete="email" required id="nokey-email" />
      <div class="actions"><Button type="submit" variant="primary" busy={busy} disabled={disabled}>Create my account</Button></div>
    </form>
  );
}
