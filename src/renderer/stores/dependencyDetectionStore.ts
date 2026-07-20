/**
 * implementation - dependency detection + install cache.
 *
 * implementation: non-persisted per-tab detection cache. Keyed by `tabId`.
 * Memoised by a cheap `detectionHash` (length plus a implementation note the
 * whole capped buffer) so re-detection only runs when the buffer
 * actually changed. Cleared on tab close via `editorStore.removeTab`.
 *
 * implementation: per-tab install lifecycle state (status overlays on
 * `ClassifiedDependency` rows + a streamed log buffer keyed by
 * tabId). implementation note persists the log buffer across panel hide/show
 * within the session (in-memory only; never written to localStorage).
 *
 * No persistence on purpose - detection state and install logs are
 * purely a function of the in-memory buffer + the most recent
 * subprocess run; rehydrating from localStorage would surface stale
 * rows for a buffer the user has since edited.
 */

import { create } from 'zustand';
import type {
  DependencyAdapterLanguage,
  DependencyInstallOutcome,
  DependencyStatus,
  DetectedDependency,
} from '../../shared/dependencies/types';

export interface ClassifiedDependency extends DetectedDependency {
  readonly status: DependencyStatus;
}

export interface TabDetectionState {
  readonly tabId: string;
  readonly language: DependencyAdapterLanguage;
  readonly detectionHash: string;
  readonly dependencies: readonly ClassifiedDependency[];
  readonly classifiedAt: number;
  /**
   * Soft warning surfaced by the panel when the detector skipped
   * the buffer for being too large (see
   * `DEPENDENCY_DETECTION_MAX_BUFFER_BYTES`).
   */
  readonly skippedReason?: 'buffer-too-large';
  /**
   * implementation — whether the resolved cwd carries a
   * `package.json`. Used by the Install button to switch between
   * the enabled state and the `noPackageJsonTooltip`. `null` when
   * no cwd was discoverable (web stub, unsaved tab).
   */
  readonly cwdHasPackageJson?: boolean | null;
}

/**
 * implementation - install lifecycle state for the active tab.
 * `runId` is null when no install is in flight. The `log` buffer is
 * appended chunk by chunk from main and retained in-memory after the
 * install finishes so the user can re-read the output without
 * re-running the install (implementation note).
 */
export interface TabInstallState {
  readonly tabId: string;
  readonly runId: string | null;
  /** Names currently in flight for this batch. */
  readonly installing: ReadonlySet<string>;
  /** Streamed `npm install` stdout / stderr lines. */
  readonly log: string;
  /** Closed-enum outcome of the most recent finished batch. */
  readonly lastOutcome: DependencyInstallOutcome | null;
  /** Timestamp of the most recent install attempt. Drives the privacy dashboard `lastCallAt`. */
  readonly lastAttemptAt: number | null;
}

/**
 * Build an ephemeral install row on demand. Log chunks can arrive before the
 * panel has read the first `startInstall` state update, and tests can append
 * directly; creating the shell lazily keeps those paths total without making
 * the store persistent.
 */
function createEmptyInstallState(tabId: string): TabInstallState {
  return {
    tabId,
    runId: null,
    installing: new Set<string>(),
    log: '',
    lastOutcome: null,
    lastAttemptAt: null,
  };
}

interface DependencyDetectionStateShape {
  readonly byTab: ReadonlyMap<string, TabDetectionState>;
  readonly installByTab: ReadonlyMap<string, TabInstallState>;
  setDetection: (tabId: string, next: TabDetectionState) => void;
  evictTab: (tabId: string) => void;
  clear: () => void;
  // implementation — install lifecycle actions.
  startInstall: (
    tabId: string,
    runId: string,
    names: readonly string[]
  ) => void;
  appendInstallLog: (tabId: string, chunk: string) => void;
  endInstall: (
    tabId: string,
    runId: string,
    outcome: DependencyInstallOutcome,
    perNameStatus: Record<string, DependencyStatus>
  ) => void;
}

/**
 * Retain the tail of streamed npm output. The last stderr/stdout lines are the
 * actionable failure context, and capping here prevents a noisy install from
 * turning a session-scoped store into an unbounded memory sink.
 */
const INSTALL_LOG_CAP = 64 * 1024;

