/**
 * AstrologyStudio ·
 * web/src/defaults.ts
 *
 * Your defaults (Settings → Defaults):
 *
 * the house system profiles use unless they have their own, and the place new charts start with
 * and transits and returns are worked out for.
 *
 * Copyright (c) 2026 Gavin Melhuish
 * MIT License; see LICENSE in the project root.
 * SPDX-License-Identifier: MIT
 */

import { useEffect, useState } from 'preact/hooks';
import { api } from './api';

export interface Defaults {
  house_system: string;
  /** "" when none is set. */
  place: string;
}

let current: Defaults | null = null;
let loading: Promise<Defaults> | null = null;
const listeners = new Set<(d: Defaults) => void>();

function publish(d: Defaults): Defaults {
  current = d;
  listeners.forEach((l) => l(d));
  return d;
}

export function loadDefaults(): Promise<Defaults> {
  if (!loading) {
    loading = api<Defaults>('/preferences/defaults').then(publish);
    loading.catch(() => { loading = null; });
  }
  return loading;
}

/** Your defaults, or null until they've loaded. */
export function useDefaults(): Defaults | null {
  const [value, setValue] = useState(current);
  useEffect(() => {
    listeners.add(setValue);
    if (!current) loadDefaults().catch(() => undefined);
    return () => { listeners.delete(setValue); };
  }, []);
  return value;
}

export async function saveDefaults(change: Partial<Defaults>): Promise<Defaults> {
  return publish(await api<Defaults>('/preferences/defaults', 'PUT', change));
}

/** Forget them (logging out). */
export function resetDefaults(): void {
  current = null;
  loading = null;
}
