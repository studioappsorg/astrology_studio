/**
 * AstrologyStudio ·
 * web/src/components/Export.tsx
 *
 * Saving a wheel or dial as an SVG or PNG file. The drawing takes its colours from the
 * page's styles, so they're copied onto each element before it leaves the page.
 *
 * Copyright (c) 2026 Gavin Melhuish
 * MIT License; see LICENSE in the project root.
 * SPDX-License-Identifier: MIT
 */

import type { RefObject } from 'preact';
import { useAppearance } from '../appearance';

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

/** A standalone copy of an SVG with every style written onto its elements. */
export function standaloneSvg(svg: SVGSVGElement, background: string | null, fontCss = ''): string {
  const copy = svg.cloneNode(true) as SVGSVGElement;
  const sources = [svg, ...Array.from(svg.querySelectorAll('*'))];
  const targets = [copy, ...Array.from(copy.querySelectorAll('*'))];
  sources.forEach((el, i) => {
    const style = getComputedStyle(el);
    const target = targets[i] as SVGElement;
    for (const p of PROPS) {
      const value = style.getPropertyValue(p);
      if (value) target.style.setProperty(p, value);
    }
    target.removeAttribute('class');
  });
  copy.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  copy.setAttribute('width', '1200');
  copy.setAttribute('height', '1200');
  copy.removeAttribute('style');
  if (background) {
    const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    bg.setAttribute('width', '600');
    bg.setAttribute('height', '600');
    bg.setAttribute('fill', background);
    copy.insertBefore(bg, copy.firstChild);
  }
  if (fontCss) {
    const style = document.createElementNS('http://www.w3.org/2000/svg', 'style');
    style.textContent = fontCss;
    copy.insertBefore(style, copy.firstChild);
  }
  return new XMLSerializer().serializeToString(copy);
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

export function ExportButtons({ target, name }: { target: RefObject<HTMLElement>; name: string }) {
  const svg = () => target.current?.querySelector('svg') ?? null;
  const { appearance } = useAppearance();
  // The chart area's own background, so a lightened or darkened canvas is saved as seen,
  // unless Your view asks for white or a transparent background.
  const background = (): string | null => {
    if (appearance.export_bg === 'white') return '#ffffff';
    if (appearance.export_bg === 'transparent') return null;
    const stage = target.current?.closest('.workspace__stage');
    const stageBg = stage ? plainColour(getComputedStyle(stage).backgroundColor) : null;
    if (stageBg) return stageBg;
    return plainColour(getComputedStyle(document.documentElement).getPropertyValue('--canvas-bg').trim()) ?? '#ffffff';
  };
  const asSvg = async () => {
    const el = svg();
    if (!el) return;
    const svgText = standaloneSvg(el, background(), await symbolFontFace());
    download(new Blob([svgText], { type: 'image/svg+xml' }), `${safeName(name)}.svg`);
  };
  const asPng = async () => {
    const el = svg();
    if (!el) return;
    const svgText = standaloneSvg(el, background(), await symbolFontFace());
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = 1600;
      canvas.height = 1600;
      canvas.getContext('2d')?.drawImage(image, 0, 0, 1600, 1600);
      canvas.toBlob((blob) => blob && download(blob, `${safeName(name)}.png`), 'image/png');
    };
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgText)}`;
  };
  return (
    <div class="export">
      <span class="muted small">Save as</span>
      <button type="button" class="link-button" onClick={asPng}>PNG</button>
      <button type="button" class="link-button" onClick={asSvg}>SVG</button>
    </div>
  );
}
