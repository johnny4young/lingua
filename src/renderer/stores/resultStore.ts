import { create } from 'zustand';
import type {
  EditorDiagnostic,
  ExecutionError,
  LineTimingEntry,
  RuntimeTimeoutPreset,
} from '../types';
import type { AutoRunGateReason } from '../../shared/autoRunGating';
import type { ScopeSnapshot } from '../../shared/scopeSnapshot';
import type { RichOutputPayload } from '../../shared/richOutput';

/**
 * implementation — terminator summary surfaced via `<RunStatusPill>`.
 * Mirrors the canonical fields on `ExecutionResult` so the pill
 * self-gates on a single object instead of re-deriving the kind
 * from `error.message` string matching.
 */
export interface RunTerminationSummary {
  kind: 'success' | 'error' | 'timeout' | 'stopped';
  timeoutPreset?: RuntimeTimeoutPreset | 'override';
  timeoutMs?: number;
}

export interface LineResult {
  line: number;
  value: string;
  /**
   * implementation — adds `'watch'` to the closed union. Watches
   * come from the `// @watch <expr>` magic-comment syntax and are
   * rendered with a pin icon + sticky semantics; arrows (`'magic'`)
   * stay on the original `//=>` / `#=>` shape.
   *
   * implementation — adds `'autoLog'`. Auto-log entries come from
   * the JS / TS expression auto-log mode and surface bare-expression
   * values inline without a magic comment. They render with a
   * subtle prefix glyph distinct from arrow / watch and respect the
   * existing `hideUndefined` filter.
   */
  type: 'log' | 'warn' | 'error' | 'info' | 'result' | 'magic' | 'watch' | 'autoLog';
  /**
   * implementation — optional structured payload propagated from
   * `MagicCommentResult.payload`. Renderers consult `value` for the
   * canonical text fallback and upgrade to the typed payload only
   * when present. implementation surfaces a `Table(N×M)` summary inline;
   * implementation will plug in the console panel widget.
   */
  payload?: RichOutputPayload;
}

/**
 * implementation — snapshot of the last clean auto-run so the gate
 * can restore it after a transient incomplete edit. Only carries the
 * panel-render fields; `executionSource` / `error` / `diagnostics`
 * intentionally NOT included — those are run-cycle state, not
 * preserved across the gate's short-circuit.
 */
export interface ResultSnapshot {
  lineResults: LineResult[];
  fullOutput: string;
  stdinConsumed: { count: number; total: number } | null;
  executionTime: number | null;
  /**
   * implementation — language id the snapshot belongs to. The Compare
   * toggle in the result-panel header reads this to refuse rendering
   * a stale diff after a Save-As / rename that changed the language
   * (a JS scratchpad's snapshot must not surface as the comparator
   * for a Python run). implementation captured snapshots without language
   * because the gate-restore use case stayed inside the same tab; the
   * language field is additive and the restore path defensively
   * ignores it.
   */
  language: string;
  /**
   * implementation note — when `true`, the snapshot is locked and
   * the next clean run does NOT overwrite it. Pinning is per-tab —
   * `clear()` on tab switch still drops the snapshot, but inside a
   * tab a pinned snapshot persists across as many runs as the user
   * wants. The user explicitly unpins (or switches tabs) to release.
   */
  pinned?: boolean;
  /**
   * implementation note — a coarse epoch ms tag so the
   * `<CompareTargetSelector>` (implementation note) can render
   * "5m ago" / "an hour ago" relative timestamps without needing the
   * full Date. Stored as ms since epoch.
   */
  capturedAt: number;
}

function nextSnapshotCapturedAt(snapshotRing: readonly ResultSnapshot[]): number {
  // `capturedAt` is both display metadata and the stable selection key for
  // compare targets/pin toggles. Make it monotonic so two fast captures in the
  // same millisecond never collide.
  const latestCapturedAt = snapshotRing.reduce(
    (max, entry) => Math.max(max, entry.capturedAt),
    0
  );
  return Math.max(Date.now(), latestCapturedAt + 1);
}

