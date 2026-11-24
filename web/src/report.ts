/**
 * AstrologyStudio ·
 * web/src/report.ts
 *
 * The chart screen's report tabs. Pure, so it can be unit-tested.
 *
 * Copyright (c) 2026 Gavin Melhuish
 * MIT License; see LICENSE in the project root.
 * SPDX-License-Identifier: MIT
 */

/** The chart screen's reports, in the tabs across the top of every chart. One at a time. */
export type Report = 'chart' | 'overview' | 'aspects' | 'midpoints' | 'hellenistic' | 'events';
export const isReport = (v: unknown): v is Report =>
  v === 'chart' || v === 'overview' || v === 'aspects' || v === 'midpoints' || v === 'hellenistic' || v === 'events';

/** Which report a preset's panel switches mean (presets keep the switches from before the tabs). */
export function reportOf(panel: { aspectarian: boolean; trees: boolean; timing: boolean }): Report {
  return panel.aspectarian ? 'aspects' : panel.trees ? 'midpoints' : panel.timing ? 'hellenistic' : 'chart';
}
