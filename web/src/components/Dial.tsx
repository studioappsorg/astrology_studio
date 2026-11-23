/**
 * AstrologyStudio ·
 * web/src/components/Dial.tsx
 *
 * The cosmobiology dial, laid out as Ebertin's (and MindForce's): 90°, 120° or 360°, 0° at
 * the top, running anticlockwise.
 *
 * From the outside in: a band carrying the degree numbers, tinted in 30° stretches in the chart
 * wheel's sign colours, with the graduation's ticks standing outward from its base circle. Each body has a dot on that base circle at its
 * exact place, and a leader in to its symbol (spread out so symbols never overlap). The
 * pointer runs right across the dial, inside the graduation: its tip touches the base circle
 * and its other end is the far end of the axis (45° on the 90° dial).
 *
 * Gold lines join the bodies whose midpoint is on the pointer, within the orb. Bodies close
 * together are drawn as one end, so a cluster gives one line, not several.
 *
 * Further rings sit inside the first, each with its own graduation, dots and symbols, the same
 * shape as the outer one only smaller. The selected ring is tinted, and the gold lines are for its
 * bodies. Ring 0 is the outermost: the chart screen passes the natal chart last, so it's innermost
 * as on the bi-wheel, and `colours` keeps each ring in its chart's colour.
 *
 * Copyright (c) 2026 Gavin Melhuish
 * MIT License; see LICENSE in the project root.
 * SPDX-License-Identifier: MIT
 */

import { useRef, useState } from 'preact/hooks';
import type { Point } from '../api';
import { bodyFill, signFill, useChartStyle, type ChartStyle, type LayoutOptions } from '../appearance';
import { dialDistance, midpoint, norm, textGlyph } from '../astro';
import { spread, steps } from '../geometry';

/** What a dial layout can change (see appearance.py DIAL_OPTIONS). */
export interface DialOptions {
  scale: 'normal' | 'sparse' | 'dense';
  numbers: 'all' | 'quarters';
  orbit: 'single' | 'stacked';
  pointer: 'both' | 'line' | 'arrow';
  axis_lines: boolean;
  trees: 'tree' | 'list';
  glyphs: 'normal' | 'large';
}

export const DIAL_DEFAULTS: DialOptions = {
  scale: 'normal', numbers: 'all', orbit: 'single', pointer: 'both', axis_lines: true, trees: 'tree', glyphs: 'normal',
};

export const dialOptions = (o?: LayoutOptions | null): DialOptions => ({ ...DIAL_DEFAULTS, ...(o ?? {}) } as DialOptions);

export interface DialRing {
  points: Record<string, Point>;
  keys: string[];
}

interface DialProps {
  /** The dial's size in degrees: any that divides 360 evenly. */
  modulus: number;
  rings: DialRing[];
  pointer: number;
  onPointer: (dialDegree: number) => void;
  /** Include the far end of the axis (45° on the 90° dial) for the gold midpoint lines. */
  half: boolean;
  glyphs: Record<string, string>;
  focus?: string | null;
  onPick?: (key: string) => void;
  /** How close a midpoint must be to the pointer for its gold line. */
  orb?: number;
  /** The ring whose midpoints get gold lines, and which is tinted when there are several. */
  selected?: number;
  /** The colour (chart number, from 0) of each ring; by default its own index. */
  colours?: number[];
  /** The layout's choices: scale, numbers, pointer and so on. */
  options?: LayoutOptions | null;
}

const C = 300;
// MindForce's proportions (getDialMetrics), for a 600-unit square.
const R_OUT = 290;
const R_GRAD = R_OUT * 0.87; // the graduation's base circle: ticks stand out from it, dots sit on it
const R_PLANET = R_OUT * 0.72;
const GUTTER = (R_GRAD - R_PLANET) / 2; // base circle to symbol orbit
const MAJOR = 11.3;
const MINOR = 6.3;
const NUMBER_FONT = 12.5;
const R_LABEL = R_GRAD + MAJOR + NUMBER_FONT * 1.09;
const GLYPH = 19; // a little under the chart wheel's largest symbols
const SYMBOL_OFFSET = GLYPH * 0.55; // a symbol's half-size: lines stop short of it
const DOT = 2.2;
const HEAD = 15;
/** Bodies this close on the dial share one end of a gold line (MindForce's cluster orb). */
const CLUSTER = 1.5;

interface RingGeometry { gradOuter: number; gradInner: number; symbol: number; scale: number }