interface ResultState {
  /** Per-line results for dynamic languages */
  lineResults: LineResult[];
  /**
   * internal — per-statement wall-clock timings from the last
   * instrumented run (`// @time` or the Settings toggle), attributed
   * to each statement's first line. Empty when the last run was not
   * instrumented.
   */
  lineTimings: LineTimingEntry[];
  /** Full output text for compiled languages */
  fullOutput: string;
  /**
   * implementation note — stdin consumption summary from the last
   * run that pulled any line out of the pre-set buffer. `null` when
   * the last run did not touch stdin (or no run has happened yet on
   * the active tab); the StdinInputPanel renders the "Used N of M
   * lines" pill only when this is populated.
   */
  stdinConsumed: { count: number; total: number } | null;
  /** Execution error if any */
  error: ExecutionError | null;
  /** Monaco markers for execution or validation diagnostics */
  diagnostics: EditorDiagnostic[];
  /** Execution time in ms */
  executionTime: number | null;
  /** Whether auto-run is currently executing */
  isAutoRunning: boolean;
  /** Whether a user-triggered run/validation is currently executing */
  isManualRunning: boolean;
  /** Origin of the currently surfaced execution state */
  executionSource: 'manual' | 'auto' | null;
  /**
   * implementation — last reason `useAutoRun` consulted the gate.
   * `null` means the gate has not flagged the active buffer yet (or
   * the buffer cleared); `'ok'` means the gate cleared. Surfaces the
   * `<AutoRunGateNotice>` ambient footer.
   */
  autoRunGateReason: AutoRunGateReason | null;
  /**
   * implementation — last successful auto-run output snapshot, used
   * by the gate to restore the panel after a transient incomplete
   * edit. Cleared on tab switch via `clear()` so it never leaks
   * across tabs.
   *
   * implementation — also the comparator source for the `Compare`
   * toggle. The implementation contract is preserved: it always points at
   * the most recent clean run (or a pinned snapshot, per implementation note).
   */
  lastSuccessfulSnapshot: ResultSnapshot | null;
  /**
   * implementation note — multi-snapshot ring keyed by capture
   * order (oldest first). Bounded by `MAX_SNAPSHOT_RING` (3) so the
   * user can step back through the last few stable runs to diff
   * against an older comparator. The active `lastSuccessfulSnapshot`
   * always equals `snapshotRing[snapshotRing.length - 1]` (or a
   * pinned snapshot earlier in the ring); the ring is the source of
   * truth, the singular field is the cursor.
   */
  snapshotRing: ResultSnapshot[];
  /**
   * implementation note — `capturedAt` of the snapshot the
   * `Compare` panel renders against. Defaults to the latest
   * (`snapshotRing[snapshotRing.length - 1].capturedAt`) but the
   * user can pick an older comparator via the target selector. The
   * selected target is renderer-internal; nothing on the wire ever
   * carries it.
   */
  selectedCompareTargetCapturedAt: number | null;
  /**
   * implementation — termination summary from the most recent run.
   * `null` while no run has happened on this tab (the pill stays
   * hidden). The success variant of the pill ALSO renders nothing,
   * so the pill code checks `kind !== 'success'` before rendering.
   */
  runTermination: RunTerminationSummary | null;
  /**
   * implementation note — armed deadline for the in-flight run,
   * as an absolute epoch ms. Used by the countdown pill (when the
   * Settings toggle is on) to render `mm:ss` until termination.
   * `null` while no run is in flight.
   */
  runDeadlineAt: number | null;
  /**
   * implementation — post-execute variable scope for the active
   * tab. `null` means no capture-enabled run has completed cleanly
   * yet; the inspector toggle reads this to decide whether to
   * enable. Cleared on tab switch via `clear()`; preserved by
   * `clearVisibleResults()` so a transient empty-buffer cycle
   * (Cmd+A → Backspace) does not drop the comparator.
   */
  scopeSnapshot: ScopeSnapshot | null;