export const useDependencyDetectionStore = create<DependencyDetectionStateShape>(
  (set) => ({
    byTab: new Map(),
    installByTab: new Map(),
    setDetection: (tabId, next) =>
      set((state) => {
        // implementation coupled invariant — a re-detection cycle
        // that fires during an in-flight install (typical: the user
        // edits the buffer while `npm install` is running for 60+ s)
        // must NOT overwrite the optimistic `'installing'` status
        // back to `'detected'`. The resolver only sees what's on
        // disk; it would briefly flicker the pill until the install
        // settled. Merge the in-flight set on the way in so the
        // panel stays honest about the running batch.
        const installing = state.installByTab.get(tabId)?.installing ?? null;
        const merged =
          installing && installing.size > 0
            ? {
                ...next,
                dependencies: next.dependencies.map((dep) =>
                  installing.has(dep.name)
                    ? { ...dep, status: 'installing' as DependencyStatus }
                    : dep
                ),
              }
            : next;
        const updated = new Map(state.byTab);
        updated.set(tabId, merged);
        return { byTab: updated };
      }),
    evictTab: (tabId) =>
      set((state) => {
        const hasDetection = state.byTab.has(tabId);
        const hasInstall = state.installByTab.has(tabId);
        if (!hasDetection && !hasInstall) return state;
        const updatedDetection = hasDetection
          ? (() => {
              const next = new Map(state.byTab);
              next.delete(tabId);
              return next;
            })()
          : state.byTab;
        const updatedInstall = hasInstall
          ? (() => {
              const next = new Map(state.installByTab);
              next.delete(tabId);
              return next;
            })()
          : state.installByTab;
        return {
          byTab: updatedDetection,
          installByTab: updatedInstall,
        };
      }),
    clear: () =>
      set((state) => {
        if (state.byTab.size === 0 && state.installByTab.size === 0) {
          return state;
        }
        return { byTab: new Map(), installByTab: new Map() };
      }),
    startInstall: (tabId, runId, names) =>
      set((state) => {
        const next = new Map(state.installByTab);
        const prior =
          state.installByTab.get(tabId) ?? createEmptyInstallState(tabId);
        next.set(tabId, {
          ...prior,
          runId,
          installing: new Set(names),
          // Reset the log on a new batch start so users do not see
          // output from a previous failed install bleed into the
          // current one. The lastOutcome is cleared until the new
          // batch finishes.
          log: '',
          lastOutcome: null,
          lastAttemptAt: Date.now(),
        });
        // Flip the affected detection rows to `'installing'` so the
        // pill in the panel reflects the in-flight state.
        const detection = state.byTab.get(tabId);
        let updatedDetection = state.byTab;
        if (detection) {
          const flipping = new Set(names);
          const remapped = detection.dependencies.map((dep) =>
            flipping.has(dep.name)
              ? { ...dep, status: 'installing' as DependencyStatus }
              : dep
          );
          const detectionNext = new Map(state.byTab);
          detectionNext.set(tabId, {
            ...detection,
            dependencies: remapped,
          });
          updatedDetection = detectionNext;
        }
        return { installByTab: next, byTab: updatedDetection };
      }),
    appendInstallLog: (tabId, chunk) =>
      set((state) => {
        const prior =
          state.installByTab.get(tabId) ?? createEmptyInstallState(tabId);
        const combined = `${prior.log}${chunk}`;
        const capped =
          combined.length > INSTALL_LOG_CAP
            ? combined.slice(combined.length - INSTALL_LOG_CAP)
            : combined;
        if (capped === prior.log) return state;
        const next = new Map(state.installByTab);
        next.set(tabId, { ...prior, log: capped });
        return { installByTab: next };
      }),
    endInstall: (tabId, runId, outcome, perNameStatus) =>
      set((state) => {
        const prior = state.installByTab.get(tabId);
        // If the runId doesn't match, the batch was overridden by a
        // newer run before this one's promise resolved. Drop the
        // stale update; the newer run's `startInstall` already
        // cleared the state.
        if (!prior || prior.runId !== runId) return state;
        const installByTab = new Map(state.installByTab);
        installByTab.set(tabId, {
          ...prior,
          runId: null,
          installing: new Set<string>(),
          lastOutcome: outcome,
        });
        // Apply per-name status flips on the detection cache. The
        // coupled-invariant: a successful install changes
        // `node_modules` on disk but does NOT change the buffer, so
        // the detection hash would skip a re-resolve. We patch the
        // detection rows directly here.
        let byTab = state.byTab;
        const detection = state.byTab.get(tabId);
        if (detection) {
          const remapped = detection.dependencies.map((dep) =>
            Object.prototype.hasOwnProperty.call(perNameStatus, dep.name)
              ? { ...dep, status: perNameStatus[dep.name]! }
              : dep
          );
          const detectionNext = new Map(state.byTab);
          detectionNext.set(tabId, {
            ...detection,
            dependencies: remapped,
          });
          byTab = detectionNext;
        }
        return { installByTab, byTab };
      }),
  })
);

/**
 * Cheap content fingerprint. The detector is capped at 500 KB, so a
 * full linear implementation note still small next to the parse pass and avoids
 * stale rows when an import changes in the middle of a same-length
 * buffer.
 */
export function computeDetectionHash(
  language: string,
  source: string,
  classificationContext = ''
): string {
  if (typeof source !== 'string') return `${language}|0|empty`;
  const len = source.length;
  const prefix = classificationContext
    ? `${language}|${classificationContext}`
    : language;
  if (len === 0) return `${prefix}|0|empty`;
  let fold = 0x811c9dc5;
  for (let i = 0; i < len; i += 1) {
    fold ^= source.charCodeAt(i);
    fold = Math.imul(fold, 0x01000193);
  }
  return `${prefix}|${len}|${(fold >>> 0).toString(36)}`;
}

/**
 * Map a main-side `DependencyInstallResultStatus` (one of the four
 * IPC enum values) onto the renderer's broader `DependencyStatus`.
 * Co-located here so the panel and the store reach for the same
 * mapping.
 */
export function mapInstallStatusToDependencyStatus(
  status: DependencyInstallResultStatus
): DependencyStatus {
  switch (status) {
    case 'installed':
      return 'installed';
    case 'failed':
      return 'failed';
    case 'cancelled':
      // Cancel reverts the row to the pre-install posture
      // (`'detected'`) so the user can click Install again.
      return 'detected';
    case 'skipped-preflight':
      // Pre-flight integrity check found the package already in
      // node_modules — surface as `'installed'` honestly.
      return 'installed';
    default: {
      const exhaustive: never = status;
      return exhaustive;
    }
  }
}
