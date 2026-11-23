/**
 * AstrologyStudio ·
 * web/src/prefs.ts
 *
 * Remembered choices:
 *
 * how you left a screen is how you find it next time.
 *
 * Kept per person on the server (/preferences/remembered), so they follow you to any
 * browser. They're loaded when you log in, held here while you work, and saved back a
 * moment after each change. Each value is checked when read, so a stale or edited value
 * falls back to the default instead of breaking a screen. If saving fails, the choice
 * still lasts for the visit.
 *
 * The theme is also mirrored to a cookie in this browser, so the login page and the first
 * paint (see index.html) match the last person who used it.
 *
 * Copyright (c) 2026 Gavin Melhuish
 * MIT License; see LICENSE in the project root.
 * SPDX-License-Identifier: MIT
 */

import { useEffect, useState } from 'preact/hooks';
import { api, getCsrfToken } from './api';

const COOKIE_PREFIX = 'as_pref_';
const MAX_AGE = 60 * 60 * 24 * 365;
const CHANGED = 'astrologystudio:pref-changed';
const SAVE_DELAY = 600;
/** Choices mirrored to this browser as well, for screens shown before logging in. */
const MIRRORED = new Set(['theme']);
/** Set once this browser's old cookie choices have been handed to an account. */
const MIGRATED = 'migrated';

type Message = { key: string; raw: string | null };

/** Other tabs hear about changes here. */
const channel: BroadcastChannel | null = typeof BroadcastChannel === 'function' ? new BroadcastChannel('astrologystudio-prefs') : null;

/** The signed-in person's choices, as JSON text. */
const memory = new Map<string, string>();
/** Whether a person is signed in and their choices have been loaded. */
let signedIn = false;
/** Changes waiting to be saved. */
const pending = new Map<string, unknown>();
let timer: ReturnType<typeof setTimeout> | null = null;

function cookieEntries(): Array<[string, string]> {
  const found: Array<[string, string]> = [];
  for (const part of document.cookie.split(';')) {
    const item = part.trim();
    if (!item.startsWith(COOKIE_PREFIX)) continue;
    const eq = item.indexOf('=');
    try {
      found.push([item.slice(COOKIE_PREFIX.length, eq), decodeURIComponent(item.slice(eq + 1))]);
    } catch {
      /* unreadable: ignore */
    }
  }
  return found;
}

function readCookie(key: string): string | null {
  return cookieEntries().find(([k]) => k === key)?.[1] ?? null;
}

function writeCookie(key: string, raw: string | null): void {
  const secure = location.protocol === 'https:' ? '; Secure' : '';
  const value = raw === null ? '; Max-Age=0' : `; Max-Age=${MAX_AGE}`;
  document.cookie = `${COOKIE_PREFIX}${key}=${encodeURIComponent(raw ?? '')}; Path=/${value}; SameSite=Lax${secure}`;
}

function readRaw(key: string): string | null {
  const held = memory.get(key);
  if (held !== undefined) return held;
  // Before logging in (or for someone who never chose), only the browser's mirror counts.
  return !signedIn && MIRRORED.has(key) ? readCookie(key) : null;
}

function announce(key: string): void {
  window.dispatchEvent(new CustomEvent(CHANGED, { detail: key }));
}

function save(): void {
  timer = null;
  if (!signedIn || !pending.size) return;
  const values = Object.fromEntries(pending);
  pending.clear();
  api('/preferences/remembered', 'PATCH', { values }).catch(() => undefined);
}

/** Save straight away, even as the page closes. */
function flush(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  if (!signedIn || !pending.size) return;
  const values = Object.fromEntries(pending);
  pending.clear();
  const token = getCsrfToken();
  void fetch('/api/v1/preferences/remembered', {
    method: 'PATCH',
    keepalive: true,
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...(token ? { 'X-CSRF-Token': token } : {}) },
    body: JSON.stringify({ values }),
  }).catch(() => undefined);
}

addEventListener('pagehide', flush);
document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && flush());

