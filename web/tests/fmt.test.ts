/**
 * AstrologyStudio ·
 * web/tests/fmt.test.ts
 *
 * Unit tests:
 *
 * formatting of degrees, dates and offsets.
 *
 * Copyright (c) 2026 Gavin Melhuish
 * MIT License; see LICENSE in the project root.
 * SPDX-License-Identifier: MIT
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { angle, date, retroMark, setFormats, time } from '../src/fmt';

const base = { degrees: 'dm', date_format: 'ymd', time_format: '24', retro: 'symbol' } as const;

test('angles are rounded down, never up into the next sign', () => {
  setFormats({ ...base });
  assert.equal(angle(21.2333), "21°13'");
  assert.equal(angle(29.99999), "29°59'");
  setFormats({ ...base, degrees: 'dms' });
  assert.equal(angle(21.2425), `21°14'33"`);
  setFormats({ ...base, degrees: 'decimal' });
  assert.equal(angle(29.999), '29.99°');
  assert.equal(angle(-1.5), '1.50°');
});

test('dates and times in the chosen order and clock', () => {
  setFormats({ ...base, date_format: 'dmy', time_format: '12', retro: 'letter' });
  assert.equal(date('1985-06-12'), '12/06/1985');
  assert.equal(time('14:30'), '2:30 pm');
  assert.equal(time('00:05'), '12:05 am');
  assert.equal(time('12:00:00'), '12:00 pm');
  assert.equal(retroMark(), 'R');
  setFormats({ ...base, date_format: 'mdy' });
  assert.equal(date('1985-06-12'), '06/12/1985');
  assert.equal(date('not a date'), 'not a date');
  assert.equal(time('14:30:15'), '14:30');
  assert.equal(date(null), '');
});
