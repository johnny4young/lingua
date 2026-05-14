/**
 * RL-028 first slice — execution history ring-buffer store.
 *
 * Captures metadata for the last N manual/auto runs so future slices can
 * render "Recent runs" surfaces (command palette entry, drawer, metrics
 * dashboard) without re-wiring the execution path. This store NEVER
 * persists across reloads — keeping history in memory is a deliberate
 * privacy choice, same spirit as the RL-065 telemetry posture. No code
 * body, no stdout / stderr, no file path is captured by default — only the
 * bucketed metadata the future UI actually needs.
 *
 * RL-028 sixth slice — opt-in code snapshot. When the caller passes a
 * `snapshot` payload (gated upstream by `executionHistorySnapshotEnabled`
 * in `settingsStore` and a Pro entitlement check in
 * `executeTabManually`), the entry retains the source code at execution
 * time so a follow-up slice can offer Replay / Comparison. Snapshots are
 * still in-memory only — they never persist to disk and never leave the
 * renderer. Captures larger than `SNAPSHOT_MAX_BYTES` are truncated and
 * flagged so the UI can disclose the cap honestly.
 *
 * Cap: 50 entries, FIFO. The 51st push drops the oldest.
 * Timestamps round to the nearest second to reduce fingerprintability.
 */

import { create } from 'zustand';

export type ExecutionStatus = 'ok' | 'error';

/**
 * Optional code+language capture attached to a history entry. The
 * language string mirrors the entry's `language` field so a future
 * Replay action can spawn a tab with the right runner without
 * re-deriving it. `truncated` is `true` when the source exceeded
 * `SNAPSHOT_MAX_BYTES` and was clipped — the UI can surface the cap
 * to the user instead of silently rerunning a partial program.
 */
export interface ExecutionHistorySnapshot {
  code: string;
  language: string;
  truncated: boolean;
}

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
  /**
   * Code + language captured at execution time when the user opted into
   * snapshots and the active tier covers `EXECUTION_HISTORY`. `null`
   * otherwise — the metadata-only contract from the first slice still
   * applies whenever the toggle is off.
   */
  snapshot: ExecutionHistorySnapshot | null;
  /**
   * RL-020 Slice 4 — id of the editor tab that produced this run.
   * Optional so pre-Slice-4 entries and any future tab-less call site
   * (programmatic tests, future replay-by-script paths) continue to
   * record without churn. The per-tab pill in the result panel uses
   * `byTabId(tabId)` to filter; entries with `tabId: undefined` are
   * never matched by that selector and stay visible only in the
   * global popover / palette surfaces.
   */
  tabId?: string;
  /**
   * RL-020 Slice 4 fold D — user-pinned entry. When `true`, the FIFO
   * eviction skips this entry: pinned rows survive past the 50-entry
   * ring cap until the user explicitly unpins them. Default `false`
   * for every recorded entry; the popover toggles it via `togglePin`.
   */
  pinned?: boolean;
}

export interface ExecutionHistoryRecord {
  language: string;
  status: ExecutionStatus;
  durationMs: number | null;
  /** Optional override for tests — production callers pass no `timestamp` and the store reads `Date.now()`. */
  timestamp?: number;
  /**
   * Optional opt-in snapshot. Callers pass `{ code, language }` (the
   * `truncated` flag is computed by the store, never by the caller) to
   * capture the source. Omit or pass `null` to keep the metadata-only
   * contract.
   */
  snapshot?: { code: string; language: string } | null;
  /**
   * RL-020 Slice 4 — id of the editor tab that produced this run.
   * Required by the per-tab pill but optional on the record contract
   * so legacy / programmatic call sites stay compatible.
   */
  tabId?: string;
}

export const MAX_HISTORY_ENTRIES = 50;

