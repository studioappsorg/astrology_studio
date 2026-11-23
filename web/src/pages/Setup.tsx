/**
 * AstrologyStudio ·
 * web/src/pages/Setup.tsx
 *
 * First run:
 *
 * create the owner's account. Shown only while the install has no accounts.
 *
 * Copyright (c) 2026 Gavin Melhuish
 * MIT License; see LICENSE in the project root.
 * SPDX-License-Identifier: MIT
 */

import { useState } from 'preact/hooks';
import { api, type Session } from '../api';
import { Brand } from '../nav';
import { Button, Field, Notice, useSubmit } from '../ui';

export function Setup({ onDone }: { onDone: (session: Session) => void }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const { busy, error, onSubmit } = useSubmit(async () => {
    onDone(await api<Session>('/auth/setup', 'POST', { name, email, password }));
  });

  return (
    <main class="auth">
      <form class="card auth__card" onSubmit={onSubmit}>
        <Brand />
        <h1>Welcome to AstrologyStudio</h1>
        <p class="muted">Create the owner account. You can add other people later.</p>
        {error && <Notice tone="error">{error}</Notice>}
        <Field label="Your name" value={name} onValue={setName} autoComplete="name" required />
        <Field label="Email" type="email" value={email} onValue={setEmail} autoComplete="email" required />
        <Field
          label="Password"
          type="password"
          value={password}
          onValue={setPassword}
          autoComplete="new-password"
          hint="At least 10 characters. A few random words works well."
          required
        />
        <Button type="submit" variant="primary" busy={busy}>
          Create account
        </Button>
      </form>
    </main>
  );
}
