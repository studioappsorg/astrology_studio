/**
 * AstrologyStudio ·
 * web/src/pages/EmailDesigns.tsx
 *
 * Settings → Email, below the SMTP settings (owner only):
 *
 * - "Send ephemeralREST's emails from this site": sign-up links, login codes, resets and key
 *   notices go out through this site's SMTP with these designs, once SMTP, the site key and
 *   ephemeralREST are all ready (it says which isn't).
 * - Email designs: the look every email shares (logo, accent colour, sender, footer) and each
 *   email's subject and body, with a preview (light and dark, and the plain-text version), a test
 *   send to yourself, and Reset to default.
 *
 * Copyright (c) 2026 Gavin Melhuish
 * MIT License; see LICENSE in the project root.
 * SPDX-License-Identifier: MIT
 */

import { useEffect, useState } from 'preact/hooks';
import { api, ApiError } from '../api';
import { Button, Checkbox, describe, Field, formatDate, Loading, Notice, TextArea, useLoad, useSubmit } from '../ui';

interface DeliveryState {
  on: boolean;
  ready: boolean;
  missing: string[];
  last_failure: { at: string; kind: string; problem: string } | null;
}

interface Branding {
  use_site_logo: boolean;
  logo: string | null;
  accent: string;
  sender_name: string;
  reply_to: string;
  footer: string;
}

interface EmailTemplate {
  key: string;
  label: string;
  placeholders: string[];
  required: string[];
  optional: boolean;
  subject: string;
  body: string;
  enabled: boolean;
  customised: boolean;
}

interface Preview {
  subject: string;
  text: string;
  html: string;
  html_dark: string;
}

export function EmailDelivery() {
  const [state, reload] = useLoad(() => api<DeliveryState>('/email/delivery'));
  const [error, setError] = useState<string | null>(null);
  const change = (on: boolean) => {
    setError(null);
    api('/email/delivery', 'PUT', { on }).then(reload).catch((e: unknown) => setError(describe(e)));
  };
  return (
    <section class="card form-card card--span">
      <h2>Send ephemeralREST's emails from this site</h2>
      <p class="muted">
        Sign-up links, login codes, password resets and key notices for accounts made on this site go out through
        your email server above, with your designs below, instead of from ephemeralREST. People with accounts made
        elsewhere keep getting ephemeralREST's own emails.
      </p>
      {error && <Notice tone="error">{error}</Notice>}
      <Loading result={state}>
        {() => state.state === 'ready' && (
          <>
            {state.data.last_failure && (
              <Notice tone="error">
                An email couldn't be sent ({formatDate(state.data.last_failure.at)}): {state.data.last_failure.problem}.
                Check the email settings and send a test.
              </Notice>
            )}
            <Checkbox label="Send them from this site" checked={state.data.on} onChecked={change}
                      disabled={!state.data.on && !state.data.ready} />
            {!state.data.ready && !state.data.on && (
              <ul class="checklist">{state.data.missing.map((m) => <li key={m}>{m}</li>)}</ul>
            )}
            <div class="actions"><Button onClick={reload}>Check again</Button></div>
          </>
        )}
      </Loading>
    </section>
  );
}

export function EmailDesigns() {
  const [templates, reload] = useLoad(() => api<{ data: EmailTemplate[] }>('/email/templates'));
  const [open, setOpen] = useState<string | null>(null);
  return (
    <section class="card form-card card--span">
      <h2>Email designs</h2>
      <BrandingForm />
      <h3>Emails</h3>
      <Loading result={templates}>
        {() => templates.state === 'ready' && (
          <ul class="email-list">
            {templates.data.data.map((t) => (
              <li key={t.key}>
                <button type="button" class="link-button" aria-expanded={open === t.key}
                        onClick={() => setOpen(open === t.key ? null : t.key)}>{t.label}</button>
                {t.customised && <span class="user-badge">Changed</span>}
                {t.optional && !t.enabled && <span class="muted small"> · off</span>}
                {open === t.key && <TemplateEditor template={t} onSaved={reload} />}
              </li>
            ))}
          </ul>
        )}
      </Loading>
    </section>
  );
}

