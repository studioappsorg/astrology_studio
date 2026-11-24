/**
 * AstrologyStudio ·
 * web/src/components/Export.tsx
 *
 * Saving a wheel or dial as an SVG or PNG file. The drawing takes its colours from the
 * page's styles, so they're copied onto each element before it leaves the page. The saved
 * picture has the chart details across the top (chart 1 on the left, chart 2 on the right)
 * and the company logo, when there is one, in the bottom right.
 *
 * Copyright (c) 2026 Gavin Melhuish
 * MIT License; see LICENSE in the project root.
 * SPDX-License-Identifier: MIT
 */

import type { RefObject } from 'preact';
import { useAppearance } from '../appearance';
import { currentLogo } from '../branding';

const SVG_NS = 'http://www.w3.org/2000/svg';
/** The chart is drawn 600 units across; the bands above and below are in the same units. */
const SIZE = 600;
const MARGIN = 18;
const NAME_PX = 16;
const LINE_PX = 11.5;
const LOGO = { width: 170, height: 40 };

/** A chart named across the top of a saved picture. */
export interface ExportChart {
  name: string;
  line: string;
}

const PROPS = ['fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-opacity', 'fill-opacity', 'opacity',
  'font-size', 'font-family', 'font-weight', 'letter-spacing'] as const;

let fontFace: Promise<string> | null = null;

/** The symbol font as an @font-face rule with the file inlined, so a saved chart draws the same
 * symbols anywhere (and so the PNG, drawn from the SVG as an image, can use it at all). */
function symbolFontFace(): Promise<string> {
  fontFace ??= fetch('/fonts/StudioAstroGlyphs.woff2')
    .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
    .then((buffer) => {
      let binary = '';
      const bytes = new Uint8Array(buffer);
      for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return `@font-face { font-family: "Studio Astro Glyphs"; src: url(data:font/woff2;base64,${btoa(binary)}) format("woff2"); }`;
    })
    .catch(() => {
      fontFace = null; // try again next time; meanwhile the system symbol fonts stand in
      return '';
    });
  return fontFace;
}

const portable = new Map<string, string>();

/**
 * A colour every SVG viewer understands. Browsers report mixed colours as color(srgb …), which
 * Inkscape, Illustrator and the like draw as black, so those become rgb() or rgba().
 */
