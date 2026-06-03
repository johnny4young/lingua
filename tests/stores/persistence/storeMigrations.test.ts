/**
 * RL-126 / AUDIT-06 — cross-store coverage for schema versioning.
 *
 *  - Fold A: a forward-migration (v0 back-compat) fixture for every persisted
 *    store, driven off the registry so adding a store automatically adds a case.
 *  - Fold B: a drift guard that fails if any `persist(...)` store ships without
 *    a `version` + `createMigrate(...)` (or is missing from the registry).
 *  - Fold G: a dedicated guard that a pre-version license payload survives the
 *    migrate path with its token + active status intact (security seam).
 *  - A real `persist.rehydrate()` round-trip proving an unversioned localStorage
 *    payload still loads.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { describe, it, expect, beforeEach } from 'vitest';
import {
  createMigrate,
  migrationRegistry,
  type PersistedStoreName,
} from '../../../src/renderer/stores/persistence/migrationRegistry';
import { useRecentFilesStore } from '../../../src/renderer/stores/recentFilesStore';

const STORE_NAMES = Object.keys(migrationRegistry) as PersistedStoreName[];

describe('Fold A — v0 back-compat per persisted store', () => {
  // The AC: rehydrating a v0 (unversioned) payload still works. With identity
  // 0->1 migrations today, every store must return its persisted shape
  // unchanged so no returning user loses data on the version bump.
  for (const name of STORE_NAMES) {
    it(`preserves an unversioned payload for ${name}`, () => {
      const migrate = createMigrate(name);
      const payload = { _probe: 'legacy-v0', list: [1, 2, 3], nested: { ok: true } };
      // version 0 AND truly version-less (undefined) both behave as v0.
      expect(migrate(payload, 0)).toEqual(payload);
      expect(migrate(payload, undefined as unknown as number)).toEqual(payload);
    });

    it(`resets a corrupt payload to defaults for ${name}`, () => {
      const migrate = createMigrate(name);
      expect(migrate('corrupt-string', 0)).toBeUndefined();
      expect(migrate([], 0)).toBeUndefined();
    });
  }
});

describe('Fold B — drift guard: every persisted store is versioned + registered', () => {
  const storesDir = resolve(__dirname, '../../../src/renderer/stores');

  function stripComments(src: string): string {
    return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  }

  function extractPersistCalls(src: string): string[] {
    const text = stripComments(src);
    const calls: string[] = [];
    let searchFrom = 0;

    while (searchFrom < text.length) {
      const start = text.indexOf('persist(', searchFrom);
      if (start === -1) break;

      let depth = 0;
      for (let index = start; index < text.length; index += 1) {
        const char = text[index];
        if (char === '(') depth += 1;
        if (char === ')') {
          depth -= 1;
          if (depth === 0) {
            calls.push(text.slice(start, index + 1));
            searchFrom = index + 1;
            break;
          }
        }
      }

      if (searchFrom <= start) {
        throw new Error('Unclosed persist(...) call in store source');
      }
    }

    return calls;
  }

  function persistedStoreFiles(): string[] {
    return readdirSync(storesDir)
      .filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'))
      .filter(
        (file) => extractPersistCalls(readFileSync(join(storesDir, file), 'utf-8')).length
      );
  }

  it('finds the expected number of persisted stores', () => {
    expect(existsSync(storesDir)).toBe(true);
    expect(persistedStoreFiles()).toHaveLength(STORE_NAMES.length);
  });

  it('every persisted store declares a version and routes through createMigrate', () => {
    const offenders: string[] = [];
    for (const file of persistedStoreFiles()) {
      const src = readFileSync(join(storesDir, file), 'utf-8');
      const calls = extractPersistCalls(src);
      for (const [index, call] of calls.entries()) {
        const label = calls.length === 1 ? file : `${file} persist call ${index + 1}`;
        if (!/version:\s*\d+/.test(call)) offenders.push(`${label}: missing version:`);
        if (!/createMigrate\(/.test(call)) offenders.push(`${label}: missing createMigrate()`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('Fold G — license store schema seam', () => {
  it('preserves a pre-version license token + active status through migrate', () => {
    const migrate = createMigrate('lingua-license');
    const persisted = {
      token: 'header.payload.signature',
      status: { kind: 'active', verification: { ok: true, state: 'active' } },
      lastVerifiedAt: 1_700_000_000_000,
      serverSync: { enabled: false },
    };
    // Identity today — the token and active status must survive verbatim so a
    // Pro user is never silently downgraded by the version bump.
    expect(migrate(persisted, 0)).toEqual(persisted);
  });

  it('resets (not throws) on a corrupt license payload so boot stays alive', () => {
    const migrate = createMigrate('lingua-license');
    expect(migrate('not-json-object', 0)).toBeUndefined();
  });
});

describe('real persist.rehydrate round-trip (back-compat)', () => {
  beforeEach(() => {
    localStorage.clear();
    // Simulate a cold boot: the store creator's defaults are in memory before
    // rehydrate runs. (The store is a module singleton, so reset it explicitly
    // since a prior test may have left rehydrated data behind.)
    useRecentFilesStore.setState({ recentFiles: [] });
  });

  it('loads an unversioned lingua-recent-files payload and tags the store at v1', async () => {
    // A v0 envelope: zustand wrote `{ state, version: 0 }` before the option.
    localStorage.setItem(
      'lingua-recent-files',
      JSON.stringify({
        state: {
          recentFiles: [
            { filePath: '/tmp/a.js', name: 'a.js', language: 'javascript', openedAt: 1 },
          ],
        },
        version: 0,
      })
    );

    await useRecentFilesStore.persist.rehydrate();

    expect(useRecentFilesStore.getState().recentFiles).toHaveLength(1);
    expect(useRecentFilesStore.getState().recentFiles[0]?.filePath).toBe('/tmp/a.js');
    expect(useRecentFilesStore.persist.getOptions().version).toBe(1);
  });

  it('resets to defaults when the persisted payload is corrupt', async () => {
    localStorage.setItem('lingua-recent-files', JSON.stringify({ state: 'garbage', version: 0 }));
    await useRecentFilesStore.persist.rehydrate();
    expect(useRecentFilesStore.getState().recentFiles).toEqual([]);
  });
});
