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
 * own the directives below are inert. The `enforces the compile guard as
 * a real gate` test at the bottom of this file closes that hole: it
 * shells out to `tsc --noEmit -p tsconfig.test.json` — a scoped program
 * that DOES include this file alongside the `src/**` it imports — and
 * asserts a clean exit. Run inside `pnpm test`, that makes the swap
 * matrix load-bearing: revert any brand to a bare `string` and this test
 * fails with the TS2578s above. (Verified by temporarily reverting
 * `RootId` and confirming the gate goes red.)
 *
 * The brands erase to `string` at runtime, so there is nothing to assert
 * dynamically beyond a trivial sanity check on the legitimate calls.
 */

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

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

  it(
    'enforces the compile guard as a real gate (tsc -p tsconfig.test.json)',
    () => {
      // Without this, the `@ts-expect-error` matrix above is never
      // type-checked: tests/** is outside the root tsconfig program and
      // vitest transpiles in type-stripping mode. Running tsc over the
      // scoped `tsconfig.test.json` (which includes this file) is what
      // turns a brand regression into a failing build. A non-zero tsc
      // exit throws and fails this test; its stderr/stdout names the
      // offending directive.
      //
      // Invoke the resolved tsc binary directly (not `pnpm exec`) to skip
      // the package-manager spawn overhead, and give it a generous
      // timeout: a cold tsc program over the whole `src/**` tree can take
      // 10s+ when the rest of the suite is saturating the box, well past
      // vitest's 5s default.
      const tscBin = path.join(repoRoot, 'node_modules', 'typescript', 'bin', 'tsc');
      expect(() =>
        execFileSync(process.execPath, [tscBin, '--noEmit', '-p', 'tsconfig.test.json'], {
          cwd: repoRoot,
          stdio: 'pipe',
          encoding: 'utf8',
        }),
      ).not.toThrow();
    },
    60_000,
  );
});
