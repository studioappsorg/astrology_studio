/**
 * AstrologyStudio ·
 * web/src/appearance.tsx
 *
 * Appearance:
 *
 * the theme that colours the canvas, charts and dials, each person's display options (text and
 * symbol size, line weight, how degrees, dates and times are written) and the layouts charts and
 * dials are drawn with.
 *
 * A theme never colours the app window itself (the bar, panels, menus, forms): those follow the
 * light/dark toggle. The toggle also picks the theme's light or dark version.
 *
 * The chosen theme's colours are written as --t-* custom properties on the page; styles.css
 * maps them to the names the drawing rules use. A preview sets its own --t-* properties on a
 * .themed element and wraps itself in a ChartStyle provider for the theme's colouring choices.
 *
 * Copyright (c) 2026 Gavin Melhuish
 * MIT License; see LICENSE in the project root.
 * SPDX-License-Identifier: MIT
 */

import { createContext, Fragment, type ComponentChildren } from 'preact';
import { useCallback, useContext, useEffect, useLayoutEffect, useMemo, useState } from 'preact/hooks';
import { api } from './api';
import { element, norm, signIndex } from './astro';
import type { DisplayKey } from './display';
import { setFormats } from './fmt';
import { useTheme, type Theme as Mode } from './theme';

export type SignMode = 'element' | 'modality' | 'sign' | 'plain';
export type BodyMode = 'single' | 'element' | 'sect' | 'body';
export type Dash = 'solid' | 'dashed' | 'dotted';

export interface Theme {
  id: string;
  name: string;
  kind: 'builtin' | 'site' | 'own';
  base: string;
  version: number;
  signs: SignMode;
  bodies: BodyMode;
  dashes: Record<string, Dash>;
  light: Record<string, string>;
  dark: Record<string, string>;
}

export interface Appearance {
  theme: string;
  text_size: 90 | 100 | 115 | 130;
  glyph_size: 'small' | 'medium' | 'large';
  line_weight: 'fine' | 'normal' | 'bold';
  degrees: 'dm' | 'dms' | 'decimal';
  date_format: 'ymd' | 'dmy' | 'mdy';
  time_format: '24' | '12';
  retro: 'symbol' | 'letter';
  reduce_motion: boolean;
  export_bg: 'theme' | 'white' | 'transparent';
}

export type LayoutOptions = Record<string, string | boolean>;

export interface Layout {
  id: string;
  name: string;
  display: DisplayKey;
  kind: 'builtin' | 'own';
  options: LayoutOptions;
}

/** What chart 2 is in a preset's view (1.12). */
export type PartnerRoleKey = 'none' | 'ask' | 'transits_now' | 'progressions_now' | 'solar_arc_now'
  | 'solar_return_next' | 'lunar_return_next' | 'fixed';
export interface PartnerRole {
  role: PartnerRoleKey;
  /** For `fixed`: the chart. */
  chart?: { id: string; derived: boolean; parent?: string | null } | null;
  chart_name?: string | null;
}

/** One view of a preset. */
export interface ViewTemplate {
  name: string | null;
  display: DisplayKey;
  dial_size: number | null;
  layout: string | null;
  report: 'chart' | 'overview' | 'aspects' | 'midpoints' | 'hellenistic' | 'events';
  between: boolean;
  partner: PartnerRole;
}

export interface Preset {
  id: string;
  name: string;
  /** The views a chart opens with (1.12). The fields below repeat the first view, as before 1.12. */
  views: ViewTemplate[];
  display: DisplayKey;
  dial_size: number | null;
  layout: string | null;
  theme: string | null;
  profile: string | null;
  panel: { aspectarian: boolean; trees: boolean; timing: boolean };
}

export type PresetBody = Omit<Preset, 'id' | 'views'> & { views?: ViewTemplate[] };

export interface AppearanceView {
  appearance: Appearance;
  themes: Theme[];
  site_default: string;
  layouts: Layout[];
  presets: Preset[];
  created?: string;
}

