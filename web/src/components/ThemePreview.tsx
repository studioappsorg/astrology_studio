/**
 * AstrologyStudio ·
 * web/src/components/ThemePreview.tsx
 *
 * A theme (and optionally a layout) shown on the made-up sample chart, without changing
 * anything else on the page: the theme's colours are set on this element only.
 *
 * Copyright (c) 2026 Gavin Melhuish
 * MIT License; see LICENSE in the project root.
 * SPDX-License-Identifier: MIT
 */

import type { LayoutOptions, Theme } from '../appearance';
import { ChartStyleContext, chartStyleOf, tokenVars, useAppearance } from '../appearance';
import type { Theme as Mode } from '../theme';
import { useGlyphs } from '../pages/ChartView';
import { SAMPLE_ASPECTS, SAMPLE_HOUSES, SAMPLE_KEYS, SAMPLE_OUTER, SAMPLE_POINTS } from '../sample';
import { Dial } from './Dial';
import { Wheel } from './Wheel';

export function ThemePreview({ theme, mode, show = 'wheel', wheelOptions, dialOptions, hellenistic, twoRings, label }: {
  theme: Theme; mode: Mode; show?: 'wheel' | 'dial' | 'both';
  wheelOptions?: LayoutOptions | null; dialOptions?: LayoutOptions | null;
  /** Hellenistic aspects (hover only) by default. */
  hellenistic?: boolean;
  /** Add a second ring (chart 2) to the wheel. */
  twoRings?: boolean;
  label?: string;
}) {
  const { appearance } = useAppearance();
  const glyphs = useGlyphs();
  const rings = [{ points: SAMPLE_POINTS, keys: SAMPLE_KEYS }, ...(twoRings ? [{ points: SAMPLE_OUTER, keys: Object.keys(SAMPLE_OUTER) }] : [])];
  const noop = () => undefined;
  return (
    <div class={`themed theme-preview theme-preview--${show}`} style={tokenVars(theme, mode)} aria-label={label ?? `${theme.name} preview`}>
      <ChartStyleContext.Provider value={chartStyleOf(theme, appearance)}>
        {show !== 'dial' && (
          <div class="theme-preview__chart">
            <Wheel rings={rings} houses={SAMPLE_HOUSES} aspects={SAMPLE_ASPECTS} glyphs={glyphs}
                   options={wheelOptions ?? (hellenistic ? { aspects: 'hover' } : null)} title={`${theme.name} chart wheel`} />
          </div>
        )}
        {show !== 'wheel' && (
          <div class="theme-preview__chart">
            <Dial modulus={90} rings={rings.slice(0, 1)} pointer={SAMPLE_POINTS.sun!.lon % 90} onPointer={noop} half glyphs={glyphs}
                  options={dialOptions} />
          </div>
        )}
      </ChartStyleContext.Provider>
    </div>
  );
}
