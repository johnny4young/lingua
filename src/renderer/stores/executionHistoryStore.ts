/**
 * implementation — execution history ring-buffer store.
 *
 * Captures metadata for the last N manual/auto runs so future work can
 * render "Recent runs" surfaces (command palette entry, drawer, metrics
 * dashboard) without re-wiring the execution path. This store NEVER
 * persists across reloads — keeping history in memory is a deliberate
 * privacy choice, same spirit as the internal telemetry posture. No code
 * body, no stdout / stderr, no file path is captured by default — only the
 * bucketed metadata the future UI actually needs.
 *
 * implementation — opt-in code snapshot. When the caller passes a
 * `snapshot` payload (gated upstream by `executionHistorySnapshotEnabled`
 * in `settingsStore` and a Pro entitlement check in
 * `executeTabManually`), the entry retains the source code at execution
 * time so a follow-up work can offer Replay / Comparison. Snapshots are
 * still in-memory only — they never persist to disk and never leave the
 * renderer. Captures larger than `SNAPSHOT_MAX_BYTES` are truncated and
 * flagged so the UI can disclose the cap honestly.
 *
 * Cap: 50 entries, FIFO. The 51st push drops the oldest.
 * Timestamps round to the nearest second to reduce fingerprintability.
 */

import { create } from 'zustand';
import type { RunCapsuleV1 } from '../../shared/runCapsule';
import { currentEffectiveTier } from './licenseSelectors';
import { isEntitled } from '../../shared/entitlements';

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
   * otherwise — the metadata-only contract from the initial implementation still
   * applies whenever the toggle is off.
   */
  snapshot: ExecutionHistorySnapshot | null;
  /**
   * implementation — id of the editor tab that produced this run.
   * Optional so legacy entries and any future tab-less call site
   * (programmatic tests, future replay-by-script paths) continue to
   * record without churn. The per-tab pill in the result panel uses
   * `byTabId(tabId)` to filter; entries with `tabId: undefined` are
   * never matched by that selector and stay visible only in the
   * global popover / palette surfaces.
   */
  tabId?: string;
  /**
   * implementation note — user-pinned entry. When `true`, the FIFO
   * eviction skips this entry: pinned rows survive past the 50-entry
   * ring cap until the user explicitly unpins them. Default `false`
   * for every recorded entry; the popover toggles it via `togglePin`.
   */
  pinned?: boolean;
  /**
   * implementation note / implementation note — captured RunCapsuleV1 for
   * the most recent runs. Only the newest tier-aware capsule-cap entries
   * carry this (`CAPSULE_LRU_CAP` for Free, `CAPSULE_LRU_CAP_PRO` for
   * paid tiers); older entries lose `lastCapsule` on subsequent records
   * so the in-memory cost stays bounded. Absent (`undefined`) when either
   * the run never produced a capsule (the runner threw before
   * `buildRunCapsule`) or the LRU eviction stripped it on a later record.
   * Settings → Account "Export latest run" reads `latestCapsule()` which
   * walks the entries newest-first looking for the first defined
   * `lastCapsule`.
   */
  lastCapsule?: RunCapsuleV1;
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
   * implementation — id of the editor tab that produced this run.
   * Required by the per-tab pill but optional on the record contract
   * so legacy / programmatic call sites stay compatible.
   */
  tabId?: string;
  /**
   * implementation — optional captured capsule. When present,
   * the store attaches it to the new entry and prunes `lastCapsule` from
   * any entry beyond the current tier-aware capsule cap so the in-memory
   * cost stays bounded. Omit when the run produced no capsule.
   */
  lastCapsule?: RunCapsuleV1;
}

/**
 * implementation note — cap on how many entries retain their
 * captured capsule. Capsules embed the full source + stdout/stderr
 * and can be hundreds of KB; keeping all 50 history entries' capsules
 * resident would dominate the renderer's heap on long sessions. The
 * 5-entry cap matches the typical "recent runs" surface depth — the
 * Settings → Account "Export latest run" reads the newest, and any
 * history-list view  can re-build on demand.
 *
 * implementation note — the cap is now tier-aware. Free keeps the
 * 5-entry ceiling; paid tiers (anything granting `EXECUTION_HISTORY`)
 * retain `CAPSULE_LRU_CAP_PRO` so the Pro-gated capsule browse view
 * (`<CapsuleListOverlay>`) has more than a handful of rows to show.
 * Capsules still live in memory only and stay truncated to 1 MiB each
 * (`MAX_STREAM_BYTES` in `runCapsule.ts`), so the worst-case heap at
 * the Pro cap stays bounded. Disk persistence remains deliberately
 * out of scope until disk-cost telemetry lands.
 */
export const CAPSULE_LRU_CAP = 5;

/**
 * implementation note — paid-tier capsule retention ceiling. Chosen
 * at 20 so the browse view is meaningfully deeper than the Free cap
 * without letting in-memory capsules dominate the heap on long
 * sessions (20 × 1 MiB worst case, typically far less).
 */
export const CAPSULE_LRU_CAP_PRO = 20;

/**
 * Resolve the active capsule-retention cap from the current license
 * tier. Reads the license store imperatively (no hook) the same way
 * `executeTabManually` gates capsule capture, so the store stays
 * framework-agnostic. When a Pro session downgrades, the next
 * `record()` re-applies the lower cap and strips the overflow.
 */