/** Ring 0 is the main dial; each next ring sits just inside the previous ring's symbols. */
export function ringGeometry(index: number): RingGeometry {
  let gradOuter = R_OUT;
  let gradInner = R_GRAD;
  let symbol = R_GRAD - GUTTER;
  let scale = 1;
  for (let i = 1; i <= index; i++) {
    gradOuter = symbol - SYMBOL_OFFSET - MAJOR * 0.5;
    scale = gradOuter / R_OUT;
    gradInner = gradOuter - MAJOR * scale;
    symbol = gradInner - GUTTER;
  }
  return { gradOuter, gradInner, symbol, scale };
}

/** The band's 30° stretches, tinted like the signs on the chart wheel (on the 360° dial they are
 * the signs). Dials smaller than 30° get three stretches, as the 90° dial's first 30° would. */
function bands(modulus: number): Array<{ from: number; to: number; tint: string; sign: number }> {
  const out = [];
  const width = modulus >= 60 ? 30 : modulus / 3;
  for (let from = 0, i = 0; from < modulus - 1e-9; from += width, i++) {
    out.push({ from, to: Math.min(from + width, modulus), tint: ['fire', 'earth', 'air', 'water'][i % 4]!, sign: i });
  }
  return out;
}

const label = (d: number) => `${Number(d.toFixed(4))}°`;

