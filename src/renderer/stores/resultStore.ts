import { create } from 'zustand';
import type {
  EditorDiagnostic,
  ExecutionError,
  RuntimeTimeoutPreset,
} from '../types';
import type { AutoRunGateReason } from '../../shared/autoRunGating';

/**
 * RL-020 Slice 7 — terminator summary surfaced via `<RunStatusPill>`.
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
   * RL-020 Slice 3 — adds `'watch'` to the closed union. Watches
   * come from the `// @watch <expr>` magic-comment syntax and are
   * rendered with a pin icon + sticky semantics; arrows (`'magic'`)
   * stay on the original `//=>` / `#=>` shape.
   *
   * RL-020 Slice 5 — adds `'autoLog'`. Auto-log entries come from
   * the JS / TS expression auto-log mode and surface bare-expression
   * values inline without a magic comment. They render with a
   * subtle prefix glyph distinct from arrow / watch and respect the
   * existing `hideUndefined` filter.
   */
  type: 'log' | 'warn' | 'error' | 'info' | 'result' | 'magic' | 'watch' | 'autoLog';
}

/**
 * RL-020 Slice 1 — snapshot of the last clean auto-run so the gate
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
}

interface ResultState {
  /** Per-line results for dynamic languages */
  lineResults: LineResult[];
  /** Full output text for compiled languages */
  fullOutput: string;
  /**
   * RL-020 Slice 6 fold G — stdin consumption summary from the last
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
   * RL-020 Slice 1 — last reason `useAutoRun` consulted the gate.
   * `null` means the gate has not flagged the active buffer yet (or
   * the buffer cleared); `'ok'` means the gate cleared. Surfaces the
   * `<AutoRunGateNotice>` ambient footer.
   */
  autoRunGateReason: AutoRunGateReason | null;
  /**
   * RL-020 Slice 1 — last successful auto-run output snapshot, used
   * by the gate to restore the panel after a transient incomplete
   * edit. Cleared on tab switch via `clear()` so it never leaks
   * across tabs.
   */
  lastSuccessfulSnapshot: ResultSnapshot | null;
  /**
   * RL-020 Slice 7 — termination summary from the most recent run.
   * `null` while no run has happened on this tab (the pill stays
   * hidden). The success variant of the pill ALSO renders nothing,
   * so the pill code checks `kind !== 'success'` before rendering.
   */
  runTermination: RunTerminationSummary | null;
  /**
   * RL-020 Slice 7 fold E — armed deadline for the in-flight run,
   * as an absolute epoch ms. Used by the countdown pill (when the
   * Settings toggle is on) to render `mm:ss` until termination.
   * `null` while no run is in flight.
   */
  runDeadlineAt: number | null;

  setLineResults: (results: LineResult[]) => void;
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
   * RL-020 Slice 7 — write the run termination summary. `null`
   * clears the field (pill goes back to its empty state).
   */
  setRunTermination: (summary: RunTerminationSummary | null) => void;
  /**
   * RL-020 Slice 7 fold E — set / clear the in-flight deadline used
   * by the countdown pill.
   */
  setRunDeadlineAt: (epochMs: number | null) => void;
  /** RL-020 Slice 1 — capture the panel state as the last good run. */
  captureSuccessfulSnapshot: () => void;
  /** RL-020 Slice 1 — restore the last successful snapshot if any. */
  restoreLastSuccessfulSnapshot: () => boolean;
  clear: () => void;
  /**
   * RL-020 Slice 3 — clear visible state (lineResults, output,
   * diagnostics, gate banner) but PRESERVE `lastSuccessfulSnapshot`
   * so a transient empty-buffer cycle (Cmd+A → Backspace → type)
   * does not defeat the Slice 1 snapshot-restore behavior. The
   * snapshot is only wiped on a real tab switch via `clear()`.
   */
  clearVisibleResults: () => void;
}

export const useResultStore = create<ResultState>((set, get) => ({
  lineResults: [],
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
  runTermination: null,
  runDeadlineAt: null,

  setLineResults: (lineResults) => set({ lineResults }),
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
  captureSuccessfulSnapshot: () => {
    const { lineResults, fullOutput, stdinConsumed, executionTime } = get();
    set({
      lastSuccessfulSnapshot: {
        // Defensive copy of lineResults so a later mutation of the
        // live array does not retroactively edit the snapshot.
        lineResults: [...lineResults],
        fullOutput,
        stdinConsumed,
        executionTime,
      },
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
  clear: () =>
    set({
      lineResults: [],
      fullOutput: '',
      stdinConsumed: null,
      error: null,
      diagnostics: [],
      executionTime: null,
      executionSource: null,
      // RL-020 Slice 1 — clear the gate banner + the snapshot so a
      // tab switch starts fresh.
      autoRunGateReason: null,
      lastSuccessfulSnapshot: null,
      // RL-020 Slice 7 — tab switches drop the per-run pill state
      // too so the new tab's panel header starts quiet.
      runTermination: null,
      runDeadlineAt: null,
    }),
  clearVisibleResults: () =>
    // RL-020 Slice 3 — same shape as `clear()` but DOES NOT touch
    // `lastSuccessfulSnapshot`. Useful when the active buffer
    // transits through an empty state (Cmd+A → Backspace) and the
    // accumulated snapshot should survive into the next keystroke.
    set({
      lineResults: [],
      fullOutput: '',
      stdinConsumed: null,
      error: null,
      diagnostics: [],
      executionTime: null,
      executionSource: null,
      autoRunGateReason: null,
      // RL-020 Slice 7 — clear the pill on transient empty states
      // too; the snapshot survives, but the pill never gets stuck
      // displaying a stale variant.
      runTermination: null,
      runDeadlineAt: null,
    }),
}));
