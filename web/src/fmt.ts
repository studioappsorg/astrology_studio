/**
 * AstrologyStudio ·
 * web/src/fmt.ts
 *
 * How degrees, dates, times and the retrograde mark are written, as each person chooses in
 * My View → Appearance. Set once by the appearance provider; every screen reads it here.
 *
 * Copyright (c) 2026 Gavin Melhuish
 * MIT License; see LICENSE in the project root.
 * SPDX-License-Identifier: MIT
 */

export interface Formats {
  degrees: 'dm' | 'dms' | 'decimal';
  date_format: 'ymd' | 'dmy' | 'mdy';
  time_format: '24' | '12';
  retro: 'symbol' | 'letter';
}

const formats: Formats = { degrees: 'dm', date_format: 'ymd', time_format: '24', retro: 'symbol' };

export function setFormats(next: Formats): void {
  Object.assign(formats, next);
}

export function getFormats(): Formats {
  return { ...formats };
}

/** An angle as chosen: 24°06', 24°06'32" or 24.11°. Always rounded down, so 29°59' stays in its sign. */
export function angle(value: number): string {
  const abs = Math.abs(value);
  if (formats.degrees === 'decimal') {
    const hundredths = Math.floor(abs * 100 + 1e-7);
    return `${Math.floor(hundredths / 100)}.${String(hundredths % 100).padStart(2, '0')}°`;
  }
  if (formats.degrees === 'dms') {
    const total = Math.floor(abs * 3600 + 1e-6);
    const d = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    return `${d}°${String(m).padStart(2, '0')}'${String(total % 60).padStart(2, '0')}"`;
  }
  const total = Math.floor(abs * 60 + 1e-7);
  return `${Math.floor(total / 60)}°${String(total % 60).padStart(2, '0')}'`;
}

/** The retrograde mark: ℞ or R. */
export const retroMark = (): string => (formats.retro === 'letter' ? 'R' : '℞');

/** A calendar date (YYYY-MM-DD) in the chosen order. Anything else is shown as it is. */
export function date(iso: string | null | undefined): string {
  if (!iso) return '';
  const m = /^(-?\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const [, y, mo, d] = m;
  if (formats.date_format === 'dmy') return `${d}/${mo}/${y}`;
  if (formats.date_format === 'mdy') return `${mo}/${d}/${y}`;
  return iso;
}

/** A clock time (HH:MM or HH:MM:SS) in 24-hour or 12-hour form. */
export function time(hhmm: string | null | undefined): string {
  if (!hhmm) return '';
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(hhmm);
  if (!m || formats.time_format === '24') return hhmm.slice(0, 5);
  const h = Number(m[1]);
  return `${h % 12 === 0 ? 12 : h % 12}:${m[2]} ${h < 12 ? 'am' : 'pm'}`;
}