/** The calculation profiles, for presets (which profile to use) and the panel. */
export interface ProfileList { active: string; profiles: Array<{ id: string; name: string }> }

/** Charts are calculated with the active profile, so screens reload them when it changes. */
export const PROFILE_CHANGED = 'astrologystudio:profile-changed';

export interface AppearanceCatalog {
  tokens: Array<{ key: string; group: string; label: string }>;
  groups: Array<{ key: string; label: string }>;
  sign_modes: SignMode[];
  body_modes: BodyMode[];
  dashes: Dash[];
  options: Record<DisplayKey, Record<string, Array<string | boolean>>>;
  appearance: Record<string, Array<string | number | boolean>>;
  min_dial: number;
}

export type ThemeChange = Partial<Pick<Theme, 'name' | 'signs' | 'bodies' | 'dashes' | 'light' | 'dark'>>;

interface AppearanceValue {
  view: AppearanceView;
  catalog: AppearanceCatalog | null;
  appearance: Appearance;
  theme: Theme;
  mode: Mode;
  change: (patch: Partial<Appearance>) => Promise<void>;
  copyTheme: (name: string, from: string) => Promise<string>;
  importTheme: (theme: unknown) => Promise<string>;
  patchTheme: (id: string, change: ThemeChange) => Promise<void>;
  deleteTheme: (id: string) => Promise<void>;
  publishTheme: (id: string) => Promise<void>;
  withdrawTheme: (id: string) => Promise<void>;
  setSiteDefault: (id: string) => Promise<void>;
  copyLayout: (name: string, from: string) => Promise<string>;
  patchLayout: (id: string, change: { name?: string; options?: LayoutOptions }) => Promise<void>;
  deleteLayout: (id: string) => Promise<void>;
  profiles: ProfileList | null;
  activateProfile: (id: string) => Promise<void>;
  addPreset: (body: PresetBody) => Promise<string>;
  patchPreset: (id: string, change: Partial<PresetBody>) => Promise<void>;
  deletePreset: (id: string) => Promise<void>;
  orderPresets: (ids: string[]) => Promise<void>;
}

const AppearanceContext = createContext<AppearanceValue | null>(null);

/** Colours copied from the theme's other version, for text on a canvas lightened or darkened past halfway. */
const ALT = ['text', 'muted', 'faint', 'pointer-axis', 'canvas-text', 'tree-text'];

/** A theme's colours for one version, as --t-* custom properties. */
export function tokenVars(theme: Theme, mode: Mode): Record<string, string> {
  const own = theme[mode];
  const other = theme[mode === 'light' ? 'dark' : 'light'];
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(own)) out[`--t-${k}`] = v;
  for (const k of ALT) if (other[k]) out[`--t-alt-${k}`] = other[k]!;
  return out;
}

function themeCss(theme: Theme): string {
  const block = (mode: Mode) => Object.entries(tokenVars(theme, mode)).map(([k, v]) => `${k}:${v};`).join('');
  return `:root{${block('light')}}:root[data-theme="dark"]{${block('dark')}}`;
}

function applyTheme(theme: Theme): void {
  let el = document.getElementById('theme-tokens') as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement('style');
    el.id = 'theme-tokens';
    document.head.appendChild(el);
  }
  el.textContent = themeCss(theme);
}

function applyOptions(a: Appearance): void {
  const root = document.documentElement;
  root.dataset.lines = a.line_weight;
  root.dataset.motion = a.reduce_motion ? 'reduce' : 'normal';
  // zoom scales everything in the app evenly, and pointer positions with it.
  (document.body.style as CSSStyleDeclaration & { zoom: string }).zoom = a.text_size === 100 ? '' : String(a.text_size / 100);
  setFormats({ degrees: a.degrees, date_format: a.date_format, time_format: a.time_format, retro: a.retro });
}

