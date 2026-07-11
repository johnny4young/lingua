/**
 * RL-126 / AUDIT-06 — unit tests for the central persisted-store migration core.
 *
 * `migrateState` is the pure engine (step ordering, identity, corrupt/throw
 * reset); `createMigrate` is the thin per-store wrapper used in each persist
 * config. The cross-store coverage (every store registered + v0 back-compat)
 * lives in `storeMigrations.test.ts`.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  createMigrate,
  migrateState,
  migrationRegistry,
  type StoreMigrationMap,
} from '../../../src/renderer/stores/persistence/migrationRegistry';
import { trackEvent } from '../../../src/renderer/utils/telemetry';

// Mock the telemetry emitter so `createMigrate`'s static `trackEvent` reference
// is the spy (the registry calls it directly — no dynamic import).
vi.mock('../../../src/renderer/utils/telemetry', () => ({
  trackEvent: vi.fn(),
}));

describe('migrateState (pure core)', () => {
  it('is identity when there are no steps newer than the persisted version', () => {
    const payload = { a: 1, nested: { b: 2 } };
    const result = migrateState({}, payload, 0);
    expect(result.migrated).toBe(false);
    expect(result.state).toBe(payload); // preserved verbatim, same reference
  });

  it('runs a single forward step and reports a real migration', () => {
    const steps: StoreMigrationMap = {
      1: (s) => ({ ...s, renamed: s.old, old: undefined }),
    };
    const result = migrateState(steps, { old: 'value' }, 0);
    expect(result.migrated).toBe(true);
    expect(result.state).toEqual({ renamed: 'value', old: undefined });
  });

  it('runs multiple steps in ascending target order', () => {
    const order: number[] = [];
    const steps: StoreMigrationMap = {
      // Declared out of order on purpose — the engine must sort ascending.
      3: (s) => {
        order.push(3);
        return { ...s, v: 3 };
      },
      1: (s) => {
        order.push(1);
        return { ...s, v: 1 };
      },
      2: (s) => {
        order.push(2);
        return { ...s, v: 2 };
      },
    };
    const result = migrateState(steps, { v: 0 }, 0);
    expect(order).toEqual([1, 2, 3]);
    expect(result.state).toEqual({ v: 3 });
  });

  it('skips steps at or below the persisted version', () => {
    const ran: number[] = [];
    const steps: StoreMigrationMap = {
      1: (s) => (ran.push(1), s),
      2: (s) => (ran.push(2), s),
      3: (s) => (ran.push(3), s),
    };
    migrateState(steps, { x: 1 }, 2); // already at v2 -> only step 3 runs
    expect(ran).toEqual([3]);
  });

  it('resets (state undefined) when the payload is not a record object', () => {
    expect(migrateState({}, null, 0)).toEqual({ state: undefined, migrated: false });
    expect(migrateState({}, 'garbage', 0)).toEqual({ state: undefined, migrated: false });
    expect(migrateState({}, 42, 0)).toEqual({ state: undefined, migrated: false });
    expect(migrateState({}, undefined, 0)).toEqual({ state: undefined, migrated: false });
    expect(migrateState({}, [], 0)).toEqual({ state: undefined, migrated: false });
  });

  it('resets instead of throwing when a migration step throws', () => {
    const steps: StoreMigrationMap = {
      1: () => {
        throw new Error('bad migration');
      },
    };
    const result = migrateState(steps, { a: 1 }, 0);
    expect(result).toEqual({ state: undefined, migrated: false });
  });
});

describe('createMigrate (per-store wrapper)', () => {
  it('preserves a v0 payload unchanged for an identity store (no telemetry)', () => {
    // RL-111 — lingua-settings is no longer identity (it has a 1->2 step);
    // use lingua-snippets, which still has an empty migration map.
    const migrate = createMigrate('lingua-snippets');
    const payload = { snippets: [{ id: 's1' }] };
    expect(migrate(payload, 0)).toBe(payload);
  });

  it('returns undefined (reset to defaults) for a corrupt payload', () => {
    const migrate = createMigrate('lingua-license');
    expect(migrate('not-an-object', 0)).toBeUndefined();
    expect(migrate(null, 0)).toBeUndefined();
    expect(migrate([], 0)).toBeUndefined();
  });

  it('advances lingua-session v1 payloads through the v2 identity boundary', () => {
    vi.mocked(trackEvent).mockClear();
    const migrate = createMigrate('lingua-session');
    const payload = { tabs: [{ id: 'tab-1', stdinBuffer: 'Ada' }] };

    const migrated = migrate(payload, 1);

    expect(migrated).toBe(payload);
    expect(trackEvent).toHaveBeenCalledWith('persistence.migrated', {
      store: 'lingua-session',
    });
  });
});

describe('migrationRegistry coverage', () => {
  it('registers exactly the 16 persisted stores', () => {
    expect(Object.keys(migrationRegistry).sort()).toEqual(
      [
        'lingua-ai',
        'lingua-debugger-state',
        'lingua-env-vars',
        'lingua-lesson-progress',
        'lingua-license',
        'lingua-notebook-state',
        'lingua-project-store',
        'lingua-recent-files',
        'lingua-session',
        'lingua-settings',
        'lingua-snippets',
        'lingua-trust-events',
        'lingua-utility-pipeline-state',
        'lingua-utility-state',
        'lingua-workspace-sql-state',
        'lingua-workspace-tool-state',
      ].sort()
    );
  });

  it('every registry entry is a plain object map (no accidental array / null)', () => {
    for (const [name, steps] of Object.entries(migrationRegistry)) {
      expect(steps, name).toBeTypeOf('object');
      expect(Array.isArray(steps), name).toBe(false);
    }
  });

  it('does not fire telemetry on the identity path', () => {
    // An identity migration (no registered step ran) must stay completely
    // silent; telemetry only fires when a real forward step executes.
    vi.mocked(trackEvent).mockClear();
    createMigrate('lingua-snippets')({ snippets: [] }, 0);
    expect(trackEvent).not.toHaveBeenCalled();
  });
});
