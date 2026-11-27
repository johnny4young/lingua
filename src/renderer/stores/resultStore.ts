import type { ManualRunSession } from '../runtime/manualRunSession';
import { create } from 'zustand';
import type { RuntimeTimeoutPreset } from '../../shared/runtimeTimeoutPresets';
import type { EditorDiagnostic, ExecutionError, LineTimingEntry } from '../types/execution';
import type { AutoRunGateReason } from '../../shared/autoRunGating';
import type { ScopeSnapshot } from '../../shared/scopeSnapshot';
import type { RichOutputPayload } from '../../shared/richOutput';

/**
 * Terminator summary surfaced via `<RunStatusPill>`.
 * Mirrors the canonical fields on `ExecutionResult` so the pill
 * self-gates on a single object instead of re-deriving the kind
 * from `error.message` string matching.
 */
interface RunTerminationSummary {
  kind: 'success' | 'error' | 'timeout' | 'stopped';
  timeoutPreset?: RuntimeTimeoutPreset | 'override';
  timeoutMs?: number;
}

/** One settled run of a tab, metadata only; the run meter draws its bars from these. */
export interface TabRun extends RunTerminationSummary {
  /** 1-based count of runs this tab settled in the session; the console and answer header use it too. */
  number: number;
  durationMs: number | null;
  /** Line that raised, when the run failed on one. */
  line?: number;
}

export interface TabRunLog {
  count: number;
  /** Newest last, capped at `TAB_RUN_LOG_CAP`. */
  runs: TabRun[];
}

export const TAB_RUN_LOG_CAP = 12;

/** The answers one run of a tab published, with the source of each answered line. */
export interface RunAnswers {
  number: number;
  results: LineResult[];
  /** Source text by line, for the lines that answered. */
  sources: Record<number, string>;
}

interface TabAnswers {
  latest: RunAnswers;
  previous?: RunAnswers;
}

/** A run of `tabId` is in flight while the answers of run `run` stay on the lines it has not reached. */
interface KeptAnswers {
  tabId: string;
  run: number;
}

/** Tabs whose last two runs stay in memory; the least recently run one goes first. */
export const TAB_ANSWERS_CAP = 12;

/** Number the next run of `tabId` will take. */
export function nextTabRunNumber(state: Pick<ResultState, 'tabRuns'>, tabId: string): number {
  return (state.tabRuns[tabId]?.count ?? 0) + 1;
}


export interface LineResult {
  line: number;
  value: string;
  /** The variable the value belongs to, for values read from a paused frame. */
  name?: string;
  /**
   * Adds `'watch'` to the closed union. Watches
   * come from the `// @watch <expr>` magic-comment syntax and are
   * rendered with a pin icon + sticky semantics; arrows (`'magic'`)
   * stay on the original `//=>` / `#=>` shape.
   *
   * Adds `'autoLog'`. Auto-log entries come from
   * the JS / TS expression auto-log mode and surface bare-expression
   * values inline without a magic comment. They render with a
   * subtle prefix glyph distinct from arrow / watch and respect the
   * existing `hideUndefined` filter.
   */
  type: 'log' | 'warn' | 'error' | 'info' | 'result' | 'magic' | 'watch' | 'autoLog';
  /**
   * Optional structured payload propagated from
   * `MagicCommentResult.payload`. Renderers consult `value` for the
   * canonical text fallback and upgrade to the typed payload only
   * when present. The inline view surfaces a `Table(N×M)` summary;
   * the console panel widget plugs in later.
   */
  payload?: RichOutputPayload;
  /** Loop pass the answer came from, as `ConsoleOutput.pass`; absent when the runtime cannot tell. */
  pass?: number;
  /** Paused values only: what the variable held at the previous pause, when it differs. */
  previous?: string;
  /** Paused values only: read at an earlier pause in a frame this many calls deep. */
  depth?: number;
  /** Paused values only: read on the paused line, before it runs. */
  held?: boolean;
  /** Paused only: a calling frame's line, whose `value` is the call it waits on, or the top level's chain of calls not returned. */
  frameCall?: { readonly kind: 'waiting'; readonly thisCall: boolean } | { readonly kind: 'calling'; readonly depth: number };
}

export type StickyLineResult = LineResult & {
  type: 'watch' | 'autoLog';
};

