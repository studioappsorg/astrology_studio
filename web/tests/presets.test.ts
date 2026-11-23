/**
 * AstrologyStudio ·
 * web/tests/presets.test.ts
 *
 * Unit tests:
 *
 * presets and the views they make.
 *
 * Copyright (c) 2026 Gavin Melhuish
 * MIT License; see LICENSE in the project root.
 * SPDX-License-Identifier: MIT
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AppearanceView, Preset } from '../src/appearance';
import { differs, sameLook, templateOf, viewsDiffer, type LayoutResolver } from '../src/presetDiff';

const view = {
  layouts: [{ id: 'wheel:default', display: 'wheel' }, { id: 'lay_1', display: 'wheel' }, { id: 'dial:default', display: 'dial' }],
  themes: [{ id: 'studio' }, { id: 'classic' }],
} as unknown as AppearanceView;
const profiles = { active: 'standard', profiles: [{ id: 'standard', name: 'Standard' }, { id: 'ws', name: 'Whole sign' }] };
const preset: Preset = {
  id: 'p', name: 'Natal', display: 'wheel', dial_size: null, layout: 'lay_1', theme: 'classic', profile: 'ws',
  panel: { aspectarian: true, trees: false, timing: false },
  views: [{ name: null, display: 'wheel', dial_size: null, layout: 'lay_1', report: 'aspects', between: false, partner: { role: 'none' } }],
};
const { views: _views, ...now } = { ...preset, name: '', profile: 'ws' };

test('a preset matches the screen it saved', () => {
  assert.equal(differs(preset, now, view, profiles), false);
});

test('changing what the preset sets marks it changed', () => {
  assert.equal(differs(preset, { ...now, theme: 'studio' }, view, profiles), true);
  assert.equal(differs(preset, { ...now, panel: { ...now.panel, aspectarian: false } }, view, profiles), true);
  assert.equal(differs(preset, { ...now, display: 'dial', dial_size: 90 }, view, profiles), true);
});

test('what a chart type doesn’t use doesn’t count', () => {
  assert.equal(differs(preset, { ...now, panel: { ...now.panel, trees: true, timing: true } }, view, profiles), false);
});

test('a deleted layout, theme or profile counts as its fallback, not as a change', () => {
  const gone = { ...preset, layout: 'lay_deleted', theme: 'thm_deleted', profile: 'prf_deleted' };
  assert.equal(differs(gone, { ...now, layout: 'wheel:default', theme: 'studio', profile: 'standard' }, view, profiles), false);
});

test('the report tab in use counts, one report at a time', () => {
  assert.equal(differs(preset, { ...now, panel: { aspectarian: false, trees: true, timing: false } }, view, profiles), true);
  assert.equal(differs(preset, { ...now, panel: { aspectarian: false, trees: false, timing: false } }, view, profiles), true);
});

const layout: LayoutResolver = (display, id) => (id && view.layouts.some((l) => l.id === id && l.display === display) ? id : `${display}:default`);
const v = (extra: object = {}) => ({
  name: null, display: 'wheel' as const, dial_size: 90, layout: null, report: 'chart' as const, between: false,
  partner: null, partner_name: null, partner_role: null, ...extra,
});

test('a view as a preset keeps it: chart 2 becomes a role', () => {
  assert.deepEqual(templateOf(v(), layout).partner, { role: 'none' });
  assert.deepEqual(templateOf(v({ partner: { id: 'c2', derived: false } }), layout).partner, { role: 'ask' });
  assert.deepEqual(templateOf(v({ partner: { id: 't1', derived: true, parent: 'c1' }, partner_role: 'transits_now' }), layout).partner, { role: 'transits_now' });
  const fixed = templateOf(v({ partner: { id: 'c2', derived: false }, partner_name: 'John' }), layout, true).partner;
  assert.equal(fixed.role, 'fixed');
  assert.equal(fixed.chart_name, 'John');
  assert.equal(templateOf(v({ display: 'dial', dial_size: 45 }), layout).dial_size, 45);
  assert.equal(templateOf(v(), layout).dial_size, null);
  assert.equal(templateOf(v({ layout: 'gone' }), layout).layout, 'wheel:default');
});

test('views differ from a preset by look, not by report tab', () => {
  const set: Preset = { ...preset, views: [templateOf(v(), layout), templateOf(v({ display: 'dial' }), layout)] };
  assert.equal(viewsDiffer(set, [templateOf(v({ report: 'aspects' }), layout), templateOf(v({ display: 'dial', between: true }), layout)], layout), false);
  assert.equal(viewsDiffer(set, [templateOf(v(), layout)], layout), true);
  assert.equal(viewsDiffer(set, [templateOf(v(), layout), templateOf(v({ display: 'dial', dial_size: 45 }), layout)], layout), true);
  assert.equal(sameLook(templateOf(v(), layout), templateOf(v({ partner: { id: 'x', derived: false } }), layout), layout), false);
});
