/**
 * AstrologyStudio ·
 * web/src/frame/layout.ts
 *
 * The frame's own choices:
 *
 * whether the status bar shows, and finding a chart (Ctrl+K, File → Open chart), which opens the
 * chart library with the cursor in its search.
 *
 * Copyright (c) 2026 Gavin Melhuish
 * MIT License; see LICENSE in the project root.
 * SPDX-License-Identifier: MIT
 */

import { isBoolean, usePref } from '../prefs';
import { navigate } from '../router';

const FIND = 'astrologystudio:find-chart';
let findWaiting = false;

export function useStatusBar(): [boolean, (on: boolean) => void] {
  return usePref<boolean>('frame-status-bar', true, isBoolean);
}

/** Open the chart library and put the cursor in its search. */
export function findChart(): void {
  findWaiting = true;
  navigate('/charts');
  window.dispatchEvent(new Event(FIND));
}

/** For the chart library: focus its search now if asked (it may have just opened), and whenever asked again. */
export function onFindChart(handler: () => void): () => void {
  const run = () => { findWaiting = false; requestAnimationFrame(handler); };
  if (findWaiting) run();
  window.addEventListener(FIND, run);
  return () => window.removeEventListener(FIND, run);
}