function portableColour(value: string): string {
  if (!value.startsWith('color(') && !/^(ok)?(lab|lch)\(/.test(value)) return value;
  let found = portable.get(value);
  if (found === undefined) {
    found = value;
    const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
    if (ctx) {
      ctx.fillStyle = value;
      ctx.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
      found = a === 255 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${(a! / 255).toFixed(3)})`;
    }
    portable.set(value, found);
  }
  return found;
}

/** A copy of the drawing with every style written onto its elements. */
function styledCopy(svg: SVGSVGElement): SVGSVGElement {
  const copy = svg.cloneNode(true) as SVGSVGElement;
  const sources = [svg, ...Array.from(svg.querySelectorAll('*'))];
  const targets = [copy, ...Array.from(copy.querySelectorAll('*'))];
  sources.forEach((el, i) => {
    const style = getComputedStyle(el);
    const target = targets[i] as SVGElement;
    // The page's own custom properties mean nothing elsewhere.
    for (const name of Array.from(target.style)) if (name.startsWith('--')) target.style.removeProperty(name);
    for (const p of PROPS) {
      const value = style.getPropertyValue(p);
      if (value) target.style.setProperty(p, p === 'fill' || p === 'stroke' ? portableColour(value) : value);
    }
    target.removeAttribute('class');
  });
  copy.removeAttribute('style');
  copy.removeAttribute('width');
  copy.removeAttribute('height');
  return copy;
}

const el = <K extends keyof SVGElementTagNameMap>(name: K, attrs: Record<string, string | number> = {}) => {
  const node = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
};

let measurer: CanvasRenderingContext2D | null = null;
function textWidth(text: string, px: number, weight: number, family: string): number {
  measurer ??= document.createElement('canvas').getContext('2d');
  if (!measurer) return text.length * px * 0.55;
  measurer.font = `${weight} ${px}px ${family}`;
  return measurer.measureText(text).width;
}

/** Text broken into lines no wider than `width`; anything past `most` lines ends in "…". */
function wrap(text: string, width: number, most: number, px: number, weight: number, family: string): string[] {
  const fits = (t: string) => textWidth(t, px, weight, family) <= width;
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (fits(next) || !line) line = next;
    else { lines.push(line); line = word; }
  }
  if (line) lines.push(line);
  if (lines.length > most) {
    lines.length = most;
    let last = lines[most - 1]!;
    while (last && !fits(`${last}…`)) last = last.slice(0, -1).trimEnd();
    lines[most - 1] = `${last}…`;
  }
  return lines.map((l) => {
    let out = l;
    while (out.length > 1 && !fits(out)) out = out.slice(0, -2) + '…';
    return out;
  });
}

/** Dark text on a light background and light text on a dark one. */
function inkFor(background: string | null, fallback: string): { strong: string; soft: string } {
  const rgb = (background ?? '').match(/\d+/g)?.map(Number);
  if (!rgb || rgb.length < 3) return { strong: fallback, soft: fallback };
  const [r, g, b] = rgb as [number, number, number];
  const light = (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.55;
  return light ? { strong: '#1f2733', soft: '#55606e' } : { strong: '#f1f4f8', soft: '#b9c2ce' };
}

export interface Layout {
  width: number;
  height: number;
  /** Where the logo goes, in the picture's own units; null when there's no logo. */
  logoBox: { x: number; y: number; width: number; height: number } | null;
}

/**
 * A standalone SVG of the drawing: the chart details above it, the logo below on the right,
 * and the background and symbol font built in. `leaveLogoOut` keeps the room for the
 * logo without drawing it (the PNG draws it itself, which every browser allows).
 */
export function standaloneSvg(svg: SVGSVGElement, background: string | null, fontCss = '', options: {
  charts?: Array<ExportChart | null>; logo?: string | null; leaveLogoOut?: boolean;
} = {}): { text: string; layout: Layout } {
  const family = getComputedStyle(document.body).fontFamily || 'system-ui, sans-serif';
  const sample = svg.querySelector('text');
  const ink = inkFor(background, (sample && getComputedStyle(sample).fill) || '#26303d');
  const half = SIZE / 2 - MARGIN * 1.5;
  const sides = (options.charts ?? []).slice(0, 2).map((c, i) => c && {
    anchor: i === 0 ? 'start' : 'end',
    x: i === 0 ? MARGIN : SIZE - MARGIN,
    name: wrap(c.name, half, 2, NAME_PX, 600, family),
    line: wrap(c.line, half, 2, LINE_PX, 400, family),
  });
  const rows = Math.max(0, ...sides.map((s) => (s ? s.name.length * NAME_PX * 1.25 + s.line.length * LINE_PX * 1.35 : 0)));
  const top = rows ? Math.ceil(rows + MARGIN * 1.6) : 0;
  const bottom = options.logo ? LOGO.height + MARGIN * 1.5 : 0;
  const height = top + SIZE + bottom;

  const out = el('svg', { xmlns: SVG_NS, viewBox: `0 0 ${SIZE} ${height}`, width: SIZE * 2, height: height * 2 });
  if (fontCss) {
    const style = el('style');
    style.textContent = fontCss;
    out.appendChild(style);
  }
  if (background) out.appendChild(el('rect', { width: SIZE, height, fill: background }));

  for (const side of sides) {
    if (!side) continue;
    const text = el('text', { 'text-anchor': side.anchor, 'font-family': family });
    let y = MARGIN;
    side.name.forEach((l) => {
      y += NAME_PX * 1.05;
      const span = el('tspan', { x: side.x, y: y.toFixed(1), 'font-size': NAME_PX, 'font-weight': 600, fill: ink.strong });
      span.textContent = l;
      text.appendChild(span);
      y += NAME_PX * 0.2;
    });
    y += 2;
    side.line.forEach((l) => {
      y += LINE_PX * 1.3;
      const span = el('tspan', { x: side.x, y: y.toFixed(1), 'font-size': LINE_PX, fill: ink.soft });
      span.textContent = l;
      text.appendChild(span);
    });
    out.appendChild(text);
  }

  const chart = styledCopy(svg);
  chart.setAttribute('x', '0');
  chart.setAttribute('y', String(top));
  chart.setAttribute('width', String(SIZE));
  chart.setAttribute('height', String(SIZE));
  if (!chart.getAttribute('viewBox')) chart.setAttribute('viewBox', `0 0 ${SIZE} ${SIZE}`);
  out.appendChild(chart);

  const logoBox = options.logo
    ? { x: SIZE - MARGIN - LOGO.width, y: top + SIZE + MARGIN * 0.5, width: LOGO.width, height: LOGO.height }
    : null;
  if (options.logo && logoBox && !options.leaveLogoOut) {
    out.appendChild(el('image', {
      href: options.logo, x: logoBox.x, y: logoBox.y, width: logoBox.width, height: logoBox.height,
      preserveAspectRatio: 'xMaxYMid meet',
    }));
  }
  return { text: new XMLSerializer().serializeToString(out), layout: { width: SIZE, height, logoBox } };
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('image'));
    image.src = src;
  });
}

/** Any CSS colour (including color-mix results) as rgb(), which every SVG viewer understands. */
function plainColour(css: string): string | null {
  const ctx = document.createElement('canvas').getContext('2d');
  if (!ctx || !css) return null;
  ctx.fillStyle = css;
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
  return a ? `rgb(${r}, ${g}, ${b})` : null;
}

function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const safeName = (name: string) => name.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') || 'chart';

export function ExportButtons({ target, name, charts }: {
  target: RefObject<HTMLElement>; name: string;
  /** Named across the top of the picture: chart 1 on the left, chart 2 (if shown) on the right. */
  charts?: Array<ExportChart | null>;
}) {
  const svg = () => target.current?.querySelector('svg') ?? null;
  const { appearance } = useAppearance();
  // The chart area's own background, so a lightened or darkened canvas is saved as seen,
  // unless My View asks for white or a transparent background.
  const background = (): string | null => {
    if (appearance.export_bg === 'white') return '#ffffff';
    if (appearance.export_bg === 'transparent') return null;
    const stage = target.current?.closest('.workspace__stage');
    const stageBg = stage ? plainColour(getComputedStyle(stage).backgroundColor) : null;
    if (stageBg) return stageBg;
    return plainColour(getComputedStyle(document.documentElement).getPropertyValue('--canvas-bg').trim()) ?? '#ffffff';
  };
  const asSvg = async () => {
    const drawing = svg();
    if (!drawing) return;
    const [font, logo] = await Promise.all([symbolFontFace(), currentLogo()]);
    const { text } = standaloneSvg(drawing, background(), font, { charts, logo });
    download(new Blob([text], { type: 'image/svg+xml' }), `${safeName(name)}.svg`);
  };
  const asPng = async () => {
    const drawing = svg();
    if (!drawing) return;
    const [font, logo] = await Promise.all([symbolFontFace(), currentLogo()]);
    const { text, layout } = standaloneSvg(drawing, background(), font, { charts, logo, leaveLogoOut: true });
    const scale = 1600 / layout.width;
    const canvas = document.createElement('canvas');
    canvas.width = 1600;
    canvas.height = Math.round(layout.height * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(await loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(text)}`), 0, 0, canvas.width, canvas.height);
    if (logo && layout.logoBox) {
      const picture = await loadImage(logo).catch(() => null);
      if (picture) {
        const box = layout.logoBox;
        const w = picture.naturalWidth || box.width;
        const h = picture.naturalHeight || box.height;
        const fit = Math.min(box.width / w, box.height / h);
        const [dw, dh] = [w * fit, h * fit];
        // Right-aligned in its box and centred up and down, as in the SVG.
        ctx.drawImage(picture, (box.x + box.width - dw) * scale, (box.y + (box.height - dh) / 2) * scale, dw * scale, dh * scale);
      }
    }
    canvas.toBlob((blob) => blob && download(blob, `${safeName(name)}.png`), 'image/png');
  };
  return (
    <div class="export">
      <span class="muted small">Save as</span>
      <button type="button" class="link-button" onClick={asPng}>PNG</button>
      <button type="button" class="link-button" onClick={asSvg}>SVG</button>
    </div>
  );
}
