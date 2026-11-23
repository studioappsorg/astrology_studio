/**
 * AstrologyStudio ·
 * web/scripts/test.mjs
 *
 * Unit tests for the web app's pure modules (geometry, formats, colours, presets).
 * Each tests/*.test.ts is bundled with esbuild and run with Node's own test runner, so no test
 * framework is needed. Usage: npm test
 *
 * Copyright (c) 2026 Gavin Melhuish
 * MIT License; see LICENSE in the project root.
 * SPDX-License-Identifier: MIT
 */

import { build } from 'esbuild';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const dir = new URL('../tests/', import.meta.url).pathname;
const files = readdirSync(dir).filter((f) => f.endsWith('.test.ts'));
const out = mkdtempSync(join(tmpdir(), 'as-web-tests-'));
try {
  await build({
    entryPoints: files.map((f) => join(dir, f)),
    outdir: out,
    bundle: true,
    platform: 'node',
    format: 'esm',
    outExtension: { '.js': '.mjs' },
    logLevel: 'warning',
  });
  const result = spawnSync(process.execPath, ['--test', ...files.map((f) => join(out, f.replace(/\.ts$/, '.mjs')))], { stdio: 'inherit' });
  process.exitCode = result.status ?? 1;
} finally {
  rmSync(out, { recursive: true, force: true });
}
