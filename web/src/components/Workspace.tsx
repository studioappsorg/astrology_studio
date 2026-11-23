/**
 * AstrologyStudio ·
 * web/src/components/Workspace.tsx
 *
 * The chart workspace:
 *
 * one panel on the left holding everything you read and set, and the chart or dial (or a report
 * about it) filling the rest of the screen, with an optional bar of tabs across the top of the
 * chart side and things docked on the stage under it. Drag the edge between them (or focus it and
 * use the arrow keys) to resize the panel; double-click puts it back. The width is remembered.
 *
 * Copyright (c) 2026 Gavin Melhuish
 * MIT License; see LICENSE in the project root.
 * SPDX-License-Identifier: MIT
 */

import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { getPref, setPref, usePref } from '../prefs';
import { useTheme } from '../theme';

const KEY = 'panel-width';
const DEFAULT = 400;
const MIN = 300;
const MAX = 760;
const isWidth = (v: unknown): v is number => typeof v === 'number' && v >= MIN && v <= MAX;

export function Workspace({ panel, children, stageFooter, bar, above, dock, report }: {
  panel: ComponentChildren;
  children: ComponentChildren;
  stageFooter?: ComponentChildren;
  /** A bar across the top of the stage only (the chart screen's report tabs); the panel runs up past it. */
  bar?: ComponentChildren;
  /** A row over the bar (the chart's views, when it has more than one). */
  above?: ComponentChildren;
  /** Things that sit on the stage under the bar: left and right of the chart, or above a report. */
  dock?: ComponentChildren;
  /** The stage holds a report rather than a chart: the app's own colours, and no background slider. */
  report?: boolean;
}) {
  const [width, setWidth] = useState(() => getPref(KEY, DEFAULT, isWidth));
  const resize = (value: number) => {
    const room = window.innerWidth - 420; // the chart keeps at least this much
    const next = Math.round(Math.max(MIN, Math.min(MAX, room, value)));
    setWidth(next);
    setPref(KEY, next);
  };
  return (
    <div class="workspace" style={{ '--panel-width': `${width}px` }}>
      <aside class="workspace__panel">{panel}</aside>
      <Handle width={width} onResize={resize} />
      <div class="workspace__main">
        {above}
        {bar && <div class="workspace__bar">{bar}</div>}
        {report
          ? <section class="workspace__report">{dock && <div class="workspace__dock workspace__dock--report">{dock}</div>}{children}</section>
          : <Stage footer={stageFooter} dock={dock}>{children}</Stage>}
      </div>
    </div>
  );
}

const SHADE_LIMIT = 80;
const INVERT_AT = 45;
const isShade = (v: unknown): v is number => typeof v === 'number' && Math.abs(v) <= SHADE_LIMIT;

/**
 * The area the chart sits in, with a slider down its right side to lighten or darken the
 * background and the inside of the chart. Remembered separately for the light and dark themes; double-click resets it.
 */
function Stage({ footer, dock, children }: { footer?: ComponentChildren; dock?: ComponentChildren; children: ComponentChildren }) {
  const [theme] = useTheme();
  const [shade, setShade] = usePref(`canvas-shade-${theme}`, 0, isShade);
  // styles.css mixes the theme's background towards white or black by this much.
  const mix = { '--stage-mix': shade > 0 ? '#ffffff' : '#000000', '--stage-amount': `${Math.abs(shade)}%` };
  // Past halfway the inside of the chart is closer to the other theme, so its text follows that theme.
  const invert = theme === 'light' ? shade <= -INVERT_AT : shade >= INVERT_AT;
  // Docked cards go beside the chart when the stage is wide enough to keep them clear of it,
  // otherwise in a row above it. Measured here rather than with a size container query: size
  // containment on the stage made the dial flicker while its pointer was dragged.
  const stage = useRef<HTMLElement>(null);
  const [row, setRow] = useState(false);
  useEffect(() => {
    const el = stage.current;
    if (!el || !dock) return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const { width, height } = entry.contentRect;
      setRow(width < 760 || width / Math.max(height, 1) < 1.45);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [!!dock]);
  return (
    <section ref={stage} class={`workspace__stage${invert ? ' stage--invert' : ''}${dock && row ? ' stage--dock-row' : ''}`} style={mix}>
      {dock && <div class="workspace__dock">{dock}</div>}
      <div class="workspace__chart">{children}</div>
      {footer && <div class="workspace__footer">{footer}</div>}
      <div class="stage-shade" title="Lighten or darken the background. Double-click to reset.">
        <span class="stage-shade__label" aria-hidden="true">Light</span>
        <input type="range" class="stage-shade__slider" min={-SHADE_LIMIT} max={SHADE_LIMIT} step={1} value={shade}
               aria-label="Background brightness" aria-orientation="vertical"
               onInput={(e) => setShade(Number(e.currentTarget.value))} onDblClick={() => setShade(0)} />
        <span class="stage-shade__label" aria-hidden="true">Dark</span>
      </div>
    </section>
  );
}

function Handle({ width, onResize }: { width: number; onResize: (w: number) => void }) {
  const drag = useRef<{ x: number; width: number } | null>(null);
  const [active, setActive] = useState(false);
  const end = () => { drag.current = null; setActive(false); };
  return (
    <div class={`splitter${active ? ' is-active' : ''}`} role="separator" aria-orientation="vertical"
         aria-label="Resize the panel" aria-valuenow={width} aria-valuemin={MIN} aria-valuemax={MAX} tabIndex={0}
         title="Drag to resize. Double-click to reset."
         onPointerDown={(e) => {
           if (e.button !== 0) return;
           e.preventDefault();
           e.currentTarget.setPointerCapture(e.pointerId);
           drag.current = { x: e.clientX, width };
           setActive(true);
         }}
         onPointerMove={(e) => drag.current && onResize(drag.current.width + e.clientX - drag.current.x)}
         onPointerUp={end} onPointerCancel={end} onLostPointerCapture={end}
         onDblClick={() => onResize(DEFAULT)}
         onKeyDown={(e) => {
           const step = e.shiftKey ? 64 : 16;
           const next = ({ ArrowLeft: width - step, ArrowRight: width + step, Home: MIN, End: MAX } as Record<string, number>)[e.key];
           if (next === undefined) return;
           e.preventDefault();
           onResize(next);
         }} />
  );
}

/** A titled, collapsible block in the panel. */
export function PanelSection({ title, children, open = true }: { title: string; children: ComponentChildren; open?: boolean }) {
  return (
    <details class="panel-section" open={open}>
      <summary>{title}</summary>
      <div class="panel-section__body">{children}</div>
    </details>
  );
}
