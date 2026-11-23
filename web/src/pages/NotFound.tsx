/**
 * AstrologyStudio ·
 * web/src/pages/NotFound.tsx
 *
 * The page shown for an address the app doesn't know.
 *
 * Copyright (c) 2026 Gavin Melhuish
 * MIT License; see LICENSE in the project root.
 * SPDX-License-Identifier: MIT
 */

import { Link } from '../router';
import { EmptyState } from '../ui';

export function NotFound() {
  return (
    <EmptyState title="Page not found">
      <p>
        That page doesn't exist. <Link href="/charts">Go to charts</Link>
      </p>
    </EmptyState>
  );
}
