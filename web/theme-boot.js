/*
 * AstrologyStudio ·
 * web/theme-boot.js
 *
 * Applies the remembered light/dark choice before the first paint (see src/theme.ts). A file of
 * its own rather than inline, so the page's Content Security Policy can forbid inline scripts.
 *
 * Copyright (c) 2026 Gavin Melhuish
 * MIT License; see LICENSE in the project root.
 * SPDX-License-Identifier: MIT
 */
try {
  var theme = null, saved = /(?:^|;\s*)as_pref_theme=([^;]*)/.exec(document.cookie);
  try { theme = JSON.parse(decodeURIComponent(saved ? saved[1] : 'null')); } catch (e) {}
  if (theme !== 'light' && theme !== 'dark') theme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  document.documentElement.dataset.theme = theme;
} catch (e) {}