export function isStickyLineResult(
  result: LineResult
): result is StickyLineResult {
  return result.type === 'watch' || result.type === 'autoLog';
}

export function stickyLineResultKey(
  result: Pick<StickyLineResult, 'line' | 'type'>
): string {
  return `${result.type}:${result.line}`;
}

/**
 * Snapshot of the last clean auto-run so the gate
 * can restore it after a transient incomplete edit. Carries the panel-render
 * fields plus source identity for sticky rows; `executionSource` / `error` /
 * `diagnostics` are intentionally NOT included because those are run-cycle
 * state, not preserved across the gate's short-circuit.
 */
export interface ResultSnapshot {
  lineResults: LineResult[];
  fullOutput: string;
  stdinConsumed: { count: number; total: number } | null;
  executionTime: number | null;
  /**
   * Exact source text for each sticky inline row at capture time. This stays
   * in the tab-scoped in-memory snapshot only; failed auto-runs use it to
   * avoid restoring a watch or auto-log value after its expression changes.
   */
  stickySourceLines?: Record<string, string>;
  /**
   * Language id the snapshot belongs to. The dock's Compare tab
   * reads this to refuse rendering
   * a stale diff after a Save-As / rename that changed the language
   * (a JS scratchpad's snapshot must not surface as the comparator
   * for a Python run). Earlier builds captured snapshots without language
   * because the gate-restore use case stayed inside the same tab; the
   * language field is additive and the restore path defensively
   * ignores it.
   */
  language: string;
  /**
   * When `true`, the snapshot is locked and
   * the next clean run does NOT overwrite it. Pinning is per-tab —
   * `clear()` on tab switch still drops the snapshot, but inside a
   * tab a pinned snapshot persists across as many runs as the user
   * wants. The user explicitly unpins (or switches tabs) to release.
   */
  pinned?: boolean;
  /**
   * A coarse epoch ms tag so the
   * `<CompareTargetSelector>` can render
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

/** The code and input a run started from, so Run state can tell when the results no longer match. */
interface RanCode {
  tabId: string;
  code: string;
  input: string;
  at: number;
}

/** Stdin and argv as one comparable key. */
export function runInputKey(stdin: string | undefined, args: readonly string[] | undefined): string {
  return JSON.stringify([stdin ?? '', args ?? []]);
}

export interface ResultState {
  /** Per-line results for dynamic languages */
  lineResults: LineResult[];
  ranCode: RanCode | null;
  setRanCode: (ranCode: RanCode | null) => void;
  /**
   * per-statement wall-clock timings from the last
   * instrumented run (`// @time` or the Settings toggle), attributed
   * to each statement's first line. Empty when the last run was not
   * instrumented.
   */
  lineTimings: LineTimingEntry[];
  /** Full output text for compiled languages */
  fullOutput: string;
  /**
   * Stdin consumption summary from the last
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
  manualRunSession: ManualRunSession | null;
  /** Whether the active manual run is bootstrapping its runtime */
  isManualInitializing: boolean;
  /** Runtime bootstrap or compilation status shared by every run control */
  manualLoadingMessage: string | null;
  /** User intent for the active manual execution */
  manualRunMode: 'run' | 'debug' | null;
  /** Origin of the currently surfaced execution state */
  executionSource: 'manual' | 'auto' | null;
  /**
   * Last reason `useAutoRun` consulted the gate.
   * `null` means the gate has not flagged the active buffer yet (or
   * the buffer cleared); `'ok'` means the gate cleared. Surfaces the
   * `<AutoRunGateNotice>` ambient footer.
   */
  autoRunGateReason: AutoRunGateReason | null;
  /**
   * Last successful auto-run output snapshot, used
   * by the gate to restore the panel after a transient incomplete
   * edit. Cleared on tab switch via `clear()` so it never leaks
   * across tabs.
   *
   * Also the comparator source for the `Compare`
   * toggle. The original contract is preserved: it always points at
   * the most recent clean run (or a pinned snapshot).
   */
  lastSuccessfulSnapshot: ResultSnapshot | null;
  /**
   * multi-snapshot ring keyed by capture
   * order (oldest first). Bounded by `MAX_SNAPSHOT_RING` (3) so the
   * user can step back through the last few stable runs to diff
   * against an older comparator. The active `lastSuccessfulSnapshot`
   * always equals `snapshotRing[snapshotRing.length - 1]` (or a
   * pinned snapshot earlier in the ring); the ring is the source of
   * truth, the singular field is the cursor.
   */
  snapshotRing: ResultSnapshot[];
  /**
   * `capturedAt` of the snapshot the
   * `Compare` panel renders against. Defaults to the latest
   * (`snapshotRing[snapshotRing.length - 1].capturedAt`) but the
   * user can pick an older comparator via the target selector. The
   * selected target is renderer-internal; nothing on the wire ever
   * carries it.
   */
  selectedCompareTargetCapturedAt: number | null;
  /**
   * Termination summary from the most recent run.
   * `null` while no run has happened on this tab (the pill stays
   * hidden). The success variant of the pill ALSO renders nothing,
   * so the pill code checks `kind !== 'success'` before rendering.
   */
  runTermination: RunTerminationSummary | null;
  /**
   * Armed deadline for the in-flight run,
   * as an absolute epoch ms. Used by the countdown pill (when the
   * Settings toggle is on) to render `mm:ss` until termination.
   * `null` while no run is in flight.
   */
  runDeadlineAt: number | null;
  /**
   * post-execute variable scope for the active
   * tab. `null` means no capture-enabled run has completed cleanly
   * yet; the inspector toggle reads this to decide whether to
   * enable. Cleared on tab switch via `clear()`; preserved by
   * `clearVisibleResults()` so a transient empty-buffer cycle
   * (Cmd+A → Backspace) does not drop the comparator.
   */
  scopeSnapshot: ScopeSnapshot | null;
  /** Settled runs per tab for the session. Survives tab switches and `clear()`; never persisted. */
  tabRuns: Record<string, TabRunLog>;
  /** Each tab's last two published answers, for the change since the previous run. Memory only. */
  tabAnswers: Record<string, TabAnswers>;
  /** The run whose answers stay on screen while a run of the same tab is in flight; shown only while one is. */
  keptAnswers: KeptAnswers | null;
  /** Changes since the previous run show on the answers. */
  showRunChanges: boolean;
  setShowRunChanges: (show: boolean) => void;
  /** Keeps `results` as the latest answers of `tabId`, and the latest as the previous. */
  recordTabAnswers: (tabId: string, results: readonly LineResult[], code: string) => void;

