/**
 * RL-126 / AUDIT-06 — central schema-version + migration registry for every
 * persisted Zustand store.
 *
 * Each persisted store declares a zustand `version` (the schema version, stored
 * in the `{ state, version }` localStorage envelope) and routes rehydration
 * through {@link createMigrate}. When the stored version is older than the
 * store's current `version`, zustand calls the migrate callback, which replays
 * the ordered forward steps registered here from the persisted version up to
 * current. A store with no shape change yet registers an empty map, so a v0
 * (unversioned) payload is preserved verbatim and simply re-stamped to v1.
 *
 * Why a central registry instead of per-store inline `migrate` callbacks:
 *   - one place to see every store's schema history;
 *   - a drift guard test (`storeMigrations.test.ts`) can assert every
 *     `persist(...)` store is registered here, so a future store can't ship
 *     unversioned;
 *   - uniform corrupt-payload handling and migration telemetry.
 *
 * To add a migration: bump the store's `version: N` in its persist config and
 * register a step under key `N` here that upgrades the `N-1` shape to `N`.
 */

// Static import is safe despite the apparent cycle (telemetry -> settings/
// license stores -> this registry): telemetry only dereferences the stores
// inside functions (call-time), never at module evaluation, and this module
// only calls `trackEvent` inside the `createMigrate` closure (call-time). All
// cross-references resolve after every module has finished evaluating.
import { trackEvent } from '../../utils/telemetry';

/**
 * A single forward migration step: upgrades a persisted (already partialized)
 * state from the previous schema version to the next. Must be pure and total —
 * never throw on unexpected input; {@link createMigrate} resets the store to its
 * defaults if a step throws, so a bad payload never crashes boot.
 */
export type StoreMigration = (state: Record<string, unknown>) => Record<string, unknown>;

/**
 * Ordered forward migrations for one store, keyed by the TARGET schema version a
 * step produces: the step under key `N` upgrades version `N-1` to `N`. A store
 * with no shape change yet has an empty map (identity migration).
 */
export type StoreMigrationMap = Readonly<Record<number, StoreMigration>>;

/**
 * localStorage keys of every persisted Zustand store. The registry is keyed by
 * this union so {@link migrationRegistry} stays exhaustive and the drift guard
 * test can assert full coverage. Adding a new persisted store is a compile error
 * until its key is added here.
 */
export type PersistedStoreName =
  | 'lingua-settings'
  | 'lingua-session'
  | 'lingua-snippets'
  | 'lingua-project-store'
  | 'lingua-recent-files'
  | 'lingua-license'
  | 'lingua-debugger-state'
  | 'lingua-utility-state'
  | 'lingua-env-vars'
  | 'lingua-trust-events'
  | 'lingua-notebook-state'
  | 'lingua-lesson-progress'
  | 'lingua-utility-pipeline-state'
  | 'lingua-workspace-sql-state'
  | 'lingua-workspace-tool-state'
  | 'lingua-ai';

/**
 * Forward-migration steps per store. Empty maps are intentional: those stores
 * have not changed shape since they were first persisted, so the 0->1 (or
 * later) upgrade is identity and the existing payload is preserved as-is.
 *
 * Worked example (settingsStore): a future field rename would register
 *   'lingua-settings': { 2: (s) => ({ ...s, newKey: s.oldKey, oldKey: undefined }) }
 * and bump `version: 2` in settingsStore's persist config.
 */
