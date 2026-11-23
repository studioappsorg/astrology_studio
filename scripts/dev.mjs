/**
 * AstrologyStudio ·
 * scripts/dev.mjs
 *
 * What F5 runs (the "AstrologyStudio" configuration in .vscode/launch.json).
 *
 * 1. scripts/dev_setup.py: makes .venv and installs packages, only when needed.
 * 2. Starts the server from .venv on port 8100; the server builds the web app and rebuilds it
 *    as you save. VS Code opens the browser when the server says it's running.
 * Stopping the debug session stops the server too.
 *
 * It's a Node script so that F5 works on a fresh copy: VS Code runs Node itself, while the
 * Python debugger needs .venv to exist before it will start.
 *
 * Copyright (c) 2026 Gavin Melhuish
 * MIT License; see LICENSE in the project root.
 * SPDX-License-Identifier: MIT
 */

import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const windows = process.platform === 'win32';
const port = process.env.ASTROLOGYSTUDIO_PORT || '8100';

// A Python 3.12 or newer to make .venv with. macOS's own python3 is often older, so try the
// versioned names and Homebrew's too.
function findPython() {
  const candidates = windows
    ? [['py', '-3.13'], ['py', '-3.12'], ['py', '-3'], ['python']]
    : ['python3.14', 'python3.13', 'python3.12', '/opt/homebrew/bin/python3', '/usr/local/bin/python3', 'python3']
        .map((c) => [c]);
  for (const [cmd, ...pre] of candidates) {
    const r = spawnSync(cmd, [...pre, '-c', 'import sys; print(sys.version_info >= (3, 12))'], { encoding: 'utf8' });
    if (r.status === 0 && r.stdout.trim() === 'True') return [cmd, ...pre];
  }
  return null;
}

const venvPython = join(root, '.venv', windows ? 'Scripts/python.exe' : 'bin/python');
const python = existsSync(venvPython) ? [venvPython] : findPython();
if (!python) {
  console.error('AstrologyStudio needs Python 3.12 or newer, and none was found.\n'
    + (windows ? 'Install it from python.org, ticking "Add python.exe to PATH".'
               : 'Install it from python.org or with Homebrew (brew install python@3.13).')
    + '\nThen restart VS Code and press F5 again.');
  process.exit(1);
}

console.log('Checking the setup …');
const setup = spawnSync(python[0], [...python.slice(1), join(root, 'scripts', 'dev_setup.py')], { cwd: root, stdio: 'inherit' });
if (setup.status !== 0) process.exit(setup.status ?? 1);

const server = spawn(venvPython, ['-m', 'astrologystudio.cli', 'serve', '--port', port], {
  cwd: root,
  stdio: ['pipe', 'inherit', 'inherit'],
  env: {
    ...process.env,
    PYTHONUNBUFFERED: '1',
    ASTROLOGYSTUDIO_DATA_DIR: process.env.ASTROLOGYSTUDIO_DATA_DIR || join(root, 'data'),
    ASTROLOGYSTUDIO_BASE_URL: process.env.ASTROLOGYSTUDIO_BASE_URL || `http://localhost:${port}`,
    ASTROLOGYSTUDIO_WEB_WATCH: '1',
    ASTROLOGYSTUDIO_EXIT_WITH_LAUNCHER: '1',
  },
});
// The server stops when this pipe closes, which happens however this script ends.
const stop = () => { server.stdin.end(); setTimeout(() => process.exit(0), 3000).unref(); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
server.on('exit', (code) => process.exit(code ?? 0));
