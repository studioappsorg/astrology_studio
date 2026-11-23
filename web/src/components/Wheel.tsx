/**
 * AstrologyStudio ·
 * web/src/components/Wheel.tsx
 *
 * The chart wheel, drawn as SVG:
 *
 * zodiac, houses, one to three rings of bodies, and aspect lines for one ring (the innermost
 * unless `aspectRing` says otherwise), each with its aspect's symbol in the middle unless switched
 * off in Your view → Aspects. Hovering a body shows only its aspects. The Ascendant sits at nine
 * o'clock when there are houses; otherwise 0° Aries does. Colours come from --wheel-* tokens.
 *
 * Copyright (c) 2026 Gavin Melhuish
 * MIT License; see LICENSE in the project root.
 * SPDX-License-Identifier: MIT
 */

import type { FoundAspect, Point } from '../api';
import { aspectStroke, bodyFill, signFill, useChartStyle, type ChartStyle, type LayoutOptions } from '../appearance';
import { ASPECT_INFO, norm, SIGN_GLYPHS, textGlyph } from '../astro';
import { spread } from '../geometry';

export { spread };
import { retroMark } from '../fmt';
import { useLeaderLines, useLineGlyphs } from '../display';

/** What a wheel layout can change (see appearance.py WHEEL_OPTIONS). */
export interface WheelOptions {
  sign_band: boolean;
  scale: '1' | '5' | 'none';
  houses: boolean;
  house_numbers: boolean;
  angles: 'badges' | 'lines';
  labels: 'deg' | 'degmin' | 'none';
  retro: boolean;
  aspects: 'all' | 'hard' | 'hover' | 'none';
  rings: 'compact' | 'roomy';
  glyphs: 'normal' | 'large';
}

export const WHEEL_DEFAULTS: WheelOptions = {
  sign_band: true, scale: '1', houses: true, house_numbers: true, angles: 'badges', labels: 'deg', retro: true,
  aspects: 'all', rings: 'compact', glyphs: 'normal',
};

export const wheelOptions = (o?: LayoutOptions | null): WheelOptions => ({ ...WHEEL_DEFAULTS, ...(o ?? {}) } as WheelOptions);

export interface WheelRing {
  points: Record<string, Point>;
  /** Which bodies to draw, in order. */
  keys: string[];
  label?: string;
}

interface WheelProps {
  rings: WheelRing[];
  houses: number[] | null;
  aspects: FoundAspect[];
  /** Draw these aspects instead: `a` is a body in `from`, `b` a body in the inner ring. */
  cross?: { aspects: FoundAspect[]; from: Record<string, Point>; fromKeys?: string[] } | null;
  glyphs: Record<string, string>;
  size?: number;
  /** Highlight one body (e.g. when hovering a table row). */
  focus?: string | null;
  onFocus?: (key: string | null) => void;
  title?: string;
  /** Which ring the aspects belong to (default 0, the innermost). */
  aspectRing?: number;
  /** Tint one ring's band, to show which chart is selected. */
  highlight?: number | null;
  /** Mark signs in the zodiac band (0 = Aries): the value is a style, such as "primary". */
  marks?: Record<number, string>;
  /** The layout's choices: rings, scale, labels and so on. */
  options?: LayoutOptions | null;
}

const C = 300;
const AXIS_DOT = 11;
/** Leaves room for the AC, MC, DC and IC badges, which sit on the outer circle, inside the drawing. */
const R_OUT = C - AXIS_DOT - 4;
const BAND = 40;
const R_ASPECT_ONE = 138;
const R_ASPECT_MANY = 112;
/** "Roomy" rings: a smaller aspect circle leaves more room for the bodies. */
const ROOMY = 22;

const ANGLE_KEYS = new Set(['asc', 'mc', 'vertex', 'east_point']);

/** The inside of the zodiac band (with no band, just inside the outer circle). */
const signIn = (o: WheelOptions) => R_OUT - (o.sign_band ? BAND : 6);

/** The band each ring of bodies gets, for this many rings. */
function bandFor(ringCount: number, o: WheelOptions = WHEEL_DEFAULTS): { inner: number; width: number; aspect: number } {
  const aspect = (ringCount > 1 ? R_ASPECT_MANY : R_ASPECT_ONE) - (o.rings === 'roomy' ? ROOMY : 0);
  const inner = aspect + 16;
  return { inner, width: (signIn(o) - 8 - inner) / Math.max(ringCount, 1), aspect };
}

