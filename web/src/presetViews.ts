/**
 * AstrologyStudio ·
 * web/src/presetViews.ts
 *
 * Presets as sets of views (1.12): making a chart's views from a preset, and a preset from a
 * chart's views. Chart 2 in a preset is a role: none, ask each time, a chart worked out for now
 * (transits, progressions, solar arc, this year's solar return, this month's lunar return), or one
 * particular chart.
 *
 * Copyright (c) 2026 Gavin Melhuish
 * MIT License; see LICENSE in the project root.
 * SPDX-License-Identifier: MIT
 */

import type { Layout, Preset, ViewTemplate } from './appearance';
import { derivedNow, ROLE_KIND } from './derivedNow';
import type { LayoutResolver } from './presetDiff';
import { getPref } from './prefs';
import { defaultView, newViewId, type NowRole, type View } from './views';

/** The layout a view uses: its own if it still exists, else your default for that chart type. */
export function layoutResolver(layouts: Layout[]): LayoutResolver {
  return (display, id) => {
    if (id && layouts.some((l) => l.id === id && l.display === display)) return id;
    const chosen = getPref<string>(`canvas-layout-${display}`, `${display}:default`, (v): v is string => typeof v === 'string');
    const fallback = chosen === 'default' ? `${display}:default` : chosen;
    return layouts.some((l) => l.id === fallback) ? fallback : `${display}:default`;
  };
}

export interface Built {
  views: View[];
  /** Things the preset refers to that are switched off or gone, said when it's used. */
  missing: string[];
}

/** A chart's views from a preset's templates. `parent` is the chart (chart 1); charts worked out for
 * now are made from it straight away. Views whose chart type is switched off use the chart wheel. */
export async function viewsFromPreset(preset: Preset, parent: string, feature: (key: string) => boolean, layouts: Layout[]): Promise<Built> {
  const missing = new Set<string>();
  const views: View[] = [];
  for (const t of preset.views) {
    let display = t.display;
    if ((display === 'dial' && !feature('dials')) || (display === 'hellenistic' && !feature('hellenistic'))) {
      missing.add(`the ${display === 'dial' ? 'dial' : 'Hellenistic chart'} is switched off in My View, so the chart wheel is used`);
      display = 'wheel';
    }
    const layout = t.layout && layouts.some((l) => l.id === t.layout && l.display === display) ? t.layout : null;
    if (t.layout && !layout && display === t.display) missing.add('a layout it uses has been deleted, so your default layout is used');
    const view: View = {
      ...defaultView(),
      id: newViewId(),
      name: t.name,
      display,
      dial_size: display === 'dial' && t.dial_size ? t.dial_size : getPref<number>('dial-modulus', 90, (v): v is number => typeof v === 'number'),
      layout,
      report: t.report === 'hellenistic' && !feature('hellenistic') ? 'chart' : t.report,
      between: t.between,
    };
    const role = t.partner.role;
    if (role === 'ask') view.ask = true;
    else if (role === 'fixed' && t.partner.chart) {
      view.partner = { id: t.partner.chart.id, derived: t.partner.chart.derived, ...(t.partner.chart.parent ? { parent: t.partner.chart.parent } : {}) };
      view.partner_name = t.partner.chart_name ?? null;
    } else if (role !== 'none' && role !== 'fixed') {
      try {
        const { name, ...ref } = await derivedNow(parent, ROLE_KIND[role as NowRole]);
        view.partner = ref;
        view.partner_name = name;
        view.partner_role = role as NowRole;
      } catch {
        missing.add('a chart 2 it works out for now couldn\'t be calculated');
      }
    }
    if (view.partner || view.ask) view.selected = 1;
    views.push(view);
  }
  return { views, missing: [...missing] };
}

/** Apply a one-view preset to the view on screen: its look, report and (unless it has none) chart 2. */
export function patchFromTemplate(t: ViewTemplate, built: View): Partial<View> {
  const patch: Partial<View> = {
    display: built.display, dial_size: built.dial_size, layout: built.layout, report: built.report, between: built.between,
  };
  if (t.partner.role !== 'none') {
    Object.assign(patch, { partner: built.partner, partner_name: built.partner_name, partner_role: built.partner_role, ask: built.ask, selected: built.selected });
  }
  return patch;
}
