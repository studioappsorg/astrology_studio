/**
 * AstrologyStudio ·
 * web/src/components/Activity.tsx
 *
 * The activity log (logins, codes, sign-ups, password and key changes, and what the owner did),
 * newest first, with All / Failures only and Load more. Also the limits boxes and the "37 of 100
 * today" usage lines, shared by the user window, Settings and Your account.
 *
 * Copyright (c) 2026 Gavin Melhuish
 * MIT License; see LICENSE in the project root.
 * SPDX-License-Identifier: MIT
 */

import { useEffect, useState } from 'preact/hooks';
import { api, PERIODS, type ActivityEvent, type ActivityPage, type Limits, type Period, type Usage } from '../api';
import { describe, Field, formatDate, Notice } from '../ui';

const EVENTS: Record<string, string> = {
  login: 'Log in',
  login_code: 'Emailed code',
  trusted_device: 'Trusted browser',
  registration: 'Sign-up',
  registration_complete: 'Sign-up finished',
  logout: 'Log out',
  session_ended: 'Logged out',
  password_changed: 'Password changed',
  password_reset: 'Password reset',
  key_saved: 'Key saved',
  key_switched: 'Key switched',
  key_forgotten: 'Key forgotten',
  key_replaced: 'Key replaced',
  key_shown: 'Key shown',
  reauth: 'Confirmed it was them',
  disabled: 'Switched off',
  enabled: 'Switched on',
  limits_changed: 'Limits changed',
  limit_reached: 'Limit reached',
  email_failed: "Email couldn't be sent",
};

const OUTCOMES: Record<string, string> = {
  success: 'OK',
  'bad-password': 'Wrong password',
  'bad-code': 'Wrong code',
  throttled: 'Too many tries',
  disabled: 'Account switched off',
  'password-not-set': 'Password not set yet',
  'code-sent': 'Code sent',
  'code-skipped': 'Code skipped',
  requested: 'Asked for',
  completed: 'Done',
  'link-expired': 'Link expired',
  'by-person': 'By them',
  'by-owner': 'By the owner',
  'by-disabling': 'Switched off',
  done: 'Done',
  'not-saved': "Couldn't be saved",
  hour: 'This hour',
  day: 'Today',
  week: 'This week',
  month: 'This month',
};

export const PERIOD_LABELS: Record<Period, string> = { hour: 'Per hour', day: 'Per day', week: 'Per week', month: 'Per month' };
const PERIOD_NOW: Record<Period, string> = { hour: 'this hour', day: 'today', week: 'this week', month: 'this month' };

export function Activity({ path, everyone = false }: { path: string; everyone?: boolean }) {
  const [failures, setFailures] = useState(false);
  const [events, setEvents] = useState<ActivityEvent[] | null>(null);
  const [next, setNext] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = (before: number | null, reset: boolean) => {
    const query = new URLSearchParams();
    if (before) query.set('before', String(before));
    if (failures) query.set('failures', 'true');
    api<ActivityPage>(`${path}?${query}`)
      .then((page) => { setEvents((shown) => [...(reset || !shown ? [] : shown), ...page.data]); setNext(page.next); })
      .catch((e: unknown) => setError(describe(e)));
  };
  useEffect(() => { setEvents(null); load(null, true); }, [path, failures]);
  return (
    <div class="activity">
      <div class="segmented" role="group" aria-label="Show">
        <button type="button" aria-pressed={!failures} class={!failures ? 'is-active' : ''} onClick={() => setFailures(false)}>All</button>
        <button type="button" aria-pressed={failures} class={failures ? 'is-active' : ''} onClick={() => setFailures(true)}>Failures only</button>
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      {events && events.length === 0 && <p class="muted">Nothing yet.</p>}
      {events && events.length > 0 && (
        <table class="table activity__table">
          <thead>
            <tr><th>When</th>{everyone && <th>Who</th>}<th>What</th><th>Result</th><th>From</th></tr>
          </thead>
          <tbody>
            {events.map((e) => (
              <tr key={e.id} class={e.failed ? 'is-failed' : ''}>
                <td>{formatDate(e.at)}</td>
                {everyone && <td>{e.email || '—'}{e.user_id === null && <span class="muted small"> (no account)</span>}</td>}
                <td>{EVENTS[e.event] ?? e.event}{e.detail && <span class="muted small"> · {e.detail}</span>}</td>
                <td>{OUTCOMES[e.outcome] ?? e.outcome}</td>
                <td class="small" title={e.user_agent}>{e.ip || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {next && <button type="button" class="btn" onClick={() => load(next, false)}>Load more</button>}
    </div>
  );
}

/** "37 of 100 today", one line a period. */
export function UsageLines({ usage }: { usage: Usage }) {
  return (
    <ul class="usage">
      {PERIODS.map((p) => {
        const { used, limit } = usage.periods[p];
        return (
          <li key={p} class={limit !== null && used >= limit ? 'is-full' : ''}>
            {limit === null ? `${used.toLocaleString()} ${PERIOD_NOW[p]} (no limit)` : `${used.toLocaleString()} of ${limit.toLocaleString()} ${PERIOD_NOW[p]}`}
          </li>
        );
      })}
    </ul>
  );
}

export function emptyLimits(): Limits {
  return { hour: null, day: null, week: null, month: null };
}

/** Four boxes; empty means no limit. */
export function LimitFields({ value, onValue, idPrefix, disabled }: {
  value: Limits; onValue: (next: Limits) => void; idPrefix: string; disabled?: boolean;
}) {
  return (
    <div class="form-grid limits-grid">
      {PERIODS.map((p) => (
        <Field key={p} label={PERIOD_LABELS[p]} id={`${idPrefix}-${p}`} type="number" inputMode="numeric"
               value={value[p] === null ? '' : String(value[p])} disabled={disabled} placeholder="No limit"
               onValue={(v) => onValue({ ...value, [p]: v.trim() === '' ? null : Math.max(0, Math.floor(Number(v))) })} />
      ))}
    </div>
  );
}