/** The size of the bodies' symbols, in the wheel's own units (it is 600 across). */
export function wheelGlyphSize(ringCount: number, o: WheelOptions = WHEEL_DEFAULTS, style?: ChartStyle): number {
  const base = Math.max(13, Math.min(21, bandFor(ringCount, o).width * 0.36));
  return base * (o.glyphs === 'large' ? 1.2 : 1) * (style?.glyphScale ?? 1);
}

export function Wheel({ rings, houses: allHouses, aspects: allAspects, cross, glyphs, size, focus, onFocus, title, aspectRing = 0, highlight = null, marks, options }: WheelProps) {
  const style = useChartStyle();
  const o = wheelOptions(options);
  const R_SIGN_IN = signIn(o);
  // Without houses drawn, the Ascendant still sits at nine o'clock.
  const houses = o.houses ? allHouses : null;
  const aspects = o.aspects === 'none' ? []
    : o.aspects === 'hard' ? allAspects.filter((a) => ASPECT_INFO[a.aspect]?.kind === 'hard')
    : o.aspects === 'hover' ? allAspects.filter((a) => focus && (a.a === focus || a.b === focus))
    : allAspects;
  const sun = rings[0]?.points.sun?.lon;
  // The Ascendant itself, not the first cusp: with Whole Sign houses the first cusp is 0° of its sign.
  const ascPoint = rings[0]?.points.asc?.lon;
  const mcPoint = rings[0]?.points.mc?.lon;
  const asc = allHouses ? ascPoint ?? allHouses[0]! : ascPoint ?? 0;
  const band = bandFor(rings.length, o);
  const R_ASPECT = band.aspect;
  const angle = (lon: number) => ((180 + norm(lon - asc)) * Math.PI) / 180;
  const at = (lon: number, r: number): [number, number] => {
    const a = angle(lon);
    return [C + r * Math.cos(a), C - r * Math.sin(a)];
  };

  // Rings of bodies share the band between the zodiac and the aspect circle; ring 0 is innermost.
  const bandInner = band.inner;
  const bandWidth = band.width;
  const ringRadius = (i: number) => bandInner + bandWidth * (i + 0.5);
  const aspectOf = rings[aspectRing] ?? rings[0];

  return (
    <svg class="wheel" viewBox="0 0 600 600" width={size} height={size} role="img" aria-label={title ?? 'Chart wheel'}>
      <circle cx={C} cy={C} r={R_OUT} class="wheel__bg" />
      <ZodiacBand at={at} marks={marks} o={o} style={style} signInner={R_SIGN_IN} />
      {highlight !== null && rings.length > 1 && rings[highlight] && (
        <path class="wheel__ring-highlight" fill-rule="evenodd"
              d={annulus(bandInner + bandWidth * highlight, bandInner + bandWidth * (highlight + 1))} />
      )}
      {rings.map((_, i) => i > 0 && (
        <circle key={i} cx={C} cy={C} r={bandInner + bandWidth * i} class="wheel__ring-line" />
      ))}
      <circle cx={C} cy={C} r={bandInner} class="wheel__ring-line" />
      <circle cx={C} cy={C} r={R_ASPECT} class="wheel__aspect-bg" />
      {houses && <Houses houses={houses} at={at} inner={R_ASPECT} outer={R_SIGN_IN} bandInner={bandInner} numbers={o.house_numbers} />}
      {cross ? (
        <AspectLines aspects={cross.aspects} points={rings[0]?.points ?? {}} from={cross.from} keys={new Set(rings[0]?.keys ?? [])}
                     fromKeys={new Set(cross.fromKeys ?? rings[1]?.keys ?? Object.keys(cross.from))} at={at} focus={focus ?? null} r={R_ASPECT} style={style} />
      ) : (
        <AspectLines aspects={aspects}
                     points={aspectOf?.points ?? {}} keys={new Set(aspectOf?.keys ?? [])} at={at} focus={focus ?? null} r={R_ASPECT} style={style} />
      )}
      {rings.map((ring, i) => (
        <BodyRing key={i} ring={allHouses ? { ...ring, keys: ring.keys.filter((k) => i > 0 || (k !== 'asc' && k !== 'mc')) } : ring} radius={ringRadius(i)} bandWidth={bandWidth} at={at} glyphs={glyphs}
                  tickFrom={R_SIGN_IN} focus={focus ?? null} onFocus={onFocus} ringIndex={i} o={o} style={style}
                  fontSize={wheelGlyphSize(rings.length, o, style)} sun={sun} />
      ))}
      {allHouses && (o.angles === 'lines'
        ? <AngleLines asc={ascPoint ?? allHouses[0]!} mc={mcPoint ?? allHouses[9]!} at={at} inner={R_ASPECT} />
        : <Axes asc={ascPoint ?? allHouses[0]!} mc={mcPoint ?? allHouses[9]!} at={at} />)}
    </svg>
  );
}