export function AppearanceProvider({ children }: { children: ComponentChildren }) {
  const [view, setView] = useState<AppearanceView | null>(null);
  const [catalog, setCatalog] = useState<AppearanceCatalog | null>(null);
  const [failed, setFailed] = useState(false);
  const [profiles, setProfiles] = useState<ProfileList | null>(null);
  const [mode] = useTheme();

  const loadView = () => {
    setFailed(false);
    api<AppearanceView>('/preferences/appearance').then(setView).catch(() => setFailed(true));
  };
  useEffect(() => {
    loadView();
    api<AppearanceCatalog>('/preferences/appearance-catalog').then(setCatalog).catch(() => undefined);
    const loadProfiles = () => void api<ProfileList>('/preferences/calculation').then(setProfiles).catch(() => undefined);
    loadProfiles();
    // The Settings page can change the active profile too.
    window.addEventListener(PROFILE_CHANGED, loadProfiles);
    return () => window.removeEventListener(PROFILE_CHANGED, loadProfiles);
  }, []);

  const theme = useMemo(() => {
    if (!view) return null;
    return view.themes.find((t) => t.id === view.appearance.theme) ?? view.themes[0]!;
  }, [view]);

  // Before the browser paints, so charts never show in the previous theme's colours.
  useLayoutEffect(() => { if (theme) applyTheme(theme); }, [theme]);
  useLayoutEffect(() => { if (view) applyOptions(view.appearance); }, [view?.appearance]);

  const call = useCallback(async (path: string, method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', body?: unknown): Promise<AppearanceView> => {
    const next = await api<AppearanceView>(path, method, body);
    setView(next);
    return next;
  }, []);

  if (!view || !theme) {
    // Wait a moment for the theme; every screen needs it. If it can't be loaded, say so and offer
    // to try again rather than showing screens that can't work. (Until it arrives, styles.css
    // carries Studio's colours.)
    return failed ? (
      <main class="auth">
        <div class="notice notice--error" role="alert">
          AstrologyStudio couldn't load your settings. Check the connection, then
          {' '}<button type="button" class="link-button" onClick={loadView}>try again</button>.
        </div>
      </main>
    ) : null;
  }

  const value: AppearanceValue = {
    view,
    catalog,
    appearance: view.appearance,
    theme,
    mode,
    change: async (patch) => { await call('/preferences/appearance', 'PATCH', patch); },
    copyTheme: async (name, from) => (await call('/preferences/themes', 'POST', { name, copy_from: from })).created!,
    importTheme: async (raw) => (await call('/preferences/themes/import', 'POST', { theme: raw })).created!,
    patchTheme: async (id, change) => { await call(`/preferences/themes/${id}`, 'PATCH', change); },
    deleteTheme: async (id) => { await call(`/preferences/themes/${id}`, 'DELETE'); },
    publishTheme: async (id) => { await call('/site/themes', 'POST', { theme_id: id }); },
    withdrawTheme: async (id) => { await call(`/site/themes/${id}`, 'DELETE'); },
    setSiteDefault: async (id) => { await call('/site/default-theme', 'PUT', { theme_id: id }); },
    copyLayout: async (name, from) => (await call('/preferences/layouts', 'POST', { name, copy_from: from })).created!,
    patchLayout: async (id, change) => { await call(`/preferences/layouts/${id}`, 'PATCH', change); },
    deleteLayout: async (id) => { await call(`/preferences/layouts/${id}`, 'DELETE'); },
    profiles,
    activateProfile: async (id) => {
      if (profiles?.active === id) return;
      await api(`/preferences/profiles/${id}/activate`, 'POST');
      window.dispatchEvent(new Event(PROFILE_CHANGED));
    },
    addPreset: async (body) => (await call('/preferences/presets', 'POST', body)).created!,
    patchPreset: async (id, change) => { await call(`/preferences/presets/${id}`, 'PATCH', change); },
    deletePreset: async (id) => { await call(`/preferences/presets/${id}`, 'DELETE'); },
    orderPresets: async (ids) => { await call('/preferences/presets-order', 'PUT', { ids }); },
  };
  const a = view.appearance;
  // Formats are read while drawing, so screens are redrawn when they change.
  const formatKey = `${a.degrees}|${a.date_format}|${a.time_format}|${a.retro}`;
  return (
    <AppearanceContext.Provider value={value}>
      <ChartStyleContext.Provider value={chartStyleOf(theme, a)}>
        <Fragment key={formatKey}>{children}</Fragment>
      </ChartStyleContext.Provider>
    </AppearanceContext.Provider>
  );
}

