/**
 * AstrologyStudio ·
 * web/src/pages/EmailSettings.tsx
 *
 * Settings → Email (owner only):
 *
 * the SMTP server everything in the app sends email through. The password is never shown
 * again once saved; leaving it blank keeps it. A test message checks the settings work.
 *
 * Copyright (c) 2026 Gavin Melhuish
 * MIT License; see LICENSE in the project root.
 * SPDX-License-Identifier: MIT
 */

import { useState } from 'preact/hooks';
import { api } from '../api';
import { Button, Checkbox, describe, Field, Loading, Notice, Select, useLoad, useSubmit } from '../ui';

type Security = 'starttls' | 'ssl' | 'none';
interface EmailConfig {
  configured: boolean;
  host?: string;
  port?: number;
  security?: Security;
  username?: string;
  has_password?: boolean;
  from_address?: string;
  from_name?: string;
  reply_to?: string;
}

const SECURITY: Array<[Security, string]> = [
  ['starttls', 'STARTTLS (usually port 587)'],
  ['ssl', 'SSL/TLS (usually port 465)'],
  ['none', 'None (only for a server on this machine or network)'],
];
const PORT: Record<Security, string> = { starttls: '587', ssl: '465', none: '25' };

export function EmailSettings() {
  const [config, reload] = useLoad(() => api<EmailConfig>('/email'));
  return (
    <section class="card form-card card--span">
      <h2>Email</h2>
      <p class="muted">
        The mail server everything here sends email through, from one address. Use the SMTP details from your
        email provider or sending service (Postmark, Mailgun, SMTP2GO, AuthSMTP, Amazon SES and the like).
      </p>
      <Loading result={config}>{() => config.state === 'ready' && <EmailForm config={config.data} reload={reload} />}</Loading>
    </section>
  );
}

function EmailForm({ config, reload }: { config: EmailConfig; reload: () => void }) {
  const [host, setHost] = useState(config.host ?? '');
  const [security, setSecurity] = useState<Security>(config.security ?? 'starttls');
  const [port, setPort] = useState(String(config.port ?? 587));
  const [username, setUsername] = useState(config.username ?? '');
  const [password, setPassword] = useState('');
  const [removePassword, setRemovePassword] = useState(false);
  const [fromAddress, setFromAddress] = useState(config.from_address ?? '');
  const [fromName, setFromName] = useState(config.from_name ?? 'AstrologyStudio');
  const [replyTo, setReplyTo] = useState(config.reply_to ?? '');
  const [saved, setSaved] = useState(false);
  const [testTo, setTestTo] = useState('');
  const [testResult, setTestResult] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [testing, setTesting] = useState(false);
  // Typing anything after a save clears "Saved".
  const edit = <T,>(set: (v: T) => void) => (v: T) => { setSaved(false); set(v); };

  const pickSecurity = (v: string) => {
    const next = v as Security;
    // Move the port along with the security, unless it was set to something unusual.
    if (Object.values(PORT).includes(port)) setPort(PORT[next]);
    setSecurity(next);
    setSaved(false);
  };

  const { busy, error, onSubmit } = useSubmit(async () => {
    const body: Record<string, unknown> = {
      host: host.trim(), port: Number(port), security, username: username.trim(),
      from_address: fromAddress.trim(), from_name: fromName.trim(), reply_to: replyTo.trim(),
    };
    if (removePassword) body.password = '';
    else if (password) body.password = password;
    await api('/email', 'PUT', body);
    setPassword('');
    setRemovePassword(false);
    setSaved(true);
    reload();
  });

  const test = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const sent = await api<{ to: string }>('/email/test', 'POST', { to: testTo.trim() });
      setTestResult({ tone: 'success', text: `Sent to ${sent.to}. Check that it arrived (and isn't in spam).` });
    } catch (e) {
      setTestResult({ tone: 'error', text: describe(e) });
    } finally {
      setTesting(false);
    }
  };

  const remove = async () => {
    if (!confirm('Remove the email settings? Nothing will be able to send email until they are set up again.')) return;
    await api('/email', 'DELETE');
    reload();
  };

  return (
    <>
      <form class="form" onSubmit={onSubmit}>
        {error && <Notice tone="error">{error}</Notice>}
        {saved && <Notice tone="success">Saved. Send a test message to check it works.</Notice>}
        <div class="form-grid form-grid--3">
          <Field label="SMTP server" value={host} onValue={edit(setHost)} placeholder="smtp.example.com" required id="smtp-host" />
          <Select label="Security" value={security} onValue={pickSecurity} options={SECURITY} id="smtp-security" />
          <Field label="Port" type={'number' as 'text'} value={port} onValue={edit(setPort)} required id="smtp-port" />
        </div>
        {security === 'none' && username && (
          <Notice tone="info">With no security the password travels unencrypted. Use it only for a server on this machine or your own network.</Notice>
        )}
        <div class="form-grid">
          <Field label="Username" value={username} onValue={edit(setUsername)} autoComplete="off" id="smtp-username"
                 hint="Often your email address or an API key name. Leave empty if the server needs no login." />
          <Field label="Password" type="password" value={password} onValue={edit(setPassword)} autoComplete="new-password" id="smtp-password"
                 placeholder={config.has_password ? '•••••••• (saved)' : ''}
                 hint={config.has_password ? 'Saved and kept encrypted. Leave empty to keep it.' : 'Kept encrypted; never shown again.'} />
        </div>
        {config.has_password && <Checkbox label="Remove the saved password" checked={removePassword} onChecked={edit(setRemovePassword)} />}
        <div class="form-grid form-grid--3">
          <Field label="From address" type="email" value={fromAddress} onValue={edit(setFromAddress)} required id="smtp-from"
                 placeholder="studio@example.com" hint="An address your server is allowed to send from." />
          <Field label="From name" value={fromName} onValue={edit(setFromName)} id="smtp-from-name" />
          <Field label="Reply-to (optional)" type="email" value={replyTo} onValue={edit(setReplyTo)} id="smtp-reply-to"
                 hint="Where replies go, if not the From address." />
        </div>
        <div class="actions">
          <Button type="submit" variant="primary" busy={busy}>Save email settings</Button>
          {config.configured && <span class="actions__end"><Button variant="danger" onClick={() => void remove()}>Remove</Button></span>}
        </div>
      </form>
      {config.configured && (
        <div class="email-test">
          <h3>Send a test message</h3>
          {testResult && <Notice tone={testResult.tone}>{testResult.text}</Notice>}
          <div class="email-test__row">
            <Field label="To" type="email" value={testTo} onValue={setTestTo} id="smtp-test-to" placeholder="Your own address if left empty" />
            <Button onClick={() => void test()} busy={testing}>Send test</Button>
          </div>
        </div>
      )}
    </>
  );
}
