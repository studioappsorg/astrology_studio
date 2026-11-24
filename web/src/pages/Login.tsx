/**
 * AstrologyStudio ·
 * web/src/pages/Login.tsx
 *
 * Logging in, and creating an account through ephemeralREST when the owner allows it.
 *
 * Accounts made here live in ephemeralREST: it emails a link to verify the address and a link
 * to set a password (both on the ephemeralREST site). After that, logging in here with that
 * email and password sends a code by email, and the code finishes it; AstrologyStudio then
 * keeps the person's ephemeralREST key for them.
 *
 * Copyright (c) 2026 Gavin Melhuish
 * MIT License; see LICENSE in the project root.
 * SPDX-License-Identifier: MIT
 */

import { useState } from 'preact/hooks';
import { api, type Session } from '../api';
import { Brand } from '../nav';
import { Button, Checkbox, Field, Notice, useLoad, useSubmit } from '../ui';
import { isHosted } from '../hosted';

type Step =
  | { kind: 'login' } | { kind: 'code'; email: string } | { kind: 'register' } | { kind: 'registered'; email: string }
  | { kind: 'forgot' } | { kind: 'forgot-sent'; email: string } | { kind: 'reset'; token: string };

/** A "set a new password" link from a reset email: /reset-password?token=… */
function resetToken(): string | null {
  return location.pathname === '/reset-password' ? new URLSearchParams(location.search).get('token') : null;
}

type LoginResult = Session | { two_factor: true; email: string };

export function Login({ onDone, registrationOpen, passwordReset }: {
  onDone: (session: Session) => void; registrationOpen: boolean; passwordReset: boolean;
}) {
  const [step, setStep] = useState<Step>(() => {
    const token = resetToken();
    return token ? { kind: 'reset', token } : { kind: 'login' };
  });
  const [email, setEmail] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const toLogin = (message: string | null = null) => {
    setNotice(message);
    if (location.pathname === '/reset-password') history.replaceState(null, '', '/');
    setStep({ kind: 'login' });
  };

  // After deleting an account the app comes back here with ?deleted=1.
  const [deleted] = useState(() => new URLSearchParams(location.search).has('deleted'));
  return (
    <main class="auth">
      {deleted && step.kind === 'login' && <Notice tone="success">Your account has been deleted.</Notice>}
      {notice && step.kind === 'login' && <Notice tone="success">{notice}</Notice>}
      {step.kind === 'login' && (
        <LoginForm email={email} setEmail={setEmail} registrationOpen={registrationOpen} onDone={onDone}
                   passwordReset={passwordReset} onForgot={() => setStep({ kind: 'forgot' })}
                   onCode={(e) => setStep({ kind: 'code', email: e })} onRegister={() => setStep({ kind: 'register' })} />
      )}
      {step.kind === 'forgot' && (
        <ForgotForm email={email} setEmail={setEmail} onSent={(e) => setStep({ kind: 'forgot-sent', email: e })} onBack={() => toLogin()} />
      )}
      {step.kind === 'forgot-sent' && <ForgotSent email={step.email} onBack={() => toLogin()} />}
      {step.kind === 'reset' && (
        <ResetForm token={step.token} onDone={(e) => { setEmail(e); toLogin('Your password has been changed. Log in with the new one.'); }}
                   onBack={() => toLogin()} />
      )}
      {step.kind === 'code' && <CodeForm email={step.email} onDone={onDone} onBack={() => setStep({ kind: 'login' })} />}
      {step.kind === 'register' && (
        <RegisterForm onDone={(e) => { setEmail(e); setStep({ kind: 'registered', email: e }); }}
                      onBack={() => setStep({ kind: 'login' })} />
      )}
      {step.kind === 'registered' && <Registered email={step.email} onBack={() => setStep({ kind: 'login' })} />}
    </main>
  );
}

