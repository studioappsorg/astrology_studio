/**
 * AstrologyStudio ·
 * web/src/pages/Login.tsx
 *
 * Logging in, and creating an account through ephemeralREST when the owner allows it.
 *
 * Accounts made here live in ephemeralREST. When the owner has saved a site key, its emails
 * link back to this site: /auth/verify?t=… confirms the address and sets the password in one
 * step and signs the person in, and /auth/set-password?t=… is "Forgot your password?" for people
 * who sign in through ephemeralREST. Without a site key it's the older way round: links to the
 * ephemeralREST site, then logging in here with an emailed code.
 *
 * Copyright (c) 2026 Gavin Melhuish
 * MIT License; see LICENSE in the project root.
 * SPDX-License-Identifier: MIT
 */

import { useState } from 'preact/hooks';
import { api, ApiError, type Session, type SignupSent } from '../api';
import { Brand } from '../nav';
import { Button, Checkbox, Field, Notice, useLoad, useSubmit } from '../ui';
import { isHosted } from '../hosted';

type Step =
  | { kind: 'login' } | { kind: 'code'; email: string } | { kind: 'register' } | { kind: 'registered'; sent: SignupSent }
  | { kind: 'forgot' } | { kind: 'forgot-sent'; email: string } | { kind: 'reset'; token: string }
  | { kind: 'verify'; token: string } | { kind: 'key-saved'; email: string } | { kind: 'eph-reset'; token: string };

const LINK_PATHS = ['/reset-password', '/auth/verify', '/auth/set-password'];

/** The page an emailed link opened: a reset (/reset-password?token=…), finishing sign-up
 * (/auth/verify?t=…) or a new ephemeralREST password (/auth/set-password?t=…). */
function linkStep(): Step {
  const query = new URLSearchParams(location.search);
  if (location.pathname === '/reset-password' && query.get('token')) return { kind: 'reset', token: query.get('token')! };
  if (location.pathname === '/auth/verify' && query.get('t')) return { kind: 'verify', token: query.get('t')! };
  if (location.pathname === '/auth/set-password' && query.get('t')) return { kind: 'eph-reset', token: query.get('t')! };
  return { kind: 'login' };
}

type LoginResult = Session | { two_factor: true; email: string };

