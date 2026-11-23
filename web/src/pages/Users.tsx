/**
 * AstrologyStudio ·
 * web/src/pages/Users.tsx
 *
 * People who can log in. Only the owner sees this page; they add and remove people here.
 *
 * Copyright (c) 2026 Gavin Melhuish
 * MIT License; see LICENSE in the project root.
 * SPDX-License-Identifier: MIT
 */

import { useState } from 'preact/hooks';
import { api, type User } from '../api';
import { useSession } from '../session';
import { NotFound } from './NotFound';
import { Button, describe, Field, formatDate, Loading, Notice, PageHeader, useLoad, useSubmit } from '../ui';

export function Users() {
  const { session } = useSession();
  return session.user.is_owner ? <UserList /> : <NotFound />;
}

function UserList() {
  const { session } = useSession();
  const [users, reload] = useLoad(() => api<{ data: User[] }>('/users'));
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const remove = async (user: User) => {
    if (!confirm(`Remove ${user.name || user.email}? They'll be logged out and can't log in again.`)) return;
    setError(null);
    try {
      await api(`/users/${user.id}`, 'DELETE');
      reload();
    } catch (e) {
      setError(describe(e));
    }
  };

  return (
    <>
      <PageHeader
        title="Users"
        intro="People who can log in. Each person uses their own ephemeralREST key and sees their own charts."
        actions={!adding && <Button variant="primary" onClick={() => setAdding(true)}>Add a person</Button>}
      />
      {adding && <AddUser onDone={() => { setAdding(false); reload(); }} onCancel={() => setAdding(false)} />}
      {error && <Notice tone="error">{error}</Notice>}
      <Loading result={users}>
        {() =>
          users.state === 'ready' && (
            <table class="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Last login</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {users.data.data.map((user) => (
                  <tr key={user.id}>
                    <td>{user.name || '—'}</td>
                    <td>{user.email}{user.signs_in_with === 'ephemeral' && <span class="user-badge" title="Logs in with their ephemeralREST account">ephemeralREST</span>}</td>
                    <td>{formatDate(user.last_login_at)}</td>
                    <td class="table__actions">
                      {user.id === session.user.id ? (
                        <span class="muted small">You</span>
                      ) : (
                        <Button variant="danger" onClick={() => void remove(user)}>Remove</Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        }
      </Loading>
    </>
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