export function Dial({ modulus, rings, pointer: committed, onPointer, half, glyphs, focus, onPick, orb = 1.5, selected = 0, options, colours }: DialProps) {
  const svg = useRef<SVGSVGElement>(null);
  const style = useChartStyle();
  const o = dialOptions(options);
  const glyphSize = GLYPH * style.glyphScale * (o.glyphs === 'large' ? 1.2 : 1);
  const dragging = useRef(false);
  // While the pointer is dragged, only the dial redraws: the screen around it hears where it
  // ended up when you let go. Redrawing the whole chart screen on every move made it flicker.
  const [live, setLive] = useState<number | null>(null);
  const lastLive = useRef<number | null>(null);
  const pointer = live ?? committed;
  const move = (value: number) => {
    if (dragging.current) { lastLive.current = value; setLive(value); } else onPointer(value);
  };
  const endDrag = () => {
    if (!dragging.current) return;
    dragging.current = false;
    const value = lastLive.current;
    lastLive.current = null;
    setLive(null);
    if (value !== null) onPointer(value);
  };
  const theta = (v: number) => ((((v % modulus) + modulus) % modulus) / modulus) * 2 * Math.PI;
  const at = (v: number, r: number): [number, number] => {
    const t = theta(v);
    return [C - r * Math.sin(t), C - r * Math.cos(t)];
  };

  const fromEvent = (event: PointerEvent) => {
    const box = svg.current?.getBoundingClientRect();
    if (!box) return;
    const x = ((event.clientX - box.left) / box.width) * 600 - C;
    const y = ((event.clientY - box.top) / box.height) * 600 - C;
    const t = Math.atan2(-x, -y); // anticlockwise from the top
    move(((t / (2 * Math.PI)) * modulus + modulus) % modulus);
  };

  const [step, long] = steps(modulus, o.scale);
  const scale = [];
  const count = Math.round(modulus / step);
  if (o.numbers === 'quarters') {
    for (let q = 1; q < 4; q++) {
      const d = (modulus * q) / 4;
      if (Math.abs(d / step - Math.round(d / step)) < 1e-9) continue; // drawn with the scale
      const [x1, y1] = at(d, R_GRAD);
      const [x2, y2] = at(d, R_GRAD + MAJOR);
      const [lx, ly] = at(d, R_LABEL);
      scale.push(<line key={`q${q}`} x1={x1} y1={y1} x2={x2} y2={y2} class="dial__tick dial__tick--long" />);
      scale.push(<text key={`ql${q}`} x={lx} y={ly} class="dial__scale-label" dominant-baseline="central" text-anchor="middle">{label(d)}</text>);
    }
  }
  for (let i = 0; i < count; i++) {
    const d = i * step;
    const quarter = Math.abs((d / modulus) * 4 - Math.round((d / modulus) * 4)) < 1e-9;
    const isLong = Math.abs(d / long - Math.round(d / long)) < 1e-9 || (o.numbers === 'quarters' && quarter);
    const [x1, y1] = at(d, R_GRAD);
    const [x2, y2] = at(d, R_GRAD + (isLong ? MAJOR : MINOR));
    scale.push(<line key={`t${i}`} x1={x1} y1={y1} x2={x2} y2={y2} class={`dial__tick${isLong ? ' dial__tick--long' : ''}`} />);
    if (isLong && (o.numbers === 'all' || quarter)) {
      const [lx, ly] = at(d, R_LABEL);
      scale.push(<text key={`l${i}`} x={lx} y={ly} class="dial__scale-label" dominant-baseline="central" text-anchor="middle">{label(d)}</text>);
    }
  }

  // Where each ring's symbols are drawn, so the gold lines can meet them.
  const layouts = rings.map((ring, i) => layoutRing(ring, ringGeometry(i).symbol, modulus, o.orbit === 'stacked'));
  const sel = Math.min(Math.max(selected, 0), rings.length - 1);
  const lines = o.axis_lines && sel >= 0 && rings[sel] ? midpointLines(rings[sel]!, layouts[sel]!, pointer, orb, modulus, half) : [];
  const selGeo = ringGeometry(sel);

  const [tipX, tipY] = at(pointer, R_GRAD);
  const [tailX, tailY] = at(pointer + modulus / 2, R_GRAD);

  return (
    <svg ref={svg} class="dial wheel" viewBox="0 0 600 600" role="img" aria-label={`${modulus}° dial`}
         onPointerDown={(e) => { dragging.current = true; (e.currentTarget as Element).setPointerCapture(e.pointerId); fromEvent(e); }}
         onPointerMove={(e) => dragging.current && fromEvent(e)}
         onPointerUp={endDrag} onPointerCancel={endDrag} onLostPointerCapture={endDrag}>
      <circle cx={C} cy={C} r={R_OUT} class="wheel__bg" />
      {bands(modulus).map(({ from, to, tint, sign }) => {
        const [ox1, oy1] = at(from, R_OUT);
        const [ox2, oy2] = at(to, R_OUT);
        const [ix1, iy1] = at(from, R_GRAD);
        const [ix2, iy2] = at(to, R_GRAD);
        const big = ((to - from) / modulus) * 360 > 180 ? 1 : 0;
        return (
          <path key={from} class={`wheel__sign wheel__sign--${tint}`} style={{ fill: signFill(style, sign) }}
                d={`M${ox1} ${oy1} A${R_OUT} ${R_OUT} 0 ${big} 0 ${ox2} ${oy2} L${ix2} ${iy2} A${R_GRAD} ${R_GRAD} 0 ${big} 1 ${ix1} ${iy1} Z`} />
        );
      })}
      <circle cx={C} cy={C} r={R_OUT} class="dial__outer" />
      {rings.length > 1 && (
        <path class="wheel__ring-highlight dial__ring-highlight" fill-rule="evenodd"
              d={annulus(selGeo.symbol - GUTTER, sel === 0 ? R_OUT : selGeo.gradOuter)} />
      )}
      <circle cx={C} cy={C} r={R_GRAD} class="dial__base" />
      {scale}
      {rings.map((_, i) => i > 0 && <RingScale key={i} geo={ringGeometry(i)} modulus={modulus} at={at} />)}
      <g class="dial__midpoint-lines">
        {lines.map(([a, b], i) => {
          const [ax, ay] = at(a, selGeo.symbol);
          const [bx, by] = at(b, selGeo.symbol);
          const len = Math.hypot(bx - ax, by - ay);
          if (len <= SYMBOL_OFFSET * 2) return null;
          const ux = (bx - ax) / len;
          const uy = (by - ay) / len;
          return <line key={i} x1={ax + ux * SYMBOL_OFFSET} y1={ay + uy * SYMBOL_OFFSET} x2={bx - ux * SYMBOL_OFFSET} y2={by - uy * SYMBOL_OFFSET} />;
        })}
      </g>
      {rings.map((_, i) => (
        <DialBodies key={i} index={colours?.[i] ?? i} layout={layouts[i]!} geo={ringGeometry(i)} at={at}
                    glyphs={glyphs} focus={focus ?? null} onPick={onPick} glyphSize={glyphSize} style={style}
                    points={rings[i]!.points} sun={rings[i]!.points.sun?.lon} />
      ))}
      <g class="dial__pointer">
        <line x1={o.pointer === 'arrow' ? C : tailX} y1={o.pointer === 'arrow' ? C : tailY} x2={tipX} y2={tipY} />
        {o.pointer !== 'line' && <path d={arrowHead(tipX, tipY, theta(pointer))} />}
        <circle cx={C} cy={C} r={3.2} />
      </g>
    </svg>
  );
}

