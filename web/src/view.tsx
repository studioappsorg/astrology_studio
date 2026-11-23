/**
 * AstrologyStudio ·
 * web/src/view.tsx
 *
 * "Your view":
 *
 * which major features and which bodies each person wants to see. Loaded once when the app starts;
 * every screen reads it from here, and a change made in Settings updates every screen straight
 * away.
 *
 * Copyright (c) 2026 Gavin Melhuish
 * MIT License; see LICENSE in the project root.
 * SPDX-License-Identifier: MIT
 */

import { createContext, type ComponentChildren } from 'preact';
import { useCallback, useContext, useEffect, useLayoutEffect, useState } from 'preact/hooks';
import { api, type Catalog, type Display, type School, type ViewSwitches } from './api';
import { setGlyphStyle } from './astro';

export interface ViewContextValue {
  switches: ViewSwitches;
  catalog: Catalog;
  feature: (key: string) => boolean;
  body: (key: string) => boolean;
  display: Display;
  update: (changes: Partial<ViewSwitches> & { reset?: boolean }) => Promise<void>;
  /** Switch off every feature and body the school doesn't use. */
  limitToSchool: (school: School) => Promise<void>;
}

const EMPTY: ViewSwitches = { features: {}, bodies: {} };
const ViewContext = createContext<ViewContextValue | null>(null);

export function ViewProvider({ children }: { children: ComponentChildren }) {
  const [switches, setSwitches] = useState<ViewSwitches>(EMPTY);
  const [catalog, setCatalog] = useState<Catalog>({ features: [], bodies: [] });

  useEffect(() => {
    void api<ViewSwitches>('/preferences/view').then(setSwitches).catch(() => undefined);
    void api<Catalog>('/preferences/catalog').then(setCatalog).catch(() => undefined);
  }, []);

  const display: Display = { school: 'self', ...(switches.display ?? { glyphs: 'symbols', colours: 'studio' }) };
  setGlyphStyle(display.glyphs);
  // Your aspect colours (Your view → Aspects) over the theme's, in light and dark alike.
  useLayoutEffect(() => applyAspectColours(switches.aspect_colours ?? {}), [JSON.stringify(switches.aspect_colours ?? {})]);

  const update = useCallback(async (changes: Partial<ViewSwitches> & { reset?: boolean }) => {
    setSwitches(await api<ViewSwitches>('/preferences/view', 'PATCH', changes));
  }, []);

  const limitToSchool = useCallback(async (school: School) => {
    setSwitches(await api<ViewSwitches>('/preferences/limit-to-school', 'POST', { school }));
  }, []);

  const value: ViewContextValue = {
    switches,
    catalog,
    // Until the switches arrive, show everything rather than hiding things for a moment.
    feature: (key) => switches.features[key] ?? true,
    body: (key) => switches.bodies[key] ?? catalog.bodies.find((b) => b.key === key)?.default ?? true,
    display,
    update,
    limitToSchool,
  };
  return <ViewContext.Provider value={value}>{children}</ViewContext.Provider>;
}

/** The theme sets --t-aspect-* on :root (and :root[data-theme="dark"]); this sheet comes later
 * with a more specific selector, so your colours win in either mode. */
function applyAspectColours(colours: Record<string, string | null>): void {
  let el = document.getElementById('aspect-colours') as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement('style');
    el.id = 'aspect-colours';
    document.head.appendChild(el);
  }
  const vars = Object.entries(colours).filter(([k, v]) => v && /^[a-z]+$/.test(k) && /^#[0-9a-f]{6}$/i.test(v)).map(([k, v]) => `--t-aspect-${k}:${v};`).join('');
  el.textContent = vars ? `:root:root:root{${vars}}` : '';
}

export function useView(): ViewContextValue {
  const value = useContext(ViewContext);
  if (!value) throw new Error('useView() used outside ViewProvider');
  return value;
}
