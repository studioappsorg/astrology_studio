/**
 * AstrologyStudio ·
 * web/src/api.ts
 *
 * Talking to the AstrologyStudio API from the browser.
 *
 * The session cookie travels automatically. Every change also carries the
 * session's CSRF token. Errors arrive as RFC 9457 problem details and are
 * thrown as ApiError. The browser never talks to ephemeralREST directly.
 *
 * Copyright (c) 2026 Gavin Melhuish
 * MIT License; see LICENSE in the project root.
 * SPDX-License-Identifier: MIT
 */

export interface FieldError {
  location: string;
  message: string;
}

export class ApiError extends Error {
  readonly status: number;
  readonly type: string;
  readonly detail: string | undefined;
  readonly errors: FieldError[];

  constructor(status: number, body: Record<string, unknown> | null) {
    super(String(body?.title ?? `Request failed (${status})`));
    this.status = status;
    this.type = String(body?.type ?? '');
    this.detail = typeof body?.detail === 'string' ? body.detail : undefined;
    this.errors = Array.isArray(body?.errors) ? (body.errors as FieldError[]) : [];
  }

  /** The problem's short name, e.g. "no-api-key". */
  get slug(): string {
    return this.type.split('/').pop() ?? '';
  }

  /** One line suitable for showing to a person. */
  get summary(): string {
    if (this.errors.length) return this.errors.map((e) => `${e.location.replace(/^body\./, '')}: ${e.message}`).join(' ');
    return this.detail ? `${this.message}. ${this.detail}` : this.message;
  }
}

let csrfToken: string | null = null;
let onSignedOut: (() => void) | null = null;

export function setCsrfToken(token: string | null): void {
  csrfToken = token;
}

export function getCsrfToken(): string | null {
  return csrfToken;
}