function annulus(inner: number, outer: number): string {
  const circle = (r: number) => `M${C - r} ${C} a${r} ${r} 0 1 0 ${2 * r} 0 a${r} ${r} 0 1 0 ${-2 * r} 0 Z`;
  return `${circle(outer)} ${circle(Math.max(inner, 0))}`;
}

/** MindForce's arrowhead: a notched point whose tip is on the graduation's base circle. */
function arrowHead(x: number, y: number, t: number): string {
  const dx = -Math.sin(t);
  const dy = -Math.cos(t);
  const a = Math.atan2(dy, dx);
  const side = (k: number, len: number) => [x - len * Math.cos(a + k), y - len * Math.sin(a + k)] as const;
  const [l1x, l1y] = side(-Math.PI / 8, HEAD);
  const [nx, ny] = side(0, HEAD * 0.7);
  const [l2x, l2y] = side(Math.PI / 8, HEAD);
  return `M${x} ${y} L${l1x} ${l1y} L${nx} ${ny} L${l2x} ${l2y} Z`;
}

/** An inner ring's own graduation band: two circles with ticks standing out from the inner one. */
function RingScale({ geo, modulus, at }: { geo: RingGeometry; modulus: number; at: (v: number, r: number) => [number, number] }) {
  const [step, long] = steps(modulus);
  const ticks = [];
  for (let i = 0; i < Math.round(modulus / step); i++) {
    const d = i * step;
    const isLong = Math.abs(d / long - Math.round(d / long)) < 1e-9;
    const [x1, y1] = at(d, geo.gradInner);
    const [x2, y2] = at(d, geo.gradInner + (isLong ? MAJOR : MINOR) * geo.scale);
    ticks.push(<line key={d} x1={x1} y1={y1} x2={x2} y2={y2} class={`dial__tick dial__tick--inner${isLong ? ' dial__tick--long' : ''}`} />);
  }
  return (
    <g class="dial__ring-scale">
      <circle cx={C} cy={C} r={geo.gradOuter} class="dial__ring-line" />
      <circle cx={C} cy={C} r={geo.gradInner} class="dial__ring-line" />
      {ticks}
    </g>
  );
}

interface RingLayout { keys: string[]; exact: number[]; shown: number[]; level: number[] }

/** Each body's exact place on the dial and where its symbol goes, spread so none overlap. With
 * `stacked`, crowded symbols take turns on a second, inner orbit instead of spreading as far. */
function layoutRing(ring: DialRing, symbolR: number, modulus: number, stacked = false): RingLayout {
  const keys = ring.keys.filter((k) => ring.points[k]);
  const exact = keys.map((k) => norm(ring.points[k]!.lon) % modulus);
  // Spread in screen degrees: 9° apart on the main ring (as MindForce), the same distance
  // along the orbit on the smaller inner rings.
  const fullGap = Math.min(9 * ((R_GRAD - GUTTER) / symbolR), (360 / Math.max(keys.length, 1)) * 0.9);
  const minGap = stacked ? fullGap * 0.5 : fullGap;
  const screen = spread(exact.map((v) => (v / modulus) * 360), minGap);
  const level = new Array<number>(keys.length).fill(0);
  if (stacked) {
    const order = screen.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
    for (let k = 1; k < order.length; k++) {
      const [v, i] = order[k]!;
      const [pv, pi] = order[k - 1]!;
      if (v - pv < fullGap && level[pi] === 0) level[i] = 1;
    }
  }
  const shown = screen.map((v) => (v / 360) * modulus);
  return { keys, exact, shown, level };
}

/**
 * The gold lines: pairs of bodies whose midpoint is on the pointer (or its far end, with
 * `half`), within the orb. Bodies within CLUSTER of each other are one end, drawn where their
 * symbols are, so a cluster on each side gives a single line. Returns pairs of dial positions.
 */