  setLineResults: (results: LineResult[]) => void;
  setLineTimings: (timings: LineTimingEntry[]) => void;
  setFullOutput: (output: string) => void;
  setStdinConsumed: (summary: { count: number; total: number } | null) => void;
  setError: (error: ExecutionError | null) => void;
  setDiagnostics: (diagnostics: EditorDiagnostic[]) => void;
  setExecutionTime: (time: number | null) => void;
  setIsAutoRunning: (running: boolean) => void;
  setIsManualRunning: (running: boolean) => void;
  setIsManualInitializing: (initializing: boolean) => void;
  setManualLoadingMessage: (message: string | null) => void;
  setExecutionSource: (source: 'manual' | 'auto' | null) => void;
  setAutoRunGateReason: (reason: AutoRunGateReason | null) => void;
  /**
   * Settle a run of `tabId`: logs it for the run meter and, when the tab's
   * results are on screen, publishes its termination. Returns the run number.
   */
  settleTabRun: (
    tabId: string,
    summary: RunTerminationSummary,
    details: { durationMs: number | null; line?: number; publish?: boolean }
  ) => number;
  /**
   * Set / clear the in-flight deadline used
   * by the countdown pill.
   */
  setRunDeadlineAt: (epochMs: number | null) => void;
  /**
   * Write the variable inspector scope snapshot.
   * `null` clears (the toggle returns to disabled). The setter is
   * called from both `useAutoRun` and `executeTabManually` on the
   * clean-success branch.
   */
  setScopeSnapshot: (snapshot: ScopeSnapshot | null) => void;
  /**
   * Capture the panel state as the last good run.
   * Caller passes the active tab's `language` so
   * the snapshot can self-gate the Compare toggle against language
   * drift (a Save-As that flips JS → Python invalidates the
   * comparator). Optional for legacy callers; missing language
   * defaults to `'unknown'` and the Compare toggle treats those
   * snapshots as gated-out. Runtime callers also pass `code` so sticky
   * rows receive source identity; omitting it conservatively disables
   * failed-run restoration for those rows.
   */
  captureSuccessfulSnapshot: (language?: string, code?: string) => void;
  /** Restore the last successful snapshot if any. */
  restoreLastSuccessfulSnapshot: () => boolean;
  /**
   * Explicitly drop the snapshot ring. Used by the
   * editor store's `renameTab` / `persistTab` when the new language
   * doesn't match the snapshot's. Does NOT touch the live result
   * fields (`lineResults`, `fullOutput`) — only the comparator.
   */
  clearLastSuccessfulSnapshot: () => void;
  /**
   * Pick a comparator from the ring by its
   * `capturedAt`. `null` resets to the newest. Unknown values
   * (snapshot evicted, ring empty) silently fall back to the
   * newest entry.
   */
  setCompareTarget: (capturedAt: number | null) => void;
  /**
   * Toggle the pin flag on the snapshot at
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
   * Clear visible state (lineResults, output,
   * diagnostics, gate banner) but PRESERVE `lastSuccessfulSnapshot`
   * so a transient empty-buffer cycle (Cmd+A → Backspace → type)
   * does not defeat the snapshot-restore behavior. The
   * snapshot is only wiped on a real tab switch via `clear()`.
   * Preserves `snapshotRing` too so a fresh run can
   * compare against earlier stable output after it captures its own
   * result.
   */
  clearVisibleResults: () => void;
}

/** Visible results cleared at run start and on transient empty buffers; snapshots and scope stay. */
const CLEARED_VISIBLE_RESULTS = {
  lineResults: [],
  lineTimings: [],
  fullOutput: '',
  stdinConsumed: null,
  error: null,
  diagnostics: [],
  executionTime: null,
  executionSource: null,
  autoRunGateReason: null,
  // The pill never stays stuck on a stale variant.
  runTermination: null,
  runDeadlineAt: null,
  keptAnswers: null,
} satisfies Partial<ResultState>;

/**
 * True when at least one comparator snapshot in the ring was
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
 * Count of comparator snapshots captured for `language`. Drives
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
 * True when the captured variable-scope snapshot belongs to
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
 * Number of captured scope variables for `language`, or `null`
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
  ranCode: null,
  setRanCode: (ranCode) => set({ ranCode }),
  lineTimings: [],
  fullOutput: '',
  stdinConsumed: null,
  error: null,
  diagnostics: [],
  executionTime: null,
  isAutoRunning: false,
  isManualRunning: false,
  isManualInitializing: false,
  manualLoadingMessage: null,
  manualRunSession: null,
  manualRunMode: null,
  executionSource: null,
  autoRunGateReason: null,
  lastSuccessfulSnapshot: null,
  // multi-snapshot ring. Empty until the
  // first clean run on a tab; cleared on tab switch.
  snapshotRing: [],
  selectedCompareTargetCapturedAt: null,
  runTermination: null,
  runDeadlineAt: null,
  // Variable inspector snapshot, populated by the
  // runtime entry points on clean success.
  scopeSnapshot: null,
  tabRuns: {},
  tabAnswers: {},
  keptAnswers: null,
  showRunChanges: true,

  setShowRunChanges: (showRunChanges) => set({ showRunChanges }),
  recordTabAnswers: (tabId, results, code) => {
    const number = get().tabRuns[tabId]?.count ?? 0;
    if (number === 0) return;
    const lines = code.split('\n');
    const sources: Record<number, string> = {};
    for (const result of results) sources[result.line] = lines[result.line - 1] ?? '';
    set((state) => {
      const { [tabId]: current, ...others } = state.tabAnswers;
      const kept = Object.keys(others);
      for (const stale of kept.slice(0, Math.max(0, kept.length - TAB_ANSWERS_CAP + 1))) delete others[stale];
      // A republish of the same run (a restored snapshot) replaces it instead of becoming its own previous.
      const previous = current && current.latest.number !== number ? current.latest : current?.previous;
      const latest: RunAnswers = { number, results: [...results], sources };
      return { tabAnswers: { ...others, [tabId]: previous ? { latest, previous } : { latest } } };
    });
  },

  setLineResults: (lineResults) => set({ lineResults }),
  setLineTimings: (lineTimings) => set({ lineTimings }),
  setFullOutput: (fullOutput) => set({ fullOutput }),
  setStdinConsumed: (stdinConsumed) => set({ stdinConsumed }),
  setError: (error) => set({ error }),
  setDiagnostics: (diagnostics) => set({ diagnostics }),
  setExecutionTime: (executionTime) => set({ executionTime }),
  setIsAutoRunning: (isAutoRunning) => set({ isAutoRunning }),
  setIsManualRunning: (isManualRunning) => set({ isManualRunning }),
  setIsManualInitializing: (isManualInitializing) =>
    set({ isManualInitializing }),
  setManualLoadingMessage: (manualLoadingMessage) =>
    set({ manualLoadingMessage }),
  setExecutionSource: (executionSource) => set({ executionSource }),
  setAutoRunGateReason: (autoRunGateReason) => set({ autoRunGateReason }),
  settleTabRun: (tabId, summary, { durationMs, line, publish = true }) => {
    const log = get().tabRuns[tabId];
    const number = nextTabRunNumber(get(), tabId);
    const run: TabRun = { ...summary, number, durationMs, ...(line !== undefined ? { line } : {}) };
    set((state) => ({
      tabRuns: {
        ...state.tabRuns,
        [tabId]: { count: number, runs: [...(log?.runs ?? []), run].slice(-TAB_RUN_LOG_CAP) },
      },
      ...(publish ? { runTermination: summary } : {}),
    }));
    return number;
  },
  setRunDeadlineAt: (runDeadlineAt) => set({ runDeadlineAt }),
  setScopeSnapshot: (scopeSnapshot) => set({ scopeSnapshot }),
  captureSuccessfulSnapshot: (language, code) => {
    const { lineResults, fullOutput, stdinConsumed, executionTime, snapshotRing } = get();
    const sourceLines = typeof code === 'string' ? code.split('\n') : null;
    const stickySourceLines = sourceLines
      ? Object.fromEntries(
          lineResults
            .filter(isStickyLineResult)
            .map((entry) => [
              stickyLineResultKey(entry),
              sourceLines[entry.line - 1] ?? '',
            ])
        )
      : undefined;
    const fresh: ResultSnapshot = {
      // Defensive copy of lineResults so a later mutation of the
      // live array does not retroactively edit the snapshot.
      lineResults: [...lineResults],
      fullOutput,
      stdinConsumed,
      executionTime,
      ...(stickySourceLines ? { stickySourceLines } : {}),
      // `'unknown'` keeps the field present but treats the
      // snapshot as language-gated for legacy callers that don't
      // pass the language. The Compare toggle rejects unknown
      // snapshots.
      language: typeof language === 'string' && language.length > 0 ? language : 'unknown',
      // `capturedAt` doubles as the ring key for selection and pin
      // toggles, so make it monotonic even when multiple captures
      // land in the same millisecond.
      capturedAt: nextSnapshotCapturedAt(snapshotRing),
    };
    // Ring eviction. Drop oldest UNPINNED entry when
    // the ring is full; pinned entries stay until the user
    // explicitly unpins. Cap is intentionally low (3) — beyond that
    // the dropdown becomes noise.
    const MAX_SNAPSHOT_RING = 3;
    const nextRing: ResultSnapshot[] = [...snapshotRing];
    if (nextRing.length >= MAX_SNAPSHOT_RING) {
      // Find the oldest UNPINNED entry; if every slot is pinned,
      // the ring is full and we silently DROP the fresh snapshot to
      // honor the user's pin intent. The gate-restore path
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
      keptAnswers: null,
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
      ...CLEARED_VISIBLE_RESULTS,
      ranCode: null,
      // A tab switch starts fresh: the snapshot ring, its comparator target and
      // the variable scope are tab-scoped.
      lastSuccessfulSnapshot: null,
      snapshotRing: [],
      selectedCompareTargetCapturedAt: null,
      scopeSnapshot: null,
    }),
  clearVisibleResults: () =>
    // Same shape as `clear()` but DOES NOT touch `lastSuccessfulSnapshot`,
    // the `snapshotRing` or the scope snapshot: they survive a transient
    // empty buffer (Cmd+A → Backspace) and a run start until the run captures
    // a new stable result or the user switches tabs.
    set(CLEARED_VISIBLE_RESULTS),
}));
