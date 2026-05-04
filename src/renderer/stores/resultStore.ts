import { create } from 'zustand';
import type { EditorDiagnostic, ExecutionError } from '../types';

export interface LineResult {
  line: number;
  value: string;
  type: 'log' | 'warn' | 'error' | 'info' | 'result' | 'magic';
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

  setLineResults: (results: LineResult[]) => void;
  setFullOutput: (output: string) => void;
  setError: (error: ExecutionError | null) => void;
  setDiagnostics: (diagnostics: EditorDiagnostic[]) => void;
  setExecutionTime: (time: number | null) => void;
  setIsAutoRunning: (running: boolean) => void;
  setIsManualRunning: (running: boolean) => void;
  setExecutionSource: (source: 'manual' | 'auto' | null) => void;
  clear: () => void;
}

export const useResultStore = create<ResultState>((set) => ({
  lineResults: [],
  fullOutput: '',
  error: null,
  diagnostics: [],
  executionTime: null,
  isAutoRunning: false,
  isManualRunning: false,
  executionSource: null,

  setLineResults: (lineResults) => set({ lineResults }),
  setFullOutput: (fullOutput) => set({ fullOutput }),
  setError: (error) => set({ error }),
  setDiagnostics: (diagnostics) => set({ diagnostics }),
  setExecutionTime: (executionTime) => set({ executionTime }),
  setIsAutoRunning: (isAutoRunning) => set({ isAutoRunning }),
  setIsManualRunning: (isManualRunning) => set({ isManualRunning }),
  setExecutionSource: (executionSource) => set({ executionSource }),
  clear: () =>
    set({
      lineResults: [],
      fullOutput: '',
      error: null,
      diagnostics: [],
      executionTime: null,
      executionSource: null,
    }),
}));
