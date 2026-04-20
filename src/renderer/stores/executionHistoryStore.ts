/**
 * RL-028 first slice — execution history ring-buffer store.
 *
 * Captures metadata for the last N manual/auto runs so future slices can
 * render "Recent runs" surfaces (command palette entry, drawer, metrics
 * dashboard) without re-wiring the execution path. This store NEVER
 * persists across reloads — keeping history in memory is a deliberate
 * privacy choice, same spirit as the RL-065 telemetry posture. No code
 * body, no stdout / stderr, no file path is captured — only the bucketed
 * metadata the future UI actually needs.
 *
 * Cap: 50 entries, FIFO. The 51st push drops the oldest.
 * Timestamps round to the nearest second to reduce fingerprintability.
 */

import { create } from 'zustand';

export type ExecutionStatus = 'ok' | 'error';

export interface ExecutionHistoryEntry {
  /** Stable ad-hoc id — `${timestamp}-${counter}`, enough for React keys. */
  id: string;
  /** Language pack id (`javascript`, `typescript`, `python`, ...). Never a file path. */
  language: string;
  status: ExecutionStatus;
  /** Duration in milliseconds. `null` when the runner bailed before timing (init failure). */
  durationMs: number | null;
  /** Milliseconds since epoch, rounded to the nearest second. */
  timestamp: number;
}

export interface ExecutionHistoryRecord {
  language: string;
  status: ExecutionStatus;
  durationMs: number | null;
  /** Optional override for tests — production callers pass no `timestamp` and the store reads `Date.now()`. */
  timestamp?: number;
}

export const MAX_HISTORY_ENTRIES = 50;

function roundToSecond(ms: number): number {
  return Math.floor(ms / 1000) * 1000;
}

let idCounter = 0;
function nextId(timestamp: number): string {
  idCounter += 1;
  return `${timestamp}-${idCounter}`;
}

export interface ExecutionHistoryState {
  entries: readonly ExecutionHistoryEntry[];
  record: (input: ExecutionHistoryRecord) => ExecutionHistoryEntry;
  clear: () => void;
  byLanguage: (language: string) => readonly ExecutionHistoryEntry[];
}

export const useExecutionHistoryStore = create<ExecutionHistoryState>()((set, get) => ({
  entries: [],

  record: (input) => {
    const timestampSource =
      typeof input.timestamp === 'number' ? input.timestamp : Date.now();
    const timestamp = roundToSecond(timestampSource);
    const entry: ExecutionHistoryEntry = {
      id: nextId(timestamp),
      language: input.language,
      status: input.status,
      durationMs: input.durationMs,
      timestamp,
    };
    set((state) => {
      const next = [...state.entries, entry];
      // FIFO drop: the 51st push keeps only the newest 50.
      const trimmed =
        next.length > MAX_HISTORY_ENTRIES
          ? next.slice(next.length - MAX_HISTORY_ENTRIES)
          : next;
      return { entries: trimmed };
    });
    return entry;
  },

  clear: () => {
    set({ entries: [] });
  },

  byLanguage: (language) => {
    return get().entries.filter((entry) => entry.language === language);
  },
}));