/** Called when the server says the session has ended (expired, or logged out elsewhere). */
export function onSessionEnded(handler: () => void): void {
  onSignedOut = handler;
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export async function api<T>(path: string, method: Method = 'GET', body?: unknown): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET' && csrfToken) headers['X-CSRF-Token'] = csrfToken;

  const response = await fetch(`/api/v1${path}`, {
    method,
    headers,
    credentials: 'same-origin',
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (response.status === 204) return undefined as T;

  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const problem = (data && typeof data === 'object' ? data : null) as Record<string, unknown> | null;
    if (response.status === 401 && !path.startsWith('/auth/')) onSignedOut?.();
    throw new ApiError(response.status, problem);
  }
  return data as T;
}

// ---------------------------------------------------------------------------
// Shapes returned by the API (the parts the app uses)

export interface User {
  id: string;
  email: string;
  name: string;
  is_owner: boolean;
  created_at: string;
  last_login_at: string | null;
  /** 'ephemeral': logs in with their ephemeralREST email, password and emailed code. */
  signs_in_with: 'password' | 'ephemeral';
}

/** A person as the owner sees them in Users. */
export interface ListedUser extends User {
  disabled: boolean;
  disabled_at: string | null;
  /** Only the owner sees it. */
  disabled_reason: string | null;
}

export type Period = 'hour' | 'day' | 'week' | 'month';
export const PERIODS: Period[] = ['hour', 'day', 'week', 'month'];
export type Limits = Record<Period, number | null>;

export interface Usage {
  /** Whose limits apply: their own, the site's defaults, or none (the owner). */
  source: 'own' | 'site' | 'owner';
  time_zone: string;
  periods: Record<Period, { used: number; limit: number | null; resets_at: string }>;
}

export interface UserDetail extends ListedUser {
  key_prefix: string | null;
  /** The key's own limits at ephemeralREST (read only), e.g. { per_minute: 10, per_day: 500 }. */
  ephemeral_limits: Record<string, number> | null;
  limits: Limits | null;
  uses_site_defaults: boolean;
  site_defaults: Limits;
  usage: Usage;
}

export interface ActivityEvent {
  id: number;
  at: string;
  event: string;
  outcome: string;
  detail: string;
  ip: string;
  user_agent: string;
  failed: boolean;
  /** In everyone's activity only. */
  user_id?: string | null;
  email?: string;
}

export interface ActivityPage {
  data: ActivityEvent[];
  next: number | null;
}

export interface Session {
  user: User;
  csrf_token: string;
}

export interface AuthStatus {
  setup_required: boolean;
  registration_open: boolean;
  /** "Forgot your password?" is offered (the owner has set up email). */
  password_reset?: boolean;
  /** A hosted service: ephemeralREST is kept out of sight for everyone but the owner. */
  hosted?: boolean;
  /** "here": sign-up emails link back to this site's own pages; "portal": to ephemeralREST's. */
  signup_flow?: 'here' | 'portal';
  user: Session | null;
}

/** Where a sign-up email was sent, and whose pages its link opens. */
export interface SignupSent {
  email: string;
  flow: 'here' | 'portal';
}

/** The site key: a domain key so sign-up emails link back to this site (owner only). */
export interface SiteKeyStatus {
  configured: boolean;
  prefix: string | null;
  domain: string | null;
  origin: string;
  links_here: boolean;
  reason: string | null;
}

export interface Connection {
  url: string | null;
  reachable: boolean;
  problem: string | null;
}

export interface KeyStatus {
  configured: boolean;
  prefix?: string;
  identity?: { name?: string; identifier?: string; rate_limits?: Record<string, number> } | null;
  checked_at?: string | null;
  updated_at?: string;
  /** After saving: "saved", or "choose" when the new key's chart list is missing `missing` of
   * your charts (answer at /account/ephemeral-key/pending), or "cancelled". */
  status?: 'saved' | 'choose' | 'cancelled';
  missing?: number;
  added?: number;
}

export interface CatalogBody {
  key: string;
  label: string;
  glyph: string;
  group: string;
  default: boolean;
}

export interface Display {
  glyphs: 'symbols' | 'letters';
  colours: 'studio' | 'classic' | 'mono';
  school?: School;
}

export interface SchoolInfo {
  key: School;
  label: string;
  hint?: string;
  features: string[];
  bodies: string[];
}

export interface Catalog {
  display?: Record<string, string[]>;
  features: Array<{ key: string; label: string }>;
  bodies: CatalogBody[];
  schools?: SchoolInfo[];
}

export interface ViewSwitches {
  features: Record<string, boolean>;
  bodies: Record<string, boolean>;
  display?: Display;
  /** Your own colour for an aspect (#rrggbb), over the theme's; null in a change goes back to the theme's. */
  aspect_colours?: Record<string, string | null>;
}

export interface ChartNote {
  folder_id: string | null;
  tags: string[];
  rating: string;
  source: string;
  notes: string;
  time_unknown: boolean;
  utc_offset: string;
  /** The chart's own house system; "" to use the default. */
  house_system: string;
}

export interface ChartSummary extends ChartNote {
  id: string;
  name: string;
  date: string | null;
  time: string | null;
  place: string | null;
  updated_at: string | null;
  /** Charts worked out from this one (progressions, directions, returns), kept in ephemeralREST. */
  derived: Array<{ id: string; name: string; date: string | null }>;
}

export type DerivedKind = 'transits' | 'progressed' | 'solar_arc' | 'solar_return' | 'lunar_return' | 'harmonic' | 'composite' | 'davison';

/** A derived chart: positions like any chart, plus what it was worked out from. */
export interface DerivedDetail extends ChartData {
  aspects: FoundAspect[];
  sidereal_pending?: boolean;
  aspects_helio: FoundAspect[];
  kind: DerivedKind | string;
  parent_id: string | null;
  reference_date: string | null;
  moment_utc: string | null;
  arc: number | null;
  /** Harmonic charts: the harmonic number. */
  harmonic?: number;
  /** Composite and Davison charts: the second chart. */
  other_id?: string;
  hellenistic?: HellenisticBlock | null;
}

export interface Point {
  lon: number;
  lat: number;
  speed: number | null;
  decl: number | null;
  ra: number | null;
  retro: boolean;
}

export interface ChartData {
  id: string;
  name: string;
  datetime_utc: string;
  datetime_local: string;
  location: {
    name: string;
    latitude: number | null;
    longitude: number | null;
    timezone: string | null;
    utc_offset_seconds: number | null;
    daylight_saving: boolean | null;
  };
  house_system: string | null;
  houses: number[] | null;
  points: Record<string, Point>;
  helio: Record<string, Point>;
  /** Tropical, or sidereal by `ayanamsa` (its `value` in degrees taken off every longitude). */
  zodiac?: ZodiacUsed;
}

export interface FoundAspect {
  a: string;
  b: string;
  aspect: string;
  orb: number;
  applying: boolean | null;
  /** Aspects by whole sign (Hellenistic chart). */
  by_sign?: boolean;
  degrees_apart?: number;
  /** In a square by sign, which body ("a" or "b") overcomes the other. */
  overcoming?: 'a' | 'b' | null;
  superior?: 'a' | 'b' | null;
}

export type School = 'self' | 'modern' | 'hellenistic' | 'cosmobiology';

/** The Hellenistic details of a chart drawn as a Hellenistic chart. */
export interface HellenisticBlock {
  sect: 'day' | 'night';
  sect_light: string;
  benefic_of_sect: string;
  malefic_of_sect: string;
  sect_near_horizon: boolean;
  dignities: Record<string, { domicile: string; triplicity: string; bound: string; decan: string; element: string; own: string[] }>;
  phase: Record<string, { phase: 'cazimi' | 'combust' | 'beams' | 'free'; orientation: 'morning' | 'evening' }>;
  houses: Record<string, { house: number; angularity: 'angular' | 'succedent' | 'cadent' }>;
  joys: string[];
}

export interface ProfileSummary {
  id: string;
  name: string;
  /** null: the default house system (Settings → Defaults). */
  house_system: string | null;
  zodiac: 'tropical' | 'sidereal';
  ayanamsa: string;
}

export interface ZodiacUsed {
  type: 'tropical' | 'sidereal';
  ayanamsa: string | null;
  value?: number | null;
}

export interface ChartDetail extends ChartData {
  aspects: FoundAspect[];
  mode?: 'standard' | 'hellenistic';
  hellenistic?: HellenisticBlock | null;
  aspects_helio: FoundAspect[];
  profile: ProfileSummary;
  sidereal_pending: boolean;
  date: string | null;
  time: string | null;
  place: string | null;
  in_list: boolean;
  note: ChartNote;
}

export interface Folder {
  id: string;
  name: string;
  charts: number;
}

export interface AspectInfo {
  key: string;
  name: string;
  glyph: string;
  angle: number;
  major: boolean;
  kind: 'hard' | 'soft' | 'neutral';
  default_orb: number;
}

export interface Profile extends ProfileSummary {
  aspects: Record<string, { on: boolean; orb: number }>;
  moving_orb: number;
  lot_formula: 'day' | 'sect';
}

export interface Calculation {
  active: string;
  profiles: Profile[];
  house_systems: Array<{ key: string; label: string }>;
  defaults: { house_system: string; place: string };
  ayanamsas: Array<{ key: string; label: string }>;
  sidereal_supported: boolean;
  aspects: AspectInfo[];
}

export type LayerKey = 'transits' | 'progressions' | 'solar_arc';

export interface MovingLayer {
  label: string;
  points: Record<string, Point>;
  aspects: FoundAspect[];
  arc?: number | null;
  moment?: string;
}

export interface MovingChart {
  at: string;
  natal_utc: string;
  layers: Partial<Record<LayerKey, MovingLayer>>;
}