export function useAppearance(): AppearanceValue {
  const value = useContext(AppearanceContext);
  if (!value) throw new Error('useAppearance() used outside AppearanceProvider');
  return value;
}

// ---------------------------------------------------------------------------
// What the wheel and dial need from the theme and display options

export interface ChartStyle {
  signs: SignMode;
  bodies: BodyMode;
  dashes: Record<string, Dash>;
  /** Symbols' size, from My View (small, medium or large). A layout can enlarge them further. */
  glyphScale: number;
}

const GLYPH_SCALE = { small: 0.86, medium: 1, large: 1.16 } as const;

export function chartStyleOf(theme: Theme, a?: Pick<Appearance, 'glyph_size'>): ChartStyle {
  return { signs: theme.signs, bodies: theme.bodies, dashes: theme.dashes, glyphScale: GLYPH_SCALE[a?.glyph_size ?? 'medium'] };
}

export const ChartStyleContext = createContext<ChartStyle>({ signs: 'element', bodies: 'single', dashes: {}, glyphScale: 1 });

export function useChartStyle(): ChartStyle {
  return useContext(ChartStyleContext);
}

const SIGN_KEYS = ['aries', 'taurus', 'gemini', 'cancer', 'leo', 'virgo', 'libra', 'scorpio', 'sagittarius', 'capricorn', 'aquarius', 'pisces'];
const MODALITIES = ['cardinal', 'fixed', 'mutable'];

/** The fill for a sign's stretch of the band (0 = Aries). */
export function signFill(style: ChartStyle, sign: number): string {
  const s = ((sign % 12) + 12) % 12;
  switch (style.signs) {
    case 'modality': return `var(--t-${MODALITIES[s % 3]})`;
    case 'sign': return `var(--t-${SIGN_KEYS[s]})`;
    case 'plain': return 'var(--wheel-inner, var(--wheel-bg))';
    default: return `var(--t-${element(s)})`;
  }
}

const COLOURED = new Set(['sun', 'moon', 'mercury', 'venus', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune', 'pluto']);
const DAY_SECT = new Set(['sun', 'jupiter', 'saturn']);
const NIGHT_SECT = new Set(['moon', 'venus', 'mars']);

/** The colour of a body's symbol in chart 1. `sun` is the Sun's longitude, for Mercury's sect. */
export function bodyFill(style: ChartStyle, key: string, lon: number, sun?: number): string {
  switch (style.bodies) {
    case 'element': return `var(--t-ink-${element(signIndex(lon))})`;
    case 'body': return COLOURED.has(key) ? `var(--t-body-${key})` : 'var(--t-body-other)';
    case 'sect': {
      if (DAY_SECT.has(key)) return 'var(--t-sect-day)';
      if (NIGHT_SECT.has(key)) return 'var(--t-sect-night)';
      // Mercury joins the day sect as a morning star (rising before the Sun), the night sect as an evening star.
      if (key === 'mercury' && sun !== undefined) return norm(sun - lon) < 180 ? 'var(--t-sect-day)' : 'var(--t-sect-night)';
      return 'var(--t-body)';
    }
    default: return 'var(--t-body)';
  }
}

/** An aspect line's colour and dash pattern. */
export function aspectStroke(style: ChartStyle, aspect: string): { stroke: string; strokeDasharray?: string } {
  const dash = style.dashes[aspect];
  return {
    stroke: `var(--t-aspect-${aspect})`,
    strokeDasharray: dash === 'dashed' ? '5 3' : dash === 'dotted' ? '1.4 2.6' : undefined,
  };
}

// ---------------------------------------------------------------------------
// Layouts

/** The layouts offered for a chart type: the built-ins, then your own. */
export function useLayouts(display: DisplayKey): Layout[] {
  return useAppearance().view.layouts.filter((l) => l.display === display);
}
