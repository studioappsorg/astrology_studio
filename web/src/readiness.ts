/**
 * AstrologyStudio ·
 * web/src/readiness.ts
 *
 * Is this person ready to calculate? ephemeralREST must be reachable and they need their own key.
 *
 * Copyright (c) 2026 Gavin Melhuish
 * MIT License; see LICENSE in the project root.
 * SPDX-License-Identifier: MIT
 */

import { api, type Connection, type KeyStatus } from './api';

export interface Readiness {
  connection: Connection;
  key: KeyStatus;
  ready: boolean;
}

export async function loadReadiness(): Promise<Readiness> {
  const [connection, key] = await Promise.all([
    api<Connection>('/connection'),
    api<KeyStatus>('/account/ephemeral-key'),
  ]);
  return { connection, key, ready: connection.reachable && key.configured };
}
