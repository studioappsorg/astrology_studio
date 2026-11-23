/**
 * AstrologyStudio ·
 * web/src/derivedNow.ts
 *
 * Charts worked out for now from a chart:
 *
 * transits now, progressions or solar arc to today, the current year's solar return or this
 * month's lunar return. Used by ＋ View and by presets.
 *
 * Copyright (c) 2026 Gavin Melhuish
 * MIT License; see LICENSE in the project root.
 * SPDX-License-Identifier: MIT
 */

import { api, type DerivedDetail } from './api';
import type { SlotRef } from './components/ChartSlots';
import type { NowRole } from './views';

const pad = (n: number) => String(n).padStart(2, '0');
const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const nowHm = () => { const d = new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };

export type NowKind = 'transits' | 'progressed' | 'solar_arc' | 'solar_return' | 'lunar_return';

/** Each kind of chart worked out for now, as a preset's chart 2 role. */
export const NOW_ROLE: Record<NowKind, NowRole> = {
  transits: 'transits_now',
  progressed: 'progressions_now',
  solar_arc: 'solar_arc_now',
  solar_return: 'solar_return_next',
  lunar_return: 'lunar_return_next',
};
export const ROLE_KIND: Record<NowRole, NowKind> = {
  transits_now: 'transits',
  progressions_now: 'progressed',
  solar_arc_now: 'solar_arc',
  solar_return_next: 'solar_return',
  lunar_return_next: 'lunar_return',
};

/** Work out a chart for now from `parent` (transits now, progressions or solar arc to today, the
 * current year's solar return or this month's lunar return). It's kept in ephemeralREST and listed
 * under its chart, like one made from Change → Derived chart. */
export async function derivedNow(parent: string, kind: NowKind): Promise<SlotRef & { name: string | null }> {
  const now = new Date();
  const body: Record<string, unknown> = { kind, place: '' };
  if (kind === 'transits' || kind === 'progressed' || kind === 'solar_arc') body.date = todayIso();
  if (kind === 'transits') body.time = nowHm();
  else body.year = now.getFullYear();
  if (kind === 'lunar_return') body.month = now.getMonth() + 1;
  const made = await api<DerivedDetail>(`/charts/${parent}/derived`, 'POST', body);
  return { id: made.id, derived: true, parent, name: made.name ?? null };
}

