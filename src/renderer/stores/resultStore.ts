import { create } from 'zustand';
import type { ExecutionError } from '../types';

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
  /** Execution time in ms */
  executionTime: number | null;
  /** Whether auto-run is currently executing */
  isAutoRunning: boolean;

  setLineResults: (results: LineResult[]) => void;
  setFullOutput: (output: string) => void;
  setError: (error: ExecutionError | null) => void;
  setExecutionTime: (time: number | null) => void;
  setIsAutoRunning: (running: boolean) => void;
  clear: () => void;
}

export const useResultStore = create<ResultState>((set) => ({
  lineResults: [],
  fullOutput: '',
  error: null,
  executionTime: null,
  isAutoRunning: false,

  setLineResults: (lineResults) => set({ lineResults }),
  setFullOutput: (fullOutput) => set({ fullOutput }),
  setError: (error) => set({ error }),
  setExecutionTime: (executionTime) => set({ executionTime }),
  setIsAutoRunning: (isAutoRunning) => set({ isAutoRunning }),
  clear: () => set({ lineResults: [], fullOutput: '', error: null, executionTime: null }),
}));