function LoginForm({ email, setEmail, registrationOpen, passwordReset, onDone, onCode, onRegister, onForgot }: {
  email: string; setEmail: (v: string) => void; registrationOpen: boolean; passwordReset: boolean;
  onDone: (session: Session) => void; onCode: (email: string) => void; onRegister: () => void; onForgot: () => void;
}) {
  const [password, setPassword] = useState('');
  const { busy, error, onSubmit } = useSubmit(async () => {
    const result = await api<LoginResult>('/auth/login', 'POST', { email, password });
    if ('two_factor' in result) onCode(result.email);
    else onDone(result);
  });
  return (
    <form class="card auth__card" onSubmit={onSubmit}>
      <Brand />
      <h1>Log in</h1>
      {error && <Notice tone="error">{error}</Notice>}
      <Field label="Email" type="email" value={email} onValue={setEmail} autoComplete="username" required />
      <Field label="Password" type="password" value={password} onValue={setPassword} autoComplete="current-password" required />
      <Button type="submit" variant="primary" busy={busy}>Log in</Button>
      {registrationOpen && (
        <p class="auth__switch">New here? <button type="button" class="link-button" onClick={onRegister}>Create an account</button></p>
      )}
      {passwordReset ? (
        <p class="auth__switch"><button type="button" class="link-button" onClick={onForgot}>Forgot your password?</button></p>
      ) : (
        <p class="muted small">
          Locked out? Someone with access to the server can run <code>astrologystudio reset-password --email you@…</code>
        </p>
      )}
    </form>
  );
}

function CodeForm({ email, onDone, onBack }: { email: string; onDone: (session: Session) => void; onBack: () => void }) {
  const [code, setCode] = useState('');
  const [remember, setRemember] = useState(false);
  const { busy, error, onSubmit } = useSubmit(async () => {
    onDone(await api<Session>('/auth/login/code', 'POST', { email, code, remember }));
  });
  return (
    <form class="card auth__card" onSubmit={onSubmit}>
      <Brand />
      <h1>Check your email</h1>
      <p class="muted">We've emailed a 6-digit code to <strong>{email}</strong>. Enter it to finish logging in.</p>
      {error && <Notice tone="error">{error}</Notice>}
      <Field label="Code" value={code} onValue={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))} id="login-code"
             inputMode="numeric" autoComplete="one-time-code" placeholder="123456" required />
      <Checkbox label="Remember this browser for 28 days" checked={remember} onChecked={setRemember} />
      <Button type="submit" variant="primary" busy={busy} disabled={code.length < 6}>Log in</Button>
      <p class="auth__switch"><button type="button" class="link-button" onClick={onBack}>Back</button> · The code lasts a few minutes; log in again for a new one.</p>
    </form>
  );
}

function RegisterForm({ onDone, onBack }: { onDone: (email: string) => void; onBack: () => void }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const { busy, error, onSubmit } = useSubmit(async () => {
    const result = await api<{ email: string }>('/auth/register', 'POST', { name, email });
    onDone(result.email);
  });
  return (
    <form class="card auth__card" onSubmit={onSubmit}>
      <Brand />
      <h1>Create an account</h1>
      <p class="muted">{isHosted()
        ? 'We\'ll email you a link to confirm your address, then one to choose your password.'
        : 'Your account is made with ephemeralREST, which does AstrologyStudio\'s calculations. It works in other apps that use ephemeralREST too.'}</p>
      {error && <Notice tone="error">{error}</Notice>}
      <Field label="Name" value={name} onValue={setName} autoComplete="name" required />
      <Field label="Email" type="email" value={email} onValue={setEmail} autoComplete="email" required />
      <Button type="submit" variant="primary" busy={busy}>Create account</Button>
      <p class="auth__switch">{isHosted() ? 'Already have an account?' : 'Already have an account, here or with ephemeralREST?'} <button type="button" class="link-button" onClick={onBack}>Log in</button></p>
    </form>
  );
}