/**
 * Cap on the captured `code` length, measured in JavaScript UTF-16
 * code units (i.e. `String.prototype.length`). 256 KiB is a deliberate
 * ceiling — a typical scratchpad file lives well under 100 KiB, and a
 * 5 MiB minified bundle pasted into a tab would otherwise inflate the
 * in-memory ring buffer to 250 MiB at full capacity. Anything above
 * the cap is sliced to exactly `SNAPSHOT_MAX_BYTES` code units and
 * the entry is flagged `truncated: true` so the UI can disclose the
 * clamp honestly.
 *
 * Note on units: JS strings are UTF-16, so a code point outside the
 * BMP (e.g. an emoji) costs 2 code units. The on-the-wire UTF-8 byte
 * count for the same string can therefore be slightly larger than
 * `SNAPSHOT_MAX_BYTES` once such characters are present. The skew is
 * acceptable because the cap exists to keep heap usage sane, not to
 * enforce a byte-exact transport limit — snapshots never leave the
 * renderer.
 */
export const SNAPSHOT_MAX_BYTES = 256 * 1024;

/**
 * `language` is sourced from the entry, not from the caller's snapshot
 * payload, so a malformed caller (mismatched language, mutated input)
 * cannot desync `entry.language` from `entry.snapshot.language`. The
 * caller's `input.language` field is intentionally ignored.
 */
function clampSnapshot(code: string, language: string): ExecutionHistorySnapshot {
  if (code.length > SNAPSHOT_MAX_BYTES) {
    return {
      code: code.slice(0, SNAPSHOT_MAX_BYTES),
      language,
      truncated: true,
    };
  }
  return {
    code,
    language,
    truncated: false,
  };
}

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
  /**
   * RL-020 Slice 4 — return only the entries recorded against this
   * editor tab, newest first. Entries with `tabId: undefined` are
   * excluded so the per-tab pill never surfaces legacy or
   * programmatic entries the user didn't drive themselves.
   */
  byTabId: (tabId: string) => readonly ExecutionHistoryEntry[];
  /**
   * RL-020 Slice 4 fold D — toggle the `pinned` flag for an entry.
   * No-op when `id` is unknown. Pinned entries skip FIFO eviction so
   * the user can keep a sticky reference without grooming the ring
   * buffer.
   */
  togglePin: (id: string) => void;
}

export const useExecutionHistoryStore = create<ExecutionHistoryState>()((set, get) => ({
  entries: [],

  record: (input) => {
    const timestampSource =
      typeof input.timestamp === 'number' ? input.timestamp : Date.now();
    const timestamp = roundToSecond(timestampSource);
    const snapshot =
      input.snapshot != null ? clampSnapshot(input.snapshot.code, input.language) : null;
    const entry: ExecutionHistoryEntry = {
      id: nextId(timestamp),
      language: input.language,
      status: input.status,
      durationMs: input.durationMs,
      timestamp,
      snapshot,
      // RL-020 Slice 4 — `tabId` is optional on the record contract;
      // omit the field entirely when the caller passed nothing so the
      // serialized shape stays stable for legacy callers.
      ...(input.tabId !== undefined ? { tabId: input.tabId } : {}),
    };
    set((state) => {
      const next = [...state.entries, entry];
      // RL-020 Slice 4 fold D — FIFO drop keeps the newest 50, but
      // pinned entries are exempt. We drop the oldest UNPINNED entry
      // first; if every slot is pinned the buffer is allowed to grow
      // past `MAX_HISTORY_ENTRIES` (rare in practice — pinning every
      // entry requires explicit per-row user action).
      let trimmed: ExecutionHistoryEntry[] = next;
      while (trimmed.length > MAX_HISTORY_ENTRIES) {
        const oldestUnpinnedIdx = trimmed.findIndex((e) => !e.pinned);
        if (oldestUnpinnedIdx < 0) break;
        trimmed = [
          ...trimmed.slice(0, oldestUnpinnedIdx),
          ...trimmed.slice(oldestUnpinnedIdx + 1),
        ];
      }
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

  byTabId: (tabId) => {
    if (!tabId) return [];
    // Newest first so popover callers don't have to reverse.
    return get()
      .entries.filter((entry) => entry.tabId === tabId)
      .slice()
      .reverse();
  },

  togglePin: (id) => {
    set((state) => {
      let changed = false;
      const entries = state.entries.map((entry) => {
        if (entry.id !== id) return entry;
        changed = true;
        return { ...entry, pinned: !entry.pinned };
      });
      return changed ? { entries } : state;
    });
  },
}));