  setLineResults: (results: LineResult[]) => void;
  setLineTimings: (timings: LineTimingEntry[]) => void;
  setFullOutput: (output: string) => void;
  setStdinConsumed: (summary: { count: number; total: number } | null) => void;
  setError: (error: ExecutionError | null) => void;
  setDiagnostics: (diagnostics: EditorDiagnostic[]) => void;
  setExecutionTime: (time: number | null) => void;
  setIsAutoRunning: (running: boolean) => void;
  setIsManualRunning: (running: boolean) => void;
  setExecutionSource: (source: 'manual' | 'auto' | null) => void;
  setAutoRunGateReason: (reason: AutoRunGateReason | null) => void;
  /**
   * implementation — write the run termination summary. `null`
   * clears the field (pill goes back to its empty state).
   */
  setRunTermination: (summary: RunTerminationSummary | null) => void;
  /**
   * implementation note — set / clear the in-flight deadline used
   * by the countdown pill.
   */
  setRunDeadlineAt: (epochMs: number | null) => void;
  /**
   * implementation — write the variable inspector scope snapshot.
   * `null` clears (the toggle returns to disabled). The setter is
   * called from both `useAutoRun` and `executeTabManually` on the
   * clean-success branch.
   */
  setScopeSnapshot: (snapshot: ScopeSnapshot | null) => void;
  /**
   * implementation — capture the panel state as the last good run.
   * implementation — caller passes the active tab's `language` so
   * the snapshot can self-gate the Compare toggle against language
   * drift (a Save-As that flips JS → Python invalidates the
   * comparator). Optional for legacy callers; missing language
   * defaults to `'unknown'` and the Compare toggle treats those
   * snapshots as gated-out.
   */
  captureSuccessfulSnapshot: (language?: string) => void;
  /** implementation — restore the last successful snapshot if any. */
  restoreLastSuccessfulSnapshot: () => boolean;
  /**
   * implementation — explicitly drop the snapshot ring. Used by the
   * editor store's `renameTab` / `persistTab` when the new language
   * doesn't match the snapshot's. Does NOT touch the live result
   * fields (`lineResults`, `fullOutput`) — only the comparator.
   */
  clearLastSuccessfulSnapshot: () => void;
  /**
   * implementation note — pick a comparator from the ring by its
   * `capturedAt`. `null` resets to the newest. Unknown values
   * (snapshot evicted, ring empty) silently fall back to the
   * newest entry.
   */
  setCompareTarget: (capturedAt: number | null) => void;
  /**
   * implementation note — toggle the pin flag on the snapshot at
   * the given `capturedAt`. Pinning a snapshot prevents the
   * automatic-overwrite that the next clean run normally performs:
   * the pinned entry stays in the ring at its slot, and the new
   * clean run lands in the next slot (or rotates out the oldest
   * UNPINNED entry to make room). Unpinning lets the entry behave
   * like any other ring member again.
   */
  toggleSnapshotPin: (capturedAt: number) => void;
  clear: () => void;
  /**
   * implementation — clear visible state (lineResults, output,
   * diagnostics, gate banner) but PRESERVE `lastSuccessfulSnapshot`
   * so a transient empty-buffer cycle (Cmd+A → Backspace → type)
   * does not defeat the implementation snapshot-restore behavior. The
   * snapshot is only wiped on a real tab switch via `clear()`.
   * implementation — preserves `snapshotRing` too so a fresh run can
   * compare against earlier stable output after it captures its own
   * result.
   */
  clearVisibleResults: () => void;
}

/**
 * internal — true when at least one comparator snapshot in the ring was
 * captured for `language`. Drives the `Compare` panel-chip + bottom-panel
 * availability. Returns a primitive boolean so a subscriber re-renders
 * only when the flag flips, not on every `snapshotRing` array
 * replacement. `language` is optional so callers can pass
 * `activeTab?.language` without a guard; an undefined language never
 * matches.
 */
export function hasComparableSnapshotFor(
  state: Pick<ResultState, 'snapshotRing'>,
  language: string | undefined,
): boolean {
  if (!language) return false;
  return state.snapshotRing.some((entry) => entry.language === language);
}

/**
 * internal — count of comparator snapshots captured for `language`. Drives
 * the `Compare` chip badge. Primitive return → identity-stable
 * subscription (re-renders only when the count itself changes). `0` when
 * none match or no active language.
 */
export function comparableSnapshotCountFor(
  state: Pick<ResultState, 'snapshotRing'>,
  language: string | undefined,
): number {
  if (!language) return 0;
  return state.snapshotRing.reduce(
    (count, entry) => (entry.language === language ? count + 1 : count),
    0,
  );
}

/**
 * internal — true when the captured variable-scope snapshot belongs to
 * `language` AND the tab is not running in Node mode (the inspector is
 * worker-only). Drives the `Variables` panel-chip + the bottom Variables
 * drawer availability. Primitive boolean → a `scopeSnapshot` object
 * replacement that does not change availability is a no-op for
 * subscribers. `runtimeMode` is optional and only `'node'` is excluded;
 * any other value (including undefined) passes the runtime gate.
 */
export function hasScopeSnapshotFor(
  state: Pick<ResultState, 'scopeSnapshot'>,
  language: string | undefined,
  runtimeMode: string | undefined,
): boolean {
  if (!language || runtimeMode === 'node') return false;
  const snapshot = state.scopeSnapshot;
  return snapshot !== null && snapshot.language === language;
}

