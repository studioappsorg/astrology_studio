/**
 * AstrologyStudio ·
 * web/src/hosted.ts
 *
 * Hosted service:
 *
 * people who sign up never need to know about ephemeralREST. Its address, keys and name are hidden
 * from them, and wording that would mention it is plain. The owner still sees everything (they run
 * the install). Set from /auth/status when the app starts.
 *
 * Copyright (c) 2026 Gavin Melhuish
 * MIT License; see LICENSE in the project root.
 * SPDX-License-Identifier: MIT
 */

let hosted = false;
let owner = false;

export function setHosted(value: boolean): void {
  hosted = value;
}

export function setOwner(value: boolean): void {
  owner = value;
}

/** Whether this install is a hosted service. */
export const isHosted = (): boolean => hosted;

/** Whether to keep ephemeralREST out of what this person sees: on a hosted service, everyone but the owner. */
export const plainWording = (): boolean => hosted && !owner;

/** A server message for this person: ephemeralREST becomes "the chart service" where it should be hidden. */
export function plain(text: string): string {
  return plainWording() ? text.replace(/your ephemeralREST (API )?key/gi, 'your account').replace(/ephemeralREST/g, 'the chart service') : text;
}