function resolveCapsuleCap(): number {
  return isEntitled(currentEffectiveTier(), 'EXECUTION_HISTORY')
    ? CAPSULE_LRU_CAP_PRO
    : CAPSULE_LRU_CAP;
}

function pruneCapsulesToCap(
  entries: readonly ExecutionHistoryEntry[]
): ExecutionHistoryEntry[] {
  const cap = resolveCapsuleCap();
  const withCapsule: ExecutionHistoryEntry[] = [];
  let keptCapsules = 0;
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const entry = entries[i]!;
    if (entry.lastCapsule !== undefined) {
      if (keptCapsules < cap) {
        withCapsule.unshift(entry);
        keptCapsules += 1;
      } else {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { lastCapsule: _evicted, ...rest } = entry;
        withCapsule.unshift(rest);
      }
    } else {
      withCapsule.unshift(entry);
    }
  }
  return withCapsule;
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
  /**
   * implementation — newest-first walk for the first entry that still
   * carries a `lastCapsule`. Returns `null` when no entry has one
   * (fresh session, or LRU evicted them all). Cheap; no allocation
   * beyond the find().
   */
  latestCapsule: () => RunCapsuleV1 | null;
  /**
   * implementation — newest-first list of the entries that still carry
   * a `lastCapsule`, for the Pro-gated capsule browse overlay. Only the
   * retained (`resolveCapsuleCap()`) entries qualify; older runs whose
   * capsule the LRU stripped are excluded. Returns a fresh array on
   * each call, so component subscribers must derive it inside a
   * `useMemo` keyed on `entries` rather than selecting the call result
   * directly (otherwise zustand v5's snapshot equality check loops —
   * the same caveat `RecentRunsPill` documents for `byTabId`).
   */
  capsuleEntries: () => readonly ExecutionHistoryEntry[];
  clear: () => void;
  /**
   * implementation note — drop the captured capsule from a single
   * history entry while keeping the run row itself. Lets a user remove
   * a capsule whose source is sensitive before exporting or sharing.
   * No-op when `id` is unknown or the entry has no capsule.
   */
  clearCapsule: (id: string) => void;
  /**
   * accessibility pass — re-attach a `lastCapsule` that `clearCapsule`
   * previously stripped, so the undo toast can restore a removed
   * capsule on the run row it came from. No-op when `id` is unknown or
   * the entry already carries a capsule (double-undo guard). The run
   * row itself never left the `entries` array, so this restores it to
   * its exact prior position in the browse list.
   */
  restoreCapsule: (id: string, capsule: RunCapsuleV1) => void;
  byLanguage: (language: string) => readonly ExecutionHistoryEntry[];
  /**
   * implementation — return only the entries recorded against this
   * editor tab, newest first. Entries with `tabId: undefined` are
   * excluded so the per-tab pill never surfaces legacy or
   * programmatic entries the user didn't drive themselves.
   */
  byTabId: (tabId: string) => readonly ExecutionHistoryEntry[];
  /**
   * implementation note — toggle the `pinned` flag for an entry.
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
      // implementation — `tabId` is optional on the record contract;
      // omit the field entirely when the caller passed nothing so the
      // serialized shape stays stable for legacy callers.
      ...(input.tabId !== undefined ? { tabId: input.tabId } : {}),
      // implementation — attach the captured capsule. Pruning of older
      // entries' capsules happens in the `set` below so the cap is
      // applied AFTER the FIFO drop, never before.
      ...(input.lastCapsule !== undefined
        ? { lastCapsule: input.lastCapsule }
        : {}),
    };
    set((state) => {
      const next = [...state.entries, entry];
      // implementation note — FIFO drop keeps the newest 50, but
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
      // implementation note — capsule LRU cap. Walk newest-first;
      // keep `lastCapsule` on the first `cap` entries that have one,
      // strip it from the rest. Idempotent across records. The cap is
      // resolved per-record (implementation note) so a license tier
      // change takes effect on the next run without a store reset.
      return { entries: pruneCapsulesToCap(trimmed) };
    });
    return entry;
  },

  latestCapsule: () => {
    const entries = get().entries;
    for (let i = entries.length - 1; i >= 0; i -= 1) {
      const entry = entries[i]!;
      if (entry.lastCapsule !== undefined) {
        return entry.lastCapsule;
      }
    }
    return null;
  },

  capsuleEntries: () => {
    const entries = get().entries;
    const withCapsule: ExecutionHistoryEntry[] = [];
    // Newest first so the browse overlay renders most-recent at the top
    // without reversing.
    for (let i = entries.length - 1; i >= 0; i -= 1) {
      const entry = entries[i]!;
      if (entry.lastCapsule !== undefined) {
        withCapsule.push(entry);
      }
    }
    return withCapsule;
  },

  clear: () => {
    set({ entries: [] });
  },

  clearCapsule: (id) => {
    set((state) => {
      let changed = false;
      const entries = state.entries.map((entry) => {
        if (entry.id !== id || entry.lastCapsule === undefined) return entry;
        changed = true;
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { lastCapsule: _dropped, ...rest } = entry;
        return rest;
      });
      return changed ? { entries } : state;
    });
  },

  restoreCapsule: (id, capsule) => {
    set((state) => {
      let changed = false;
      const entries = state.entries.map((entry) => {
        if (entry.id !== id || entry.lastCapsule !== undefined) return entry;
        changed = true;
        return { ...entry, lastCapsule: capsule };
      });
      return changed ? { entries: pruneCapsulesToCap(entries) } : state;
    });
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