type At = (lon: number, r: number) => [number, number];

/** A ring between two radii, as one path (drawn with fill-rule evenodd). */
function annulus(inner: number, outer: number): string {
  const circle = (r: number) => `M${C - r} ${C} a${r} ${r} 0 1 0 ${2 * r} 0 a${r} ${r} 0 1 0 ${-2 * r} 0 Z`;
  return `${circle(outer)} ${circle(inner)}`;
}

function ZodiacBand({ at, marks, o, style, signInner: R_SIGN_IN }: { at: At; marks?: Record<number, string>; o: WheelOptions; style: ChartStyle; signInner: number }) {
  const sectors = [];
  for (let s = 0; s < 12; s++) {
    const start = s * 30;
    const [x1, y1] = at(start, R_OUT);
    const [x2, y2] = at(start + 30, R_OUT);
    const [x3, y3] = at(start + 30, R_SIGN_IN);
    const [x4, y4] = at(start, R_SIGN_IN);
    const [gx, gy] = at(start + 15, (R_OUT + R_SIGN_IN) / 2);
    if (!o.sign_band && !marks?.[s]) continue;
    sectors.push(
      <g key={s}>
        <path class={`wheel__sign wheel__sign--${['fire', 'earth', 'air', 'water'][s % 4]}${marks?.[s] ? ` is-marked is-marked--${marks[s]}` : ''}`}
              style={{ fill: o.sign_band ? signFill(style, s) : 'transparent' }}
              d={`M${x1} ${y1} A${R_OUT} ${R_OUT} 0 0 0 ${x2} ${y2} L${x3} ${y3} A${R_SIGN_IN} ${R_SIGN_IN} 0 0 1 ${x4} ${y4} Z`} />
        {o.sign_band && <text x={gx} y={gy} class="wheel__sign-glyph" dominant-baseline="central" text-anchor="middle">{SIGN_GLYPHS[s]}</text>}
      </g>,
    );
  }
  const ticks = [];
  for (let d = 0; d < 360; d++) {
    if (o.scale === 'none' || (o.scale === '5' && d % 5 !== 0)) continue;
    const len = d % 10 === 0 ? 9 : d % 5 === 0 ? 6 : 3;
    const [x1, y1] = at(d, R_SIGN_IN);
    const [x2, y2] = at(d, R_SIGN_IN - len);
    ticks.push(<line key={d} x1={x1} y1={y1} x2={x2} y2={y2} class="wheel__tick" />);
  }
  return <g>{sectors}{ticks}<circle cx={C} cy={C} r={R_SIGN_IN} class="wheel__line" /><circle cx={C} cy={C} r={R_OUT} class="wheel__line" /></g>;
}

function Houses({ houses, at, inner, outer, bandInner, numbers }: { houses: number[]; at: At; inner: number; outer: number; bandInner: number; numbers: boolean }) {
  return (
    <g>
      {houses.map((cusp, i) => {
        const [x1, y1] = at(cusp, inner);
        const [x2, y2] = at(cusp, outer);
        const next = houses[(i + 1) % 12]!;
        const mid = cusp + norm(next - cusp) / 2;
        const [nx, ny] = at(mid, inner + 11);
        const angular = i % 3 === 0;
        return (
          <g key={i}>
            <line x1={x1} y1={y1} x2={x2} y2={y2} class={angular ? 'wheel__cusp wheel__cusp--angle' : 'wheel__cusp'} />
            {numbers && <text x={nx} y={ny} class="wheel__house-number" dominant-baseline="central" text-anchor="middle">{i + 1}</text>}
          </g>
        );
      })}
      <circle cx={C} cy={C} r={bandInner} class="wheel__line" />
    </g>
  );
}