/**
 * internal — number of captured scope variables for `language`, or `null`
 * when no matching scope snapshot exists. Drives the `Variables` chip
 * badge. `null` (not `0`) distinguishes "no snapshot" from "snapshot
 * with zero variables"; the primitive-or-null return keeps the
 * subscription identity-stable. Note: this does NOT apply the Node
 * runtime gate — callers pair it with `runtimeMode` checks (or
 * `hasScopeSnapshotFor`) when gating the inspector surface.
 */
export function scopeSnapshotVariableCountFor(
  state: Pick<ResultState, 'scopeSnapshot'>,
  language: string | undefined,
): number | null {
  if (!language) return null;
  const snapshot = state.scopeSnapshot;
  if (snapshot === null || snapshot.language !== language) return null;
  return snapshot.variables.length;
}

export const useResultStore = create<ResultState>((set, get) => ({
  lineResults: [],
  lineTimings: [],
  fullOutput: '',
  stdinConsumed: null,
  error: null,
  diagnostics: [],
  executionTime: null,
  isAutoRunning: false,
  isManualRunning: false,
  executionSource: null,
  autoRunGateReason: null,
  lastSuccessfulSnapshot: null,
  // implementation note — multi-snapshot ring. Empty until the
  // first clean run on a tab; cleared on tab switch.
  snapshotRing: [],
  selectedCompareTargetCapturedAt: null,
  runTermination: null,
  runDeadlineAt: null,
  // implementation — variable inspector snapshot, populated by the
  // runtime entry points on clean success.
  scopeSnapshot: null,

  setLineResults: (lineResults) => set({ lineResults }),
  setLineTimings: (lineTimings) => set({ lineTimings }),
  setFullOutput: (fullOutput) => set({ fullOutput }),
  setStdinConsumed: (stdinConsumed) => set({ stdinConsumed }),
  setError: (error) => set({ error }),
  setDiagnostics: (diagnostics) => set({ diagnostics }),
  setExecutionTime: (executionTime) => set({ executionTime }),
  setIsAutoRunning: (isAutoRunning) => set({ isAutoRunning }),
  setIsManualRunning: (isManualRunning) => set({ isManualRunning }),
  setExecutionSource: (executionSource) => set({ executionSource }),
  setAutoRunGateReason: (autoRunGateReason) => set({ autoRunGateReason }),
  setRunTermination: (runTermination) => set({ runTermination }),
  setRunDeadlineAt: (runDeadlineAt) => set({ runDeadlineAt }),
  setScopeSnapshot: (scopeSnapshot) => set({ scopeSnapshot }),
  captureSuccessfulSnapshot: (language) => {
    const { lineResults, fullOutput, stdinConsumed, executionTime, snapshotRing } = get();
    const fresh: ResultSnapshot = {
      // Defensive copy of lineResults so a later mutation of the
      // live array does not retroactively edit the snapshot.
      lineResults: [...lineResults],
      fullOutput,
      stdinConsumed,
      executionTime,
      // implementation — `'unknown'` keeps the field present but treats the
      // snapshot as language-gated for legacy callers that don't
      // pass the language. The Compare toggle rejects unknown
      // snapshots.
      language: typeof language === 'string' && language.length > 0 ? language : 'unknown',
      // `capturedAt` doubles as the ring key for selection and pin
      // toggles, so make it monotonic even when multiple captures
      // land in the same millisecond.
      capturedAt: nextSnapshotCapturedAt(snapshotRing),
    };
    // implementation note — ring eviction. Drop oldest UNPINNED entry when
    // the ring is full; pinned entries stay until the user
    // explicitly unpins. Cap is intentionally low (3) — beyond that
    // the dropdown becomes noise.
    const MAX_SNAPSHOT_RING = 3;
    const nextRing: ResultSnapshot[] = [...snapshotRing];
    if (nextRing.length >= MAX_SNAPSHOT_RING) {
      // Find the oldest UNPINNED entry; if every slot is pinned,
      // the ring is full and we silently DROP the fresh snapshot to
      // honor the user's pin intent. The implementation gate-restore path
      // still works because `lastSuccessfulSnapshot` continues to
      // point at the previously-pinned newest entry until the user
      // unpins.
      const evictIndex = nextRing.findIndex((entry) => entry.pinned !== true);
      if (evictIndex < 0) {
        return; // every slot pinned — refuse the fresh capture
      }
      nextRing.splice(evictIndex, 1);
    }
    nextRing.push(fresh);
    set({
      snapshotRing: nextRing,
      lastSuccessfulSnapshot: fresh,
      // A new snapshot resets the comparator target to the newest
      // entry unless the user had explicitly picked a non-default
      // target — in that case the target stays IF the picked
      // capturedAt is still in the ring.
      selectedCompareTargetCapturedAt: (() => {
        const previous = get().selectedCompareTargetCapturedAt;
        if (previous === null) return null;
        return nextRing.some((entry) => entry.capturedAt === previous)
          ? previous
          : null;
      })(),
    });
  },
  restoreLastSuccessfulSnapshot: () => {
    const snapshot = get().lastSuccessfulSnapshot;
    if (!snapshot) return false;
    set({
      lineResults: [...snapshot.lineResults],
      fullOutput: snapshot.fullOutput,
      stdinConsumed: snapshot.stdinConsumed,
      executionTime: snapshot.executionTime,
      error: null,
      diagnostics: [],
    });
    return true;
  },
  clearLastSuccessfulSnapshot: () =>
    set({
      lastSuccessfulSnapshot: null,
      snapshotRing: [],
      selectedCompareTargetCapturedAt: null,
    }),
  setCompareTarget: (capturedAt) => {
    if (capturedAt === null) {
      set({ selectedCompareTargetCapturedAt: null });
      return;
    }
    const { snapshotRing } = get();
    if (!snapshotRing.some((entry) => entry.capturedAt === capturedAt)) {
      // Unknown capturedAt — treat as a reset.
      set({ selectedCompareTargetCapturedAt: null });
      return;
    }
    set({ selectedCompareTargetCapturedAt: capturedAt });
  },
  toggleSnapshotPin: (capturedAt) => {
    const { snapshotRing, lastSuccessfulSnapshot: previousActive } = get();
    const next = snapshotRing.map((entry) =>
      entry.capturedAt === capturedAt
        ? { ...entry, pinned: entry.pinned !== true }
        : entry
    );
    // Update the singular pointer if it matched the flipped entry.
    // Capture `previousActive` BEFORE the set call so the fallback
    // doesn't re-read the store mid-mutation. The reviewer flagged
    // the original pattern as a future foot-gun even though the
    // current Zustand semantics make it correct today.
    const updatedActive = next.find(
      (entry) => entry.capturedAt === previousActive?.capturedAt
    );
    set({
      snapshotRing: next,
      lastSuccessfulSnapshot: updatedActive ?? previousActive,
    });
  },
  clear: () =>
    set({
      lineResults: [],
      lineTimings: [],
      fullOutput: '',
      stdinConsumed: null,
      error: null,
      diagnostics: [],
      executionTime: null,
      executionSource: null,
      // implementation — clear the gate banner + the snapshot so a
      // tab switch starts fresh.
      autoRunGateReason: null,
      lastSuccessfulSnapshot: null,
      // implementation note — tab switches drop the entire snapshot
      // ring and the selected comparator target. The ring is tab-
      // scoped; the active result store is one source of truth for
      // the current tab only.
      snapshotRing: [],
      selectedCompareTargetCapturedAt: null,
      // implementation — tab switches drop the per-run pill state
      // too so the new tab's panel header starts quiet.
      runTermination: null,
      runDeadlineAt: null,
      // implementation — drop the variable inspector snapshot on tab
      // switch so the new tab's toggle starts disabled.
      scopeSnapshot: null,
    }),
  clearVisibleResults: () =>
    // implementation — same shape as `clear()` but DOES NOT touch
    // `lastSuccessfulSnapshot` or the implementation `snapshotRing`. Useful
    // when the active buffer transits through an empty state
    // (Cmd+A → Backspace) and when a new run is starting; the
    // accumulated snapshots should survive until the run either
    // captures a new stable result or the user switches tabs.
    // Scope snapshots also stay intact here; the Variables surface should not
    // disappear just because a transient run-start clears visible output.
    set({
      lineResults: [],
      lineTimings: [],
      fullOutput: '',
      stdinConsumed: null,
      error: null,
      diagnostics: [],
      executionTime: null,
      executionSource: null,
      autoRunGateReason: null,
      // implementation — clear the pill on transient empty states
      // too; the snapshot survives, but the pill never gets stuck
      // displaying a stale variant.
      runTermination: null,
      runDeadlineAt: null,
    }),
}));
