/**
 * AstrologyStudio ·
 * web/scripts/build.mjs
 *
 * Builds the web app into dist/, which the AstrologyStudio server serves.
 *   node scripts/build.mjs           production build (minified)
 *   node scripts/build.mjs --watch   rebuild on change; run `astrologystudio serve` alongside
 *   --with-parent                    (with --watch) stop when the program that started it stops;
 *                                    the server uses this when ASTROLOGYSTUDIO_WEB_WATCH=1
 *
 * Copyright (c) 2026 Gavin Melhuish
 * MIT License; see LICENSE in the project root.
 * SPDX-License-Identifier: MIT
 */

import { build, context } from 'esbuild';
import { watch as watchFile } from 'node:fs';
import { copyFile, mkdir } from 'node:fs/promises';

const watch = process.argv.includes('--watch');
const options = {
  entryPoints: ['src/main.tsx'],
  bundle: true,
  format: 'esm',
  target: 'es2022',
  outfile: 'dist/app.js',
  jsx: 'automatic',
  jsxImportSource: 'preact',
  sourcemap: true,
  minify: !watch,
  logLevel: 'info',
};

const STATIC = [
  ['index.html', 'dist/index.html'],
  ['theme-boot.js', 'dist/theme-boot.js'],
  ['src/styles.css', 'dist/styles.css'],
  // The symbol font (see fonts/make-glyph-font.py) and its licence, which must travel with it.
  ['fonts/StudioAstroGlyphs.woff2', 'dist/fonts/StudioAstroGlyphs.woff2'],
  ['fonts/OFL.txt', 'dist/fonts/OFL.txt'],
];

await mkdir('dist/fonts', { recursive: true });
for (const [from, to] of STATIC) await copyFile(from, to);
if (watch) {
  await (await context(options)).watch();
  if (process.argv.includes('--with-parent')) {
    // The server holds our stdin open; when it stops, stdin closes and so do we.
    process.stdin.on('close', () => process.exit(0));
    process.stdin.on('end', () => process.exit(0));
    process.stdin.resume();
  }
  // esbuild only watches the code, so copy the page and styles again whenever they change.
  for (const [from, to] of STATIC) {
    watchFile(from, () => copyFile(from, to).then(() => console.log(`[watch] copied ${from}`)).catch(() => {}));
  }
} else {
  await build(options);
}