function Registered({ email, onBack }: { email: string; onBack: () => void }) {
  return (
    <div class="card auth__card">
      <Brand />
      <h1>Nearly there</h1>
      <ol class="auth__steps">
        <li><strong>Verify your email.</strong> {isHosted() ? 'We\'ve' : 'ephemeralREST has'} sent a link to <strong>{email}</strong>. Click it.</li>
        <li><strong>Set a password.</strong> A second email follows with a link to choose your password.{isHosted()
          ? ' A third email has an API key: you don\'t need it, it\'s saved with your account.'
          : ' Once it\'s set, a third email brings your API key: keep it somewhere safe (AstrologyStudio saves it for you).'}</li>
        <li><strong>Log in here</strong> with that email and password. We'll email you a code to finish, and your account is ready.</li>
      </ol>
      <p class="muted small">No email? Check your spam folder. If that address already has an {isHosted() ? '' : 'ephemeralREST '}account, no email is sent: just log in.</p>
      <Button variant="primary" onClick={onBack}>Go to log in</Button>
    </div>
  );
}

function ForgotForm({ email, setEmail, onSent, onBack }: {
  email: string; setEmail: (v: string) => void; onSent: (email: string) => void; onBack: () => void;
}) {
  const { busy, error, onSubmit } = useSubmit(async () => {
    await api('/auth/password-reset', 'POST', { email });
    onSent(email);
  });
  return (
    <form class="card auth__card" onSubmit={onSubmit}>
      <Brand />
      <h1>Forgot your password?</h1>
      <p class="muted">Enter your email and we'll send you a link to choose a new one.</p>
      {error && <Notice tone="error">{error}</Notice>}
      <Field label="Email" type="email" value={email} onValue={setEmail} autoComplete="username" required id="forgot-email" />
      <Button type="submit" variant="primary" busy={busy}>Email me a link</Button>
      <p class="auth__switch"><button type="button" class="link-button" onClick={onBack}>Back to log in</button></p>
    </form>
  );
}

function ForgotSent({ email, onBack }: { email: string; onBack: () => void }) {
  return (
    <div class="card auth__card">
      <Brand />
      <h1>Check your email</h1>
      <p>If there's an account for <strong>{email}</strong>, we've sent it a link to choose a new password. The link works once, for an hour.</p>
      <p class="muted small">No email? Check your spam folder, and that the address is the one you log in with.</p>
      <Button variant="primary" onClick={onBack}>Back to log in</Button>
    </div>
  );
}

function ResetForm({ token, onDone, onBack }: { token: string; onDone: (email: string) => void; onBack: () => void }) {
  const [check] = useLoad(() => api<{ email: string }>(`/auth/password-reset/${encodeURIComponent(token)}`), [token]);
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const { busy, error, onSubmit } = useSubmit(async () => {
    if (password !== again) throw new Error("The two passwords don't match.");
    await api('/auth/password-reset/finish', 'POST', { token, new_password: password });
    onDone(check.state === 'ready' ? check.data.email : '');
  });
  if (check.state === 'error') {
    return (
      <div class="card auth__card">
        <Brand />
        <h1>This link has expired</h1>
        <p class="muted">Reset links work once, for an hour. Ask for a new one from the login page.</p>
        <Button variant="primary" onClick={onBack}>Go to log in</Button>
      </div>
    );
  }
  return (
    <form class="card auth__card" onSubmit={onSubmit}>
      <Brand />
      <h1>Choose a new password</h1>
      {check.state === 'ready' && <p class="muted">For <strong>{check.data.email}</strong>. You'll be logged out everywhere else.</p>}
      {error && <Notice tone="error">{error}</Notice>}
      <Field label="New password" type="password" value={password} onValue={setPassword} autoComplete="new-password" required
             id="reset-password" hint="At least 10 characters." />
      <Field label="New password again" type="password" value={again} onValue={setAgain} autoComplete="new-password" required id="reset-again" />
      <Button type="submit" variant="primary" busy={busy} disabled={check.state !== 'ready'}>Set new password</Button>
      <p class="auth__switch"><button type="button" class="link-button" onClick={onBack}>Back to log in</button></p>
    </form>
  );
}
