/**
 * AstrologyStudio ·
 * web/src/pages/Users.tsx
 *
 * People who can log in. Only the owner sees this page. Clicking someone opens their window:
 * allowed to log in or not, their limits and usage, their activity, and removing them.
 * Everyone's activity (with attempts against addresses that have no account) is below the list.
 *
 * Copyright (c) 2026 Gavin Melhuish
 * MIT License; see LICENSE in the project root.
 * SPDX-License-Identifier: MIT
 */

import { useEffect, useState } from 'preact/hooks';
import { api, type Limits, type ListedUser, type UserDetail } from '../api';
import { useSession } from '../session';
import { NotFound } from './NotFound';
import { Button, Checkbox, describe, Field, formatDate, Loading, Notice, PageHeader, useLoad, useSubmit } from '../ui';
import { Modal, ModalBody, ModalFooter } from '../components/Modal';
import { Activity, emptyLimits, LimitFields, UsageLines } from '../components/Activity';

export function Users() {
  const { session } = useSession();
  return session.user.is_owner ? <UserList /> : <NotFound />;
}

function UserList() {
  const { session } = useSession();
  const [users, reload] = useLoad(() => api<{ data: ListedUser[] }>('/users'));
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  return (
    <>
      <PageHeader
        title="Users"
        intro="People who can log in. Each person uses their own ephemeralREST key and sees their own charts. Click someone to manage them."
        actions={!adding && <Button variant="primary" onClick={() => setAdding(true)}>Add a person</Button>}
      />
      {adding && <AddUser onDone={() => { setAdding(false); reload(); }} onCancel={() => setAdding(false)} />}
      <Loading result={users}>
        {() =>
          users.state === 'ready' && (
            <table class="table table--clickable">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Last login</th>
                  <th aria-label="Status" />
                </tr>
              </thead>
              <tbody>
                {users.data.data.map((user) => (
                  <tr key={user.id} onClick={() => setOpen(user.id)} class={user.disabled ? 'is-disabled' : ''}>
                    <td><button type="button" class="link-button" onClick={(e) => { e.stopPropagation(); setOpen(user.id); }}>{user.name || '—'}</button></td>
                    <td>{user.email}{user.signs_in_with === 'ephemeral' && <span class="user-badge" title="Logs in with their ephemeralREST account">ephemeralREST</span>}</td>
                    <td>{formatDate(user.last_login_at)}</td>
                    <td class="table__actions">
                      {user.id === session.user.id ? <span class="muted small">You</span>
                        : user.disabled ? <span class="user-badge user-badge--off">Switched off</span> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        }
      </Loading>
      {open && <UserWindow userId={open} self={open === session.user.id} onClose={() => setOpen(null)} onChanged={reload} />}
      <section class="card">
        <h2>All activity</h2>
        <p class="muted">Everyone's logins and account changes, including attempts with addresses that have no account here.</p>
        <Activity path="/users/activity" everyone />
        <Retention />
      </section>
    </>
  );
}

/** One person: allowed to log in, limits, activity, remove. The owner's own window has no switch or limits. */
function UserWindow({ userId, self, onClose, onChanged }: {
  userId: string; self: boolean; onClose: () => void; onChanged: () => void;
}) {
  const [detail, reload] = useLoad(() => api<UserDetail>(`/users/${userId}`), [userId]);
  const [error, setError] = useState<string | null>(null);
  const [changes, setChanges] = useState(0);
  const changed = () => { reload(); onChanged(); setChanges((n) => n + 1); };
  const remove = async (user: UserDetail) => {
    if (!confirm(`Remove ${user.name || user.email}? They'll be logged out and can't log in again.`)) return;
    setError(null);
    try {
      await api(`/users/${user.id}`, 'DELETE');
      onChanged();
      onClose();
    } catch (e) {
      setError(describe(e));
    }
  };
  const user = detail.state === 'ready' ? detail.data : null;
  // Kept while it reloads after a change, so the window doesn't blink to another title.
  const [title, setTitle] = useState('Person');
  useEffect(() => { if (user) setTitle(user.name || user.email); }, [user?.name, user?.email]);
  return (
    <Modal title={title} onClose={onClose} wide>
      <ModalBody>
        {error && <Notice tone="error">{error}</Notice>}
        <Loading result={detail}>
          {() => user && (
            <>
              <dl class="facts">
                <div><dt>Email</dt><dd>{user.email}</dd></div>
                <div><dt>Logs in</dt><dd>{user.signs_in_with === 'ephemeral' ? 'With their ephemeralREST account' : 'With a password here'}</dd></div>
                <div><dt>Joined</dt><dd>{formatDate(user.created_at)}</dd></div>
                <div><dt>Last login</dt><dd>{formatDate(user.last_login_at)}</dd></div>
                <div><dt>Key</dt><dd>{user.key_prefix ? <code>{user.key_prefix}…</code> : 'None saved'}</dd></div>
              </dl>
              {!self && !user.is_owner && <LoginSwitch user={user} onSaved={changed} />}
              {!self && !user.is_owner && <UserLimits user={user} onSaved={changed} />}
              <h3>Activity</h3>
              <Activity key={changes} path={`/users/${user.id}/activity`} />
            </>
          )}
        </Loading>
      </ModalBody>
      <ModalFooter>
        {user && !self && <Button variant="danger" onClick={() => void remove(user)}>Remove user</Button>}
        <Button onClick={onClose}>Close</Button>
      </ModalFooter>
    </Modal>
  );
}

function LoginSwitch({ user, onSaved }: { user: UserDetail; onSaved: () => void }) {
  const [reason, setReason] = useState(user.disabled_reason ?? '');
  const [error, setError] = useState<string | null>(null);
  const change = (enabled: boolean) => {
    setError(null);
    api(`/users/${user.id}/status`, 'PUT', { enabled, reason: enabled ? '' : reason })
      .then(onSaved).catch((e: unknown) => setError(describe(e)));
  };
  return (
    <div class="form">
      <h3>Login</h3>
      {error && <Notice tone="error">{error}</Notice>}
      <Checkbox label="Allowed to log in" checked={!user.disabled} onChecked={change}
                hint={user.disabled
                  ? `Switched off ${formatDate(user.disabled_at)}. Their charts, settings and key are kept.`
                  : 'Switching off logs them out at once. Their charts, settings and key are kept.'} />
      {!user.disabled && (
        <Field label="Reason (only you see it)" value={reason} onValue={setReason} id="disable-reason"
               hint="They're told the account is switched off, whatever this says." />
      )}
      {user.disabled && user.disabled_reason && <p class="muted small">Reason: {user.disabled_reason}</p>}
    </div>
  );
}

function UserLimits({ user, onSaved }: { user: UserDetail; onSaved: () => void }) {
  const [useDefaults, setUseDefaults] = useState(user.uses_site_defaults);
  const [values, setValues] = useState<Limits>(user.limits ?? emptyLimits());
  const [saved, setSaved] = useState(false);
  const { busy, error, onSubmit } = useSubmit(async () => {
    setSaved(false);
    await api(`/users/${user.id}/limits`, 'PUT', { use_site_defaults: useDefaults, limits: values });
    setSaved(true);
    onSaved();
  });
  const eph = user.ephemeral_limits && Object.entries(user.ephemeral_limits).filter(([, v]) => typeof v === 'number' && v > 0);
  return (
    <form class="form" onSubmit={onSubmit}>
      <h3>Limits</h3>
      <p class="muted small">Calls this site sends to ephemeralREST for them. Charts already loaded cost nothing.</p>
      {error && <Notice tone="error">{error}</Notice>}
      {saved && <Notice tone="success">Saved.</Notice>}
      <Checkbox label="Use site defaults" checked={useDefaults} onChecked={(v) => { setUseDefaults(v); setSaved(false); }}
                hint="Set in Settings → New accounts." />
      <LimitFields value={useDefaults ? user.site_defaults : values} onValue={(v) => { setValues(v); setSaved(false); }}
                   idPrefix="user-limit" disabled={useDefaults} />
      <UsageLines usage={user.usage} />
      {eph && eph.length > 0 && (
        <p class="muted small">ephemeralREST also limits this key to {eph.map(([k, v]) => `${v} ${k.replace(/^per_/, 'a ')}`).join(', ')}.</p>
      )}
      <div class="actions"><Button type="submit" variant="primary" busy={busy}>Save limits</Button></div>
    </form>
  );
}

/** How long activity is kept. */
function Retention() {
  const [current, reload] = useLoad(() => api<{ months: number }>('/settings/activity-retention'));
  const [months, setMonths] = useState('');
  const { busy, error, onSubmit } = useSubmit(async () => {
    await api('/settings/activity-retention', 'PUT', { months: Number(months) });
    setMonths('');
    reload();
  });
  return (
    <form class="form form--inline" onSubmit={onSubmit}>
      {error && <Notice tone="error">{error}</Notice>}
      <Field label="Keep activity for (months)" type="number" inputMode="numeric" id="retention-months"
             value={months} onValue={setMonths} required
             placeholder={current.state === 'ready' ? String(current.data.months) : ''}
             hint={current.state === 'ready' ? `Now ${current.data.months} months. Older entries are removed.` : undefined} />
      <div class="actions"><Button type="submit" busy={busy}>Save</Button></div>
    </form>
  );
}

function AddUser({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const { busy, error, onSubmit } = useSubmit(async () => {
    await api('/users', 'POST', { name, email, password });
    onDone();
  });
  return (
    <form class="card form-card" onSubmit={onSubmit}>
      <h2>Add a person</h2>
      {error && <Notice tone="error">{error}</Notice>}
      <div class="form-grid">
        <Field label="Name" value={name} onValue={setName} required />
        <Field label="Email" type="email" value={email} onValue={setEmail} required />
      </div>
      <Field
        label="Starting password"
        type="text"
        value={password}
        onValue={setPassword}
        autoComplete="off"
        hint="Pass it on to them privately. They can change it after logging in."
        required
      />
      <div class="actions">
        <Button type="submit" variant="primary" busy={busy}>Add</Button>
        <Button onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}
