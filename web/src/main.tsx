/**
 * AstrologyStudio ·
 * web/src/main.tsx
 *
 * The web app's entry point:
 *
 * applies the saved theme, then starts the app.
 *
 * Copyright (c) 2026 Gavin Melhuish
 * MIT License; see LICENSE in the project root.
 * SPDX-License-Identifier: MIT
 */

import { render } from 'preact';
import { App } from './app';
import { startTheme } from './theme';

startTheme();
render(<App />, document.getElementById('app')!);