export const migrationRegistry: Readonly<Record<PersistedStoreName, StoreMigrationMap>> = {
  // RL-111 v1->v2 — the legacy `restoreSession` boolean becomes the
  // `restoreSessionMode` closed enum. Fold B: legacy `false` (the old
  // default, no restore) maps to `'ask'` so every user gets the new
  // privacy-conscious prompt default, not silent never-restore; legacy
  // `true` (explicit auto-restore) maps to `'always'` to preserve that
  // user's silent-restore behavior. The old key is dropped. Pure + total:
  // a missing / non-boolean legacy value falls through to `'ask'`.
  'lingua-settings': {
    2: (state) => {
      const { restoreSession, ...rest } = state as { restoreSession?: unknown } & Record<
        string,
        unknown
      >;
      return {
        ...rest,
        restoreSessionMode: restoreSession === true ? 'always' : 'ask',
      };
    },
  },
  // IT2-F5 v1->v2 — input-set fields are additive optional fields on each
  // saved tab. The identity step re-stamps the envelope without inventing
  // values for older sessions; restore sanitizes any future/tampered payload.
  'lingua-session': {
    2: (state) => state,
  },
  'lingua-snippets': {},
  'lingua-project-store': {},
  'lingua-recent-files': {},
  'lingua-license': {},
  'lingua-debugger-state': {},
  'lingua-utility-state': {},
  'lingua-env-vars': {},
  'lingua-trust-events': {},
  'lingua-notebook-state': {},
  'lingua-lesson-progress': {},
  'lingua-utility-pipeline-state': {},
  'lingua-workspace-sql-state': {},
  'lingua-workspace-tool-state': {},
  // T19 — BYO-key AI config (endpoint / apiKey / model). No shape change yet.
  'lingua-ai': {},
};

/**
 * Fire-and-forget migration telemetry (RL-126 fold C). Only the store name is
 * emitted (a safe token); no version numbers, no payload. `trackEvent` is
 * itself best-effort and swallows its own errors, so this never affects
 * rehydration.
 */
function reportMigration(store: PersistedStoreName): void {
  void trackEvent('persistence.migrated', { store });
}

/** Outcome of {@link migrateState}: the resolved state plus whether any real
 *  forward step ran (used to decide whether to emit migration telemetry).
 *  `state` is `undefined` when the payload was reset to defaults. */
export interface MigrateResult {
  /** The migrated state, or `undefined` to signal "reset to store defaults". */
  state: unknown;
  /** True only when at least one forward step actually executed. */
  migrated: boolean;
}

function isPersistedStateRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Pure migration core (no telemetry, no I/O) — exported so the step-ordering,
 * identity, and reset paths are exhaustively unit-testable with synthetic
 * steps. Replays every step whose target version is newer than `fromVersion`,
 * in ascending order. Resets (returns `state: undefined`) when the payload is
 * not a record object or any step throws (RL-126 fold D).
 */
export function migrateState(
  steps: StoreMigrationMap,
  persistedState: unknown,
  fromVersion: number
): MigrateResult {
  // Fold D — a non-record payload (garbage, null, array, bare string) can never
  // be a valid partialized Zustand state; reset to defaults instead of letting
  // a migration step or the merge throw during boot.
  if (!isPersistedStateRecord(persistedState)) {
    return { state: undefined, migrated: false };
  }

  // zustand passes `undefined` as the version for payloads written before the
  // store had a `version` option. Treat any non-finite version as 0 so a
  // future 0->1 step actually runs on that legacy data.
  const from = Number.isFinite(fromVersion) ? fromVersion : 0;
  const targets = Object.keys(steps)
    .map(Number)
    .filter((version) => Number.isFinite(version) && version > from)
    .sort((a, b) => a - b);

  if (targets.length === 0) {
    // Identity migration (e.g. unversioned v0 -> v1 with no shape change):
    // preserve the payload verbatim; zustand re-stamps the envelope version.
    return { state: persistedState, migrated: false };
  }

  let state = persistedState as Record<string, unknown>;
  try {
    for (const target of targets) {
      const step = steps[target];
      if (step) state = step(state);
    }
  } catch {
    // Fold D — a throwing migration must not crash boot; reset to defaults.
    return { state: undefined, migrated: false };
  }

  return { state, migrated: true };
}

/**
 * Build the zustand `migrate` callback for a persisted store. Thin wrapper over
 * {@link migrateState} that resolves the store's registered steps and emits
 * migration telemetry when a real upgrade ran.
 *
 * @typeParam S - the store's persisted state shape (inferred from the persist
 *   config's `migrate` slot at the call site).
 */
export function createMigrate<S = unknown>(
  storeName: PersistedStoreName
): (persistedState: unknown, fromVersion: number) => S {
  return (persistedState: unknown, fromVersion: number): S => {
    const { state, migrated } = migrateState(
      migrationRegistry[storeName],
      persistedState,
      fromVersion
    );
    if (migrated) reportMigration(storeName);
    return state as S;
  };
}
