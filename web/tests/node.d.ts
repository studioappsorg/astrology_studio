/**
 * AstrologyStudio ·
 * web/tests/node.d.ts
 *
 * Just enough of Node's test runner and assert for the unit tests (no @types/node needed).
 *
 * Copyright (c) 2026 Gavin Melhuish
 * MIT License; see LICENSE in the project root.
 * SPDX-License-Identifier: MIT
 */

declare module 'node:test' {
  export function test(name: string, fn: () => void | Promise<void>): void;
}
declare module 'node:assert/strict' {
  interface Assert {
    (value: unknown, message?: string): asserts value;
    equal(actual: unknown, expected: unknown, message?: string): void;
    deepEqual(actual: unknown, expected: unknown, message?: string): void;
    ok(value: unknown, message?: string): asserts value;
    ok(value: unknown, message?: string): void;
  }
  const assert: Assert;
  export default assert;
}
