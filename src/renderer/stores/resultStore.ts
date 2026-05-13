import { create } from 'zustand';
import type { EditorDiagnostic, ExecutionError } from '../types';
import type { AutoRunGateReason } from '../../shared/autoRunGating';

export interface LineResult {
  line: number;
  value: string;
  type: 'log' | 'warn' | 'error' | 'info' | 'result' | 'magic';
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
  executionTime: number | null;
}

interface ResultState {
  /** Per-line results for dynamic languages */
  lineResults: LineResult[];
  /** Full output text for compiled languages */
  fullOutput: string;
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

  setLineResults: (results: LineResult[]) => void;
  setFullOutput: (output: string) => void;
  setError: (error: ExecutionError | null) => void;
  setDiagnostics: (diagnostics: EditorDiagnostic[]) => void;
  setExecutionTime: (time: number | null) => void;
  setIsAutoRunning: (running: boolean) => void;
  setIsManualRunning: (running: boolean) => void;
  setExecutionSource: (source: 'manual' | 'auto' | null) => void;
  setAutoRunGateReason: (reason: AutoRunGateReason | null) => void;
  /** RL-020 Slice 1 — capture the panel state as the last good run. */
  captureSuccessfulSnapshot: () => void;
  /** RL-020 Slice 1 — restore the last successful snapshot if any. */
  restoreLastSuccessfulSnapshot: () => boolean;
  clear: () => void;
}

export const useResultStore = create<ResultState>((set, get) => ({
  lineResults: [],
  fullOutput: '',
  error: null,
  diagnostics: [],
  executionTime: null,
  isAutoRunning: false,
  isManualRunning: false,
  executionSource: null,
  autoRunGateReason: null,
  lastSuccessfulSnapshot: null,

  setLineResults: (lineResults) => set({ lineResults }),
  setFullOutput: (fullOutput) => set({ fullOutput }),
  setError: (error) => set({ error }),
  setDiagnostics: (diagnostics) => set({ diagnostics }),
  setExecutionTime: (executionTime) => set({ executionTime }),
  setIsAutoRunning: (isAutoRunning) => set({ isAutoRunning }),
  setIsManualRunning: (isManualRunning) => set({ isManualRunning }),
  setExecutionSource: (executionSource) => set({ executionSource }),
  setAutoRunGateReason: (autoRunGateReason) => set({ autoRunGateReason }),
  captureSuccessfulSnapshot: () => {
    const { lineResults, fullOutput, executionTime } = get();
    set({
      lastSuccessfulSnapshot: {
        // Defensive copy of lineResults so a later mutation of the
        // live array does not retroactively edit the snapshot.
        lineResults: [...lineResults],
        fullOutput,
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
      error: null,
      diagnostics: [],
      executionTime: null,
      executionSource: null,
      // RL-020 Slice 1 — clear the gate banner + the snapshot so a
      // tab switch starts fresh.
      autoRunGateReason: null,
      lastSuccessfulSnapshot: null,
    }),
}));
