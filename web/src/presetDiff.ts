/**
 * AstrologyStudio ·
 * web/src/presetDiff.ts
 *
 * Whether the chart screen still matches a preset. Pure, so it can be unit-tested.
 *
 * Copyright (c) 2026 Gavin Melhuish
 * MIT License; see LICENSE in the project root.
 * SPDX-License-Identifier: MIT
 */

import type { AppearanceView, PartnerRole, PartnerRoleKey, Preset, PresetBody, ProfileList, ViewTemplate } from './appearance';
import { reportOf } from './report';

/** Whether the setup now differs from the preset, in anything that preset's chart type uses.
 * A part the preset refers to that has since been deleted counts as its fallback. */
export function differs(preset: Preset, now: PresetBody, view: AppearanceView, profiles: ProfileList | null): boolean {
  if (preset.display !== now.display) return true;
  const layout = view.layouts.some((l) => l.id === preset.layout && l.display === preset.display) ? preset.layout : `${preset.display}:default`;
  if (layout !== now.layout) return true;
  if (preset.theme && view.themes.some((t) => t.id === preset.theme) && preset.theme !== now.theme) return true;
  if (preset.profile && profiles?.profiles.some((p) => p.id === preset.profile) && preset.profile !== now.profile) return true;
  if (now.display === 'dial' && preset.dial_size !== now.dial_size) return true;
  return reportOf(preset.panel) !== reportOf(now.panel);
}

// ---------------------------------------------------------------------------
// Presets as sets of views (1.12)

/** The parts of a view a preset keeps (types only, so this file stays pure). */
interface ViewLike {
  name: string | null;
  display: 'wheel' | 'hellenistic' | 'dial';
  dial_size: number;
  layout: string | null;
  report: ViewTemplate['report'];
  between: boolean;
  partner: { id: string; derived: boolean; parent?: string | null } | null;
  partner_name: string | null;
  partner_role: string | null;
}

/** The layout a view or template really uses: its own if it still exists, otherwise the fallback. */
export type LayoutResolver = (display: ViewTemplate['display'], id: string | null) => string;

/** A view as a preset keeps it. Chart 2 becomes a role: a chart worked out for now stays that
 * kind ("transits now"), any other chart is "ask each time" unless `exact` keeps that chart. */
export function templateOf(v: ViewLike, layout: LayoutResolver, exact = false): ViewTemplate {
  let partner: PartnerRole = { role: 'none' };
  if (v.partner) {
    if (exact) partner = { role: 'fixed', chart: { id: v.partner.id, derived: v.partner.derived, parent: v.partner.parent ?? null }, chart_name: v.partner_name };
    else if (v.partner_role) partner = { role: v.partner_role as PartnerRoleKey };
    else partner = { role: 'ask' };
  }
  return {
    name: v.name,
    display: v.display,
    dial_size: v.display === 'dial' ? v.dial_size : null,
    layout: layout(v.display, v.layout),
    report: v.report,
    between: v.between,
    partner,
  };
}

/** Whether two templates look the same: chart type, dial size, layout and whether there's a chart
 * 2. Report tab, Between and names don't count: you move between those all the time. */
export function sameLook(a: ViewTemplate, b: ViewTemplate, layout: LayoutResolver): boolean {
  return a.display === b.display
    && (a.display !== 'dial' || a.dial_size === b.dial_size)
    && layout(a.display, a.layout) === layout(b.display, b.layout)
    && (a.partner.role === 'none') === (b.partner.role === 'none');
}

/** Whether a chart's views have moved away from the preset that made them. */
export function viewsDiffer(preset: Preset, now: ViewTemplate[], layout: LayoutResolver): boolean {
  return preset.views.length !== now.length || preset.views.some((t, i) => !sameLook(t, now[i]!, layout));
}