channel?.addEventListener('message', (e: MessageEvent<Message>) => {
  if (!signedIn || !e.data || typeof e.data.key !== 'string') return;
  if (e.data.raw === null) memory.delete(e.data.key);
  else memory.set(e.data.key, e.data.raw);
  announce(e.data.key);
});

/**
 * After logging in: load this person's choices. The first time anyone logs in on a
 * browser that has choices from before they were kept per person, those are handed to
 * that account (unless it already has its own) and the cookies are cleared.
 */
export async function loadRemembered(): Promise<void> {
  let values: Record<string, unknown> = {};
  try {
    values = (await api<{ values: Record<string, unknown> }>('/preferences/remembered')).values;
  } catch {
    /* keep going with defaults; choices will still last for the visit */
  }
  memory.clear();
  for (const [key, value] of Object.entries(values)) memory.set(key, JSON.stringify(value));
  signedIn = true;

  if (readCookie(MIGRATED) === null) {
    const handed: Record<string, unknown> = {};
    for (const [key, raw] of cookieEntries()) {
      if (key === MIGRATED) continue;
      if (!memory.has(key)) {
        try {
          handed[key] = JSON.parse(raw);
          memory.set(key, raw);
        } catch {
          /* unreadable: drop it */
        }
      }
      if (!MIRRORED.has(key)) writeCookie(key, null);
    }
    writeCookie(MIGRATED, 'true');
    if (Object.keys(handed).length) await api('/preferences/remembered', 'PATCH', { values: handed }).catch(() => undefined);
  }

  for (const key of MIRRORED) {
    const raw = memory.get(key);
    if (raw !== undefined) writeCookie(key, raw);
  }
  for (const key of new Set([...memory.keys(), ...MIRRORED])) announce(key);
}

/** Before logging out: save anything waiting, then forget this person's choices. */
export async function forgetRemembered(): Promise<void> {
  if (timer) clearTimeout(timer);
  timer = null;
  const values = signedIn && pending.size ? Object.fromEntries(pending) : null;
  pending.clear();
  signedIn = false;
  memory.clear();
  for (const key of MIRRORED) announce(key);
  if (values) await api('/preferences/remembered', 'PATCH', { values }).catch(() => undefined);
}

/** Run `handler` whenever the choice called `key` changes (here, in another tab, or on logging in or out). */
export function onPrefChange(key: string, handler: () => void): void {
  window.addEventListener(CHANGED, (e) => (e as CustomEvent<string>).detail === key && handler());
}

export function getPref<T>(key: string, fallback: T, valid: (value: unknown) => value is T): T {
  const raw = readRaw(key);
  if (raw === null) return fallback;
  try {
    const value: unknown = JSON.parse(raw);
    return valid(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

export function hasPref(key: string): boolean {
  return readRaw(key) !== null;
}

export function setPref(key: string, value: unknown): void {
  const raw = JSON.stringify(value);
  if (memory.get(key) === raw) return;
  memory.set(key, raw);
  if (MIRRORED.has(key)) writeCookie(key, raw);
  announce(key);
  if (!signedIn) return;
  channel?.postMessage({ key, raw } satisfies Message);
  pending.set(key, value);
  if (timer) clearTimeout(timer);
  timer = setTimeout(save, SAVE_DELAY);
}

/**
 * Like useState, but remembered. Other screens using the same key, in this tab or
 * another one, update when it changes.
 */
export function usePref<T>(key: string, fallback: T, valid: (value: unknown) => value is T): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => getPref(key, fallback, valid));
  useEffect(() => {
    const reload = () => setValue(getPref(key, fallback, valid));
    const changed = (e: Event) => (e as CustomEvent<string>).detail === key && reload();
    window.addEventListener(CHANGED, changed);
    reload();
    return () => window.removeEventListener(CHANGED, changed);
  }, [key]);
  return [value, (next: T) => {
    setValue(next);
    setPref(key, next);
  }];
}

/** Validators for the common shapes. */
export const oneOf = <T extends string>(...options: T[]) =>
  (value: unknown): value is T => typeof value === 'string' && (options as string[]).includes(value);
export const isBoolean = (value: unknown): value is boolean => typeof value === 'boolean';
export const isString = (value: unknown): value is string => typeof value === 'string';