function Axes({ asc, mc, at }: { asc: number; mc: number; at: At }) {
  const labels: Array<[number, string]> = [[asc, 'AC'], [mc, 'MC'], [norm(asc + 180), 'DC'], [norm(mc + 180), 'IC']];
  return (
    <g>
      {labels.map(([lon, label]) => {
        const [x, y] = at(lon, R_OUT);
        return (
          <g key={label}>
            <circle cx={x} cy={y} r={AXIS_DOT} class="wheel__axis-dot" />
            <text x={x} y={y} class="wheel__axis-label" dominant-baseline="central" text-anchor="middle">{label}</text>
          </g>
        );
      })}
    </g>
  );
}

/** The angles as strong lines with small tags, instead of badges. */
function AngleLines({ asc, mc, at, inner }: { asc: number; mc: number; at: At; inner: number }) {
  const labels: Array<[number, string]> = [[asc, 'AC'], [mc, 'MC'], [norm(asc + 180), 'DC'], [norm(mc + 180), 'IC']];
  return (
    <g>
      {labels.map(([lon, label]) => {
        const [x1, y1] = at(lon, inner);
        const [x2, y2] = at(lon, R_OUT);
        const [tx, ty] = at(lon, R_OUT + 9);
        return (
          <g key={label}>
            <line x1={x1} y1={y1} x2={x2} y2={y2} class="wheel__angle-line" />
            <text x={tx} y={ty} class="wheel__angle-tag" dominant-baseline="central" text-anchor="middle">{label}</text>
          </g>
        );
      })}
    </g>
  );
}

function AspectLines({ aspects, points, from, keys, fromKeys, at, focus, r, style }: {
  aspects: FoundAspect[]; points: Record<string, Point>; from?: Record<string, Point>; keys: Set<string>;
  fromKeys?: Set<string>; at: At; focus: string | null; r: number; style: ChartStyle;
}) {
  const [showGlyphs] = useLineGlyphs();
  const source = from ?? points;
  const sourceKeys = fromKeys ?? keys;
  const lines = aspects.flatMap((a) => {
    if ((!from && a.aspect === 'conjunction') || !sourceKeys.has(a.a) || !keys.has(a.b)) return [];
    const pa = source[a.a];
    const pb = points[a.b];
    if (!pa || !pb) return [];
    // Hovering a body shows only its own aspects: the others are hidden, not faded.
    if (focus !== null && focus !== a.a && focus !== a.b) return [];
    const [x1, y1] = at(pa.lon, r);
    const [x2, y2] = at(pb.lon, r);
    return [{ a, x1, y1, x2, y2, dim: false }];
  });
  // Each aspect's symbol sits in the middle of its line. Where that's taken (every opposition
  // crosses the centre), it slides along the line to the nearest free place.
  const size = 12 * style.glyphScale;
  const placed: Array<[number, number]> = [];
  const marks = showGlyphs ? lines.map(({ x1, y1, x2, y2 }) => {
    for (const t of [0.5, 0.4, 0.6, 0.32, 0.68, 0.25, 0.75, 0.18, 0.82]) {
      const x = x1 + (x2 - x1) * t;
      const y = y1 + (y2 - y1) * t;
      if (placed.every(([px, py]) => Math.hypot(px - x, py - y) > size * 1.25)) {
        placed.push([x, y]);
        return [x, y] as const;
      }
    }
    return null; // nowhere free: the line alone
  }) : [];
  return (
    <g>
      {lines.map(({ a, x1, y1, x2, y2, dim }) => {
        const info = ASPECT_INFO[a.aspect];
        return (
          <line key={`${a.a}-${a.b}`} x1={x1} y1={y1} x2={x2} y2={y2}
                class={`wheel__aspect wheel__aspect--${info?.kind ?? 'neutral'}${info?.major ? '' : ' wheel__aspect--minor'}${dim ? ' is-dim' : ''}`}
                style={{ ...aspectStroke(style, a.aspect), strokeOpacity: dim ? 0.12 : a.by_sign ? 0.75 : Math.max(0.35, 1 - a.orb / 9) }}>
            <title>{a.by_sign ? `${a.a} ${info?.name ?? a.aspect} ${a.b} (by sign)` : `${a.a} ${info?.name ?? a.aspect} ${a.b} (orb ${a.orb.toFixed(1)}°)`}</title>
          </line>
        );
      })}
      {marks.map((m, i) => {
        if (!m) return null;
        const { a, dim } = lines[i]!;
        return (
          <g key={`g-${a.a}-${a.b}`} class={`wheel__aspect-glyph${dim ? ' is-dim' : ''}`} aria-hidden="true">
            <circle cx={m[0]} cy={m[1]} r={size * 0.62} class="wheel__aspect-glyph-bg" />
            <text x={m[0]} y={m[1]} class="glyph" font-size={size} text-anchor="middle" dominant-baseline="central"
                  fill={`var(--t-aspect-${a.aspect})`}>{textGlyph(ASPECT_INFO[a.aspect]?.glyph ?? '?')}</text>
          </g>
        );
      })}
    </g>
  );
}