function BrandingForm() {
  const [current] = useLoad(() => api<Branding>('/email/branding'));
  const [value, setValue] = useState<Branding | null>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => { if (current.state === 'ready') setValue(current.data); }, [current.state]);
  const { busy, error, onSubmit } = useSubmit(async () => {
    if (!value) return;
    setSaved(false);
    setValue(await api<Branding>('/email/branding', 'PUT', value));
    setSaved(true);
  });
  if (!value) return null;
  const set = (change: Partial<Branding>) => { setValue({ ...value, ...change }); setSaved(false); };
  const pick = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => set({ logo: String(reader.result) });
    reader.readAsDataURL(file);
  };
  return (
    <form class="form" onSubmit={onSubmit}>
      <h3>The look of every email</h3>
      {error && <Notice tone="error">{error}</Notice>}
      {saved && <Notice tone="success">Saved.</Notice>}
      <div class="form-grid">
        <Field label="Sender name" value={value.sender_name} onValue={(v) => set({ sender_name: v })} id="email-sender"
               hint="Shown as who it's from, and as {site} in the emails." placeholder="AstrologyStudio" />
        <Field label="Reply-to address" type="email" value={value.reply_to} onValue={(v) => set({ reply_to: v })} id="email-reply-to" />
      </div>
      <label class="field" for="email-accent">
        <span>Accent colour</span>
        <input id="email-accent" type="color" value={value.accent} onInput={(e) => set({ accent: e.currentTarget.value })} />
        <small class="muted">For buttons and links.</small>
      </label>
      <Checkbox label="Use the logo from Business details" checked={value.use_site_logo} onChecked={(v) => set({ use_site_logo: v })}
                hint="PNG, JPEG or WebP only: many mail programs can't show SVG." />
      <div class="actions">
        <label class="btn">
          {value.logo ? 'Change the email logo' : 'Upload a logo just for email'}
          <input type="file" accept="image/png,image/jpeg,image/webp" class="visually-hidden"
                 onChange={(e) => { pick(e.currentTarget.files?.[0]); e.currentTarget.value = ''; }} />
        </label>
        {value.logo && <><img src={value.logo} alt="" class="email-logo" /><Button onClick={() => set({ logo: null })}>Remove</Button></>}
      </div>
      <TextArea label="Footer" value={value.footer} onValue={(v) => set({ footer: v })} id="email-footer" rows={3}
                hint="An address or a short line. Links like [our site](https://…) work. The site's address is added after it." />
      <div class="actions"><Button type="submit" variant="primary" busy={busy}>Save the look</Button></div>
    </form>
  );
}

function TemplateEditor({ template, onSaved }: { template: EmailTemplate; onSaved: () => void }) {
  const [subject, setSubject] = useState(template.subject);
  const [body, setBody] = useState(template.body);
  const [enabled, setEnabled] = useState(template.enabled);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [dark, setDark] = useState(false);
  const [plain, setPlain] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const caught = (e: unknown) => setError(describe(e));

  // Preview as it's typed (a moment after the last key).
  useEffect(() => {
    const timer = setTimeout(() => {
      api<Preview>(`/email/templates/${template.key}/preview`, 'POST', { subject, body })
        .then((p) => { setPreview(p); setProblems([]); })
        .catch((e: unknown) => setProblems([e instanceof ApiError && e.detail ? e.detail : describe(e)]));
    }, 400);
    return () => clearTimeout(timer);
  }, [subject, body]);

  const { busy, onSubmit } = useSubmit(async () => {
    setNote(null);
    setError(null);
    try {
      await api(`/email/templates/${template.key}`, 'PUT', { subject, body, enabled });
      setNote('Saved.');
      onSaved();
    } catch (e) { caught(e); }
  });
  const test = () => {
    setNote(null);
    setError(null);
    api<{ to: string }>(`/email/templates/${template.key}/test`, 'POST', { subject, body })
      .then((r) => setNote(`Sent to ${r.to}.`)).catch(caught);
  };
  const reset = () => {
    if (!confirm('Put this email back to the original?')) return;
    api<EmailTemplate>(`/email/templates/${template.key}`, 'DELETE')
      .then((t) => { setSubject(t.subject); setBody(t.body); setEnabled(t.enabled); setNote('Back to the original.'); onSaved(); })
      .catch(caught);
  };
  return (
    <form class="form email-editor" onSubmit={onSubmit}>
      {error && <Notice tone="error">{error}</Notice>}
      {note && <Notice tone="success">{note}</Notice>}
      {template.optional && (
        <Checkbox label="Send this email" checked={enabled} onChecked={setEnabled} hint="Off unless you switch it on." />
      )}
      <div class="email-editor__grid">
        <div>
          <Field label="Subject" value={subject} onValue={setSubject} id={`subject-${template.key}`} required />
          <TextArea label="Body" value={body} onValue={setBody} id={`body-${template.key}`} rows={10} required
                    hint="Blank line: new paragraph. **bold**, *italic*, [text](https://…), and [[Button text|{link}]] on a line of its own." />
          <p class="muted small">
            You can use {template.placeholders.map((p) => `{${p}}`).join(' ')}
            {template.required.length > 0 && <>. Must include {template.required.map((p) => `{${p}}`).join(', ')}</>}.
          </p>
          {problems.length > 0 && <Notice tone="error">{problems.join(' ')}</Notice>}
        </div>
        <div class="email-preview">
          <div class="segmented" role="group" aria-label="Preview">
            <button type="button" class={!plain && !dark ? 'is-active' : ''} aria-pressed={!plain && !dark} onClick={() => { setPlain(false); setDark(false); }}>Light</button>
            <button type="button" class={!plain && dark ? 'is-active' : ''} aria-pressed={!plain && dark} onClick={() => { setPlain(false); setDark(true); }}>Dark</button>
            <button type="button" class={plain ? 'is-active' : ''} aria-pressed={plain} onClick={() => setPlain(true)}>Plain text</button>
          </div>
          {preview && <p class="small"><strong>{preview.subject}</strong></p>}
          {preview && (plain
            ? <pre class="email-preview__text">{preview.text}</pre>
            : <iframe class="email-preview__frame" title={`Preview of ${template.label}`} sandbox=""
                      srcdoc={dark ? preview.html_dark : preview.html} />)}
        </div>
      </div>
      <div class="actions">
        <Button type="submit" variant="primary" busy={busy}>Save</Button>
        <Button onClick={test}>Send me a test</Button>
        <Button onClick={reset}>Reset to default</Button>
      </div>
    </form>
  );
}
