/**
 * implementation detail — branded-id swap-attack compile guard.
 *
 * The three capability ids (`RootId`, `WatchId`, `RelativePath`) are all
 * `string` at runtime, so nothing stops a caller from feeding the
 * watcher's opaque token into a root-capability sink, or a relative path
 * where a root id is expected. That confusion is the exact shape of a
 * capability swap at the IPC boundary. Branding makes each id nominally
 * distinct so the swap is a COMPILE error.
 *
 * This file LOCKS that guard. The `// @ts-expect-error` lines below
 * assert that each swap is rejected by tsc; if a future change erased a
 * brand (e.g. reverting `RootId` to a bare `type RootId = string`), the
 * swap would type-check, the expected error would NOT fire, and tsc would
 * fail the `@ts-expect-error` directive itself (TS2578 'unused') —
 * turning the silent regression into a red build. Convention mirrors the
 * `@ts-expect-error` shape pins in `tests/stores/trustEventStore.test.ts`.
 *
 * IMPORTANT — what makes that lock real: the root `tsconfig.json` only
 * includes `src/**`, and `pnpm test` runs vitest in transpile-only mode,
 * so neither default gate type-checks anything under `tests/`. On their
 * own the directives below are inert. `tsconfig.test.json` closes that
 * hole: it is a scoped program that DOES include this file alongside the
 * `src/**` it imports, and `pnpm run typecheck:tests` (a CI step, and on
 * the pre-done checklist in AGENTS.md) type-checks it. That makes the
 * swap matrix load-bearing: revert any brand to a bare `string` and that
 * step fails with the TS2578s above. (Verified by temporarily reverting
 * `RootId` and confirming the gate goes red.) This file deliberately
 * does NOT shell out to tsc itself: a full tsc program inside the unit
 * suite duplicated the CI step and grew with every file added to
 * `tsconfig.test.json`.
 *
 * The brands erase to `string` at runtime, so there is nothing to assert
 * dynamically beyond a trivial sanity check on the legitimate calls.
 */

import { describe, expect, it } from 'vitest';
import {
  asRelativePath,
  asRootId,
  asWatchId,
  type RelativePath,
  type RootId,
  type WatchId,
} from '../../src/shared/fs/brandedIds';
import { lookupRoot, revokeRoot } from '../../src/main/ipc/projectCapabilities';

// Minimal sinks that demand exactly one branded id each. `lookupRoot` /
// `revokeRoot` already require a `RootId`; these locals pin the other two
// brands so the swap matrix below has a typed target for each.
function requiresRelativePath(_relativePath: RelativePath): void {}
function requiresWatchId(_watchId: WatchId): void {}

describe('branded fs ids — swap-attack compile guard', () => {
  it('rejects every cross-brand and raw-string swap at compile time', () => {
    const rootId: RootId = asRootId('root-token');
    const watchId: WatchId = asWatchId('watch-token');
    const relativePath: RelativePath = asRelativePath('src/index.ts');

    // Sanity: the legitimate (correctly-branded) calls type-check and the
    // brands are plain strings at runtime.
    expect(lookupRoot(rootId)).toBeNull();
    expect(revokeRoot(rootId)).toBe(false);
    requiresWatchId(watchId);
    requiresRelativePath(relativePath);
    expect(typeof rootId).toBe('string');
    expect(typeof watchId).toBe('string');
    expect(typeof relativePath).toBe('string');

    // --- Swap matrix: each line MUST be a compile error. ---

    // A WatchId must NOT be accepted where a RootId is expected.
    // @ts-expect-error — WatchId is not assignable to RootId (swap guard).
    lookupRoot(watchId);
    // @ts-expect-error — WatchId is not assignable to RootId (swap guard).
    revokeRoot(watchId);

    // A RootId must NOT be accepted where a RelativePath is expected.
    // @ts-expect-error — RootId is not assignable to RelativePath (swap guard).
    requiresRelativePath(rootId);

    // A RelativePath must NOT be accepted where a RootId is expected.
    // @ts-expect-error — RelativePath is not assignable to RootId (swap guard).
    lookupRoot(relativePath);

    // A RootId must NOT be accepted where a WatchId is expected.
    // @ts-expect-error — RootId is not assignable to WatchId (swap guard).
    requiresWatchId(rootId);

    // A raw unbranded string must NOT be accepted where any branded id is
    // expected — callers must mint through the cast helpers at a real
    // boundary, never pass an arbitrary string.
    const rawString = 'arbitrary-untrusted-string';
    // @ts-expect-error — raw string is not assignable to RootId (must mint).
    lookupRoot(rawString);
    // @ts-expect-error — raw string is not assignable to WatchId (must mint).
    requiresWatchId(rawString);
    // @ts-expect-error — raw string is not assignable to RelativePath (must mint).
    requiresRelativePath(rawString);

    expect(rawString).toBe('arbitrary-untrusted-string');
  });
});
