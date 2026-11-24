/**
 * AstrologyStudio ·
 * web/src/pages/LogoSettings.tsx
 *
 * Settings → Business details and logo (owner only):
 *
 * the business or contact details, as free text, and the logo. The logo goes in the bottom right of
 * saved chart images; both print in a box at the bottom right of client sheets. Large pictures are
 * scaled down here before they're sent.
 *
 * Copyright (c) 2026 Gavin Melhuish
 * MIT License; see LICENSE in the project root.
 * SPDX-License-Identifier: MIT
 */

import { useState } from 'preact/hooks';
import { Button, describe, Notice } from '../ui';
import { removeLogo, saveDetails, saveLogo, useBranding } from '../branding';

const TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'];
const LARGEST_SIDE = 800;
const MAX_BYTES = 1024 * 1024;

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("That file couldn't be read"));
    reader.readAsDataURL(file);
  });
}

/** A picture bigger than it needs to be is redrawn smaller (as PNG, which keeps transparency). */
async function prepare(file: File): Promise<string> {
  const original = await readAsDataUrl(file);
  if (file.type === 'image/svg+xml') {
    if (file.size > MAX_BYTES) throw new Error('Use an SVG under 1 MB');
    return original;
  }
  const img = new Image();
  img.src = original;
  await img.decode().catch(() => { throw new Error("That picture couldn't be opened"); });
  const scale = Math.min(1, LARGEST_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
  if (scale === 1 && file.size <= MAX_BYTES) return original;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.naturalWidth * scale);
  canvas.height = Math.round(img.naturalHeight * scale);
  canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/png');
}

const MAX_DETAILS = 1000;

export function LogoSettings() {
  const branding = useBranding();
  const logo = branding?.logo ?? null;
  const [details, setDetails] = useState<string | null>(null);
  const shownDetails = details ?? branding?.details ?? '';
  const changed = details !== null && details !== (branding?.details ?? '');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);

  const choose = async (input: HTMLInputElement) => {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    setMessage(null);
    if (!TYPES.includes(file.type)) {
      setMessage({ tone: 'error', text: 'Use a PNG, JPEG, WebP or SVG picture.' });
      return;
    }
    setBusy(true);
    try {
      await saveLogo(await prepare(file));
      setMessage({ tone: 'success', text: 'Saved. It will be on chart images and client sheets from now on.' });
    } catch (e) {
      setMessage({ tone: 'error', text: describe(e) });
    } finally {
      setBusy(false);
    }
  };

  const keepDetails = async () => {
    setBusy(true);
    setMessage(null);
    try {
      await saveDetails(shownDetails);
      setDetails(null);
      setMessage({ tone: 'success', text: 'Saved. Your details will print on client sheets.' });
    } catch (e) {
      setMessage({ tone: 'error', text: describe(e) });
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!confirm('Remove the logo from chart images and client sheets?')) return;
    setBusy(true);
    try {
      await removeLogo();
      setMessage(null);
    } catch (e) {
      setMessage({ tone: 'error', text: describe(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section class="card form-card logo-card">
      <h2>Business details and logo</h2>
      <p class="muted">
        Printed in a box at the bottom right of every client sheet, for everyone on this install. The logo also
        goes in the bottom right of saved chart images (PNG and SVG).
      </p>
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      <label class="field" for="business-details">
        <span>Business details</span>
        <textarea id="business-details" rows={6} maxLength={MAX_DETAILS} value={shownDetails}
                  placeholder={'Your business name\nYour name and title\nPhone · email\nWebsite'}
                  onInput={(e) => setDetails(e.currentTarget.value)} />
        <small class="muted">Type it as you'd like it printed, line by line: your name, business, address, phone, email,
          website. {shownDetails.length}/{MAX_DETAILS}</small>
      </label>
      <div class="actions">
        <Button variant="primary" onClick={() => void keepDetails()} disabled={busy || !changed}>Save details</Button>
      </div>
      <h3 class="logo-card__subhead">Logo</h3>
      <p class="muted small">PNG, JPEG, WebP or SVG; a wide logo on a transparent background works best.</p>
      <div class="logo-card__preview">
        {logo ? <img src={logo} alt="Your logo" /> : <span class="muted">No logo yet</span>}
      </div>
      <div class="actions">
        <label class="btn btn--primary logo-card__pick" aria-disabled={busy}>
          {logo ? 'Replace logo…' : 'Upload logo…'}
          <input
            type="file"
            accept={TYPES.join(',')}
            class="visually-hidden"
            disabled={busy}
            aria-label="Logo file"
            onChange={(e) => void choose(e.currentTarget)}
          />
        </label>
        {logo && <Button variant="danger" onClick={() => void remove()} disabled={busy}>Remove</Button>}
      </div>
    </section>
  );
}