function BodyRing({ ring, radius, bandWidth, at, glyphs, tickFrom, focus, onFocus, ringIndex, o, style, fontSize, sun }: {
  ring: WheelRing; radius: number; bandWidth: number; at: At; glyphs: Record<string, string>; tickFrom: number;
  focus: string | null; onFocus?: (key: string | null) => void; ringIndex: number; o: WheelOptions; style: ChartStyle;
  fontSize: number; sun?: number;
}) {
  const outerRing = ringIndex > 0;
  const keys = ring.keys.filter((k) => ring.points[k]);
  const lons = keys.map((k) => ring.points[k]!.lon);
  const glyphR = radius + bandWidth * 0.12;
  const minGap = Math.min(9, (360 / Math.max(keys.length, 1)) * 0.9) * (190 / glyphR);
  const shown = spread(lons, minGap);
  // The tick on the graduation always marks each body's place; the line from a symbol that's been
  // moved aside back to that tick only when switched on in Your view → Charts & dials.
  const [leaders] = useLeaderLines();
  return (
    <g class={outerRing ? `wheel__bodies wheel__bodies--ring-${ringIndex}` : 'wheel__bodies wheel__bodies--ring-0'}>
      {keys.map((key, i) => {
        const p = ring.points[key]!;
        const [tx1, ty1] = at(p.lon, outerRing ? radius + bandWidth / 2 : tickFrom);
        const [tx2, ty2] = at(p.lon, (outerRing ? radius + bandWidth / 2 : tickFrom) - 7);
        const [lx, ly] = at(shown[i]!, glyphR + fontSize * 0.62);
        const [gx, gy] = at(shown[i]!, glyphR);
        const [dx, dy] = at(shown[i]!, glyphR - fontSize * 0.95);
        const isAngle = ANGLE_KEYS.has(key) || /^[A-Za-z]/.test(glyphs[key] ?? '');
        const within = norm(p.lon) % 30;
        const deg = Math.floor(within);
        const label = o.labels === 'none' ? null
          : `${deg}°${o.labels === 'degmin' ? String(Math.floor((within - deg) * 60 + 1e-7)).padStart(2, '0') : ''}${o.retro && p.retro ? retroMark() : ''}`;
        const active = focus === key;
        const fill = outerRing ? undefined : { '--body-fill': bodyFill(style, key, p.lon, sun) };
        return (
          <g key={key} class={`wheel__body${active ? ' is-focus' : ''}${focus && !active ? ' is-dim' : ''}`} style={fill}
             onMouseEnter={() => onFocus?.(key)} onMouseLeave={() => onFocus?.(null)}>
            <line x1={tx1} y1={ty1} x2={tx2} y2={ty2} class="wheel__body-tick" />
            {leaders && Math.abs(norm(shown[i]! - p.lon + 180) - 180) > 1.5 && (
              <line x1={tx2} y1={ty2} x2={lx} y2={ly} class="wheel__leader" />
            )}
            <text x={gx} y={gy} class={`wheel__glyph${isAngle ? ' wheel__glyph--angle' : ''}`} style={{ fontSize: `${isAngle ? fontSize * 0.62 : fontSize}px` }}
                  dominant-baseline="central" text-anchor="middle">
              {textGlyph(glyphs[key] ?? key.slice(0, 2))}
            </text>
            {label && (
              <text x={dx} y={dy} class="wheel__degree" dominant-baseline="central" text-anchor="middle">{label}</text>
            )}
            <title>{key}</title>
          </g>
        );
      })}
    </g>
  );
}