function midpointLines(ring: DialRing, layout: RingLayout, pointer: number, orb: number, modulus: number, half: boolean): Array<[number, number]> {
  const { keys, exact, shown } = layout;
  const hits: Array<[number, number]> = [];
  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < keys.length; j++) {
      const m = midpoint(ring.points[keys[i]!]!.lon, ring.points[keys[j]!]!.lon);
      if (dialDistance(m, pointer, modulus, half) <= orb) hits.push([i, j]);
    }
  }
  if (!hits.length) return [];
  const gap = (a: number, b: number) => { const d = Math.abs(a - b) % modulus; return Math.min(d, modulus - d); };
  // Cluster the bodies that take part, by their exact places.
  const clusters: Array<{ members: number[]; centre: number }> = [];
  const clusterOf = new Map<number, number>();
  for (const i of [...new Set(hits.flat())].sort((a, b) => exact[a]! - exact[b]!)) {
    let best = -1;
    let bestGap = Infinity;
    clusters.forEach((c, ci) => { const g = gap(exact[i]!, c.centre); if (g <= CLUSTER && g < bestGap) { best = ci; bestGap = g; } });
    if (best < 0) { clusters.push({ members: [i], centre: exact[i]! }); clusterOf.set(i, clusters.length - 1); }
    else {
      const c = clusters[best]!;
      c.members.push(i);
      c.centre = circularMean(c.members.map((k) => exact[k]!), modulus);
      clusterOf.set(i, best);
    }
  }
  // Each cluster's end is the middle of its members' symbols.
  const ends = clusters.map((c) => circularMean(c.members.map((k) => shown[k]!), modulus));
  const pairs = new Set<string>();
  for (const [i, j] of hits) {
    const a = clusterOf.get(i)!;
    const b = clusterOf.get(j)!;
    if (a !== b) pairs.add(a < b ? `${a}:${b}` : `${b}:${a}`);
  }
  return [...pairs].map((p) => { const [a, b] = p.split(':').map(Number); return [ends[a!]!, ends[b!]!]; });
}

function circularMean(values: number[], modulus: number): number {
  let s = 0;
  let c = 0;
  for (const v of values) { const t = (v / modulus) * 2 * Math.PI; s += Math.sin(t); c += Math.cos(t); }
  const mean = (Math.atan2(s, c) / (2 * Math.PI)) * modulus;
  return ((mean % modulus) + modulus) % modulus;
}

function DialBodies({ index, layout, geo, at, glyphs, focus, onPick, glyphSize, style, points, sun }: {
  index: number; layout: RingLayout; geo: RingGeometry; at: (v: number, r: number) => [number, number];
  glyphs: Record<string, string>; focus: string | null; onPick?: (key: string) => void; glyphSize: number;
  style: ChartStyle; points: Record<string, Point>; sun?: number;
}) {
  const { keys, exact, shown, level } = layout;
  return (
    <g class={index > 0 ? `wheel__bodies dial__bodies wheel__bodies--ring-${index}` : 'wheel__bodies dial__bodies wheel__bodies--ring-0'}>
      {keys.map((key, i) => {
        const [dx, dy] = at(exact[i]!, geo.gradInner);
        const [gx, gy] = at(shown[i]!, geo.symbol - level[i]! * glyphSize * 1.15 * geo.scale);
        const len = Math.hypot(dx - gx, dy - gy);
        const sx = len > SYMBOL_OFFSET ? gx + ((dx - gx) / len) * SYMBOL_OFFSET : dx;
        const sy = len > SYMBOL_OFFSET ? gy + ((dy - gy) / len) * SYMBOL_OFFSET : dy;
        const glyph = glyphs[key] ?? key.slice(0, 2);
        const letters = /^[A-Z]/.test(glyph);
        return (
          <g key={key} class={`wheel__body dial__body${focus === key ? ' is-focus' : ''}`}
             style={index === 0 ? { '--body-fill': bodyFill(style, key, points[key]!.lon, sun) } : undefined}
             onPointerDown={(e) => { e.stopPropagation(); onPick?.(key); }}>
            <line x1={sx} y1={sy} x2={dx} y2={dy} class="dial__leader" />
            <circle cx={dx} cy={dy} r={DOT} class="dial__dot" />
            <text x={gx} y={gy} class={`wheel__glyph dial__glyph${letters ? ' wheel__glyph--angle' : ''}`}
                  style={{ fontSize: `${letters ? glyphSize * 0.7 : glyphSize}px` }}
                  dominant-baseline="central" text-anchor="middle">{textGlyph(glyph)}</text>
            <title>{`${key} ${exact[i]!.toFixed(2)}° on the dial`}</title>
          </g>
        );
      })}
    </g>
  );
}