export function Login({ onDone, registrationOpen, passwordReset }: {
  onDone: (session: Session) => void; registrationOpen: boolean; passwordReset: boolean;
}) {
  const [step, setStep] = useState<Step>(linkStep);
  const [email, setEmail] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const toLogin = (message: string | null = null) => {
    setNotice(message);
    if (LINK_PATHS.includes(location.pathname)) history.replaceState(null, '', '/');
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
      {step.kind === 'verify' && (
        <VerifyForm token={step.token} onDone={(session) => { history.replaceState(null, '', '/'); onDone(session); }}
                    onKeySaved={(e) => { history.replaceState(null, '', '/'); setStep({ kind: 'key-saved', email: e }); }}
                    onBack={() => toLogin()} />
      )}
      {step.kind === 'key-saved' && <KeySaved email={step.email} onBack={() => { window.location.href = '/'; }} />}
      {step.kind === 'eph-reset' && (
        <EphemeralResetForm token={step.token} onDone={() => toLogin('Your password has been changed. Log in with the new one.')}
                            onBack={() => toLogin()} />
      )}
      {step.kind === 'code' && <CodeForm email={step.email} onDone={onDone} onBack={() => setStep({ kind: 'login' })} />}
      {step.kind === 'register' && (
        <RegisterForm onDone={(sent) => { setEmail(sent.email); setStep({ kind: 'registered', sent }); }}
                      onBack={() => setStep({ kind: 'login' })} />
      )}
      {step.kind === 'registered' && <Registered sent={step.sent} onBack={() => setStep({ kind: 'login' })} />}
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

function RegisterForm({ onDone, onBack }: { onDone: (sent: SignupSent) => void; onBack: () => void }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const { busy, error, onSubmit } = useSubmit(async () => {
    onDone(await api<SignupSent>('/auth/register', 'POST', { name, email }));
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
      <p class="muted small">Used AstrologyStudio on another site? Log in with the same email and password instead.</p>
    </form>
  );
}

function Registered({ sent, onBack }: { sent: SignupSent; onBack: () => void }) {
  const email = sent.email;
  if (sent.flow === 'here') {
    return (
      <div class="card auth__card">
        <Brand />
        <h1>Check your email</h1>
        <p>We've sent a link to <strong>{email}</strong>. Click it to confirm your address and choose your password, and you're in.</p>
        <p class="muted small">No email? Check your spam folder. If that address already has an account, no email is sent: just log in.</p>
        <Button variant="primary" onClick={onBack}>Go to log in</Button>
      </div>
    );
  }
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

/** An expired or used link: the way to get a new one. */
function Expired({ title, detail, onBack }: { title: string; detail: string; onBack: () => void }) {
  return (
    <div class="card auth__card">
      <Brand />
      <h1>{title}</h1>
      <p class="muted">{detail}</p>
      <Button variant="primary" onClick={onBack}>Go to log in</Button>
    </div>
  );
}

type Verified = ({ result: 'signed_in' } & Session) | { result: 'key_saved'; email: string };

/** /auth/verify?t=… : confirm the address and choose a password in one step. */
function VerifyForm({ token, onDone, onKeySaved, onBack }: {
  token: string; onDone: (session: Session) => void; onKeySaved: (email: string) => void; onBack: () => void;
}) {
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [gone, setGone] = useState<{ title: string; detail: string } | null>(null);
  const { busy, error, onSubmit } = useSubmit(async () => {
    if (password !== again) throw new Error("The two passwords don't match.");
    try {
      const result = await api<Verified>('/auth/verify', 'POST', { token, password });
      if (result.result === 'key_saved') onKeySaved(result.email);
      else onDone({ user: result.user, csrf_token: result.csrf_token });
    } catch (e) {
      if (e instanceof ApiError && (e.status === 410 || e.status === 409)) {
        setGone({ title: e.message, detail: e.detail ?? '' });
        return;
      }
      throw e;
    }
  });
  if (gone) return <Expired title={gone.title} detail={gone.detail} onBack={onBack} />;
  return (
    <form class="card auth__card" onSubmit={onSubmit}>
      <Brand />
      <h1>Choose your password</h1>
      <p class="muted">Your email address is confirmed as soon as you save this.</p>
      {error && <Notice tone="error">{error}</Notice>}
      <Field label="Password" type="password" value={password} onValue={setPassword} autoComplete="new-password" required
             id="verify-password" hint="At least 8 characters." />
      <Field label="Password again" type="password" value={again} onValue={setAgain} autoComplete="new-password" required id="verify-again" />
      <Button type="submit" variant="primary" busy={busy}>Save and continue</Button>
    </form>
  );
}

/** The account was asked for from Settings or Your account ("I don't have a key"). */
function KeySaved({ email, onBack }: { email: string; onBack: () => void }) {
  return (
    <div class="card auth__card">
      <Brand />
      <h1>Your key is saved</h1>
      <p>The account for <strong>{email}</strong> is ready and its key has been saved to the account that asked for it.
        Go back to that window, or log in here as usual.</p>
      <Button variant="primary" onClick={onBack}>Go to log in</Button>
    </div>
  );
}

/** /auth/set-password?t=… : a new password for people who sign in through ephemeralREST. */
function EphemeralResetForm({ token, onDone, onBack }: { token: string; onDone: () => void; onBack: () => void }) {
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [gone, setGone] = useState<string | null>(null);
  const { busy, error, onSubmit } = useSubmit(async () => {
    if (password !== again) throw new Error("The two passwords don't match.");
    try {
      await api('/auth/ephemeral-password', 'POST', { token, password });
      onDone();
    } catch (e) {
      if (e instanceof ApiError && e.status === 410) { setGone(e.detail ?? e.message); return; }
      throw e;
    }
  });
  if (gone) return <Expired title="This link has expired" detail={gone} onBack={onBack} />;
  return (
    <form class="card auth__card" onSubmit={onSubmit}>
      <Brand />
      <h1>Choose a new password</h1>
      {error && <Notice tone="error">{error}</Notice>}
      <Field label="New password" type="password" value={password} onValue={setPassword} autoComplete="new-password" required
             id="eph-reset-password" hint="At least 8 characters." />
      <Field label="New password again" type="password" value={again} onValue={setAgain} autoComplete="new-password" required id="eph-reset-again" />
      <Button type="submit" variant="primary" busy={busy}>Set new password</Button>
      <p class="auth__switch"><button type="button" class="link-button" onClick={onBack}>Back to log in</button></p>
    </form>
  );
}
