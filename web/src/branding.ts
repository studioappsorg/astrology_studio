/**
 * AstrologyStudio ·
 * web/src/branding.ts
 *
 * The business details and logo (Settings → Business details and logo):
 *
 * set by the owner. The logo goes on saved chart images; both go in a box on client sheets. The
 * logo arrives as a data URL, so it can be put straight into an exported SVG or PNG without
 * fetching anything.
 *
 * Copyright (c) 2026 Gavin Melhuish
 * MIT License; see LICENSE in the project root.
 * SPDX-License-Identifier: MIT
 */

import { useEffect, useState } from 'preact/hooks';
import { api } from './api';

export interface Branding {
  logo: string | null;
  /** Free text, as it should print: name, address, phone, website... */
  details: string;
}

let current: Branding | null = null;
let loading: Promise<Branding> | null = null;
const listeners = new Set<(b: Branding) => void>();

function publish(b: Branding): Branding {
  current = b;
  listeners.forEach((l) => l(b));
  return b;
}

export function loadBranding(): Promise<Branding> {
  if (!loading) {
    loading = api<Branding>('/branding').then(publish);
    loading.catch(() => { loading = null; });
  }
  return loading;
}

/** The logo as a data URL; null when there isn't one (or before it has loaded). */
export function useLogo(): string | null {
  return useBranding()?.logo ?? null;
}

/** The logo and the business details; null until they have loaded. */
export function useBranding(): Branding | null {
  const [value, setValue] = useState(current);
  useEffect(() => {
    listeners.add(setValue);
    if (!current) loadBranding().catch(() => undefined);
    return () => { listeners.delete(setValue); };
  }, []);
  return value;
}

export async function saveDetails(details: string): Promise<void> {
  publish(await api<Branding>('/branding/details', 'PUT', { details }));
}

/** The logo for an export: waits for it if it hasn't loaded yet. */
export async function currentLogo(): Promise<string | null> {
  try {
    return (current ?? (await loadBranding())).logo;
  } catch {
    return null;
  }
}

export async function saveLogo(dataUrl: string): Promise<void> {
  publish(await api<Branding>('/branding/logo', 'PUT', { data_url: dataUrl }));
}

export async function removeLogo(): Promise<void> {
  await api('/branding/logo', 'DELETE');
  publish({ logo: null, details: current?.details ?? '' });
}

/** Forget it (logging out). */
export function resetBranding(): void {
  current = null;
  loading = null;
}
