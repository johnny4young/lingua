import { create } from 'zustand';
import type {
  CollapsedConsoleRow,
  ConsoleState,
  ConsoleEntry,
  ConsoleEntryType,
  ConsolePayloadKindFilter,
} from '../types';

let entryCounter = 0;

const ALL_TYPES: ConsoleEntryType[] = ['log', 'info', 'warn', 'error', 'result'];

/**
 * Non-cryptographic equality hash for adjacent console rows. Keeping this tiny
 * hash inline avoids a static `spark-md5` import in the initial renderer bundle,
 * preserving the Dev Utilities MD5 lazy chunk from RL-125.
 */
function stableEqualityHash(value: string): string {
  let h1 = 0xdeadbeef ^ value.length;
  let h2 = 0x41c6ce57 ^ value.length;
  for (let i = 0; i < value.length; i += 1) {
    const ch = value.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 =
    Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^
    Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 =
    Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^
    Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `${(h2 >>> 0).toString(36)}:${(h1 >>> 0).toString(36)}`;
}

/**
 * RL-123 / AUDIT-03 — content-equality hash computed once per entry at push
 * time. Two entries collapse into one ×N row when their hashes match. We hash
 * the same fields the old render-time `entriesAreEqual` compared (type + line +
 * content + payload shape), but pay the `JSON.stringify` cost once on push
 * instead of on every console render.
 *
 * The hash input is a JSON tuple, not a delimiter-joined string, so field
 * boundaries stay aligned with the previous field-by-field comparison even when
 * console content contains control characters.
 */
function consoleEntryHash(
  entry: Pick<ConsoleEntry, 'type' | 'line' | 'content' | 'payload'>
): string {
  const payloadShape =
    entry.payload && entry.payload.length > 0 ? JSON.stringify(entry.payload) : '';
  return stableEqualityHash(
    JSON.stringify([entry.type, entry.line ?? null, entry.content, payloadShape])
  );
}

/**
 * Fold a flat entry list into the collapsed view, merging runs of
 * consecutive entries that share an `equalityHash` into one row with a
 * `repeatCount`. This is the authoritative derivation; `addEntry` keeps an
 * incremental fast-path for the hot push, but `restore` recomputes from the
 * merged list so the snapshot/live boundary collapses correctly when the
 * last restored entry and the first live entry are identical (PR #8).
 */
function collapseConsoleEntries(
  entries: readonly ConsoleEntry[]
): CollapsedConsoleRow[] {
  const rows: CollapsedConsoleRow[] = [];
  for (const entry of entries) {
    const last = rows[rows.length - 1];
    if (last && last.entry.equalityHash === entry.equalityHash) {
      rows[rows.length - 1] = {
        entry: last.entry,
        repeatCount: last.repeatCount + 1,
      };
    } else {
      rows.push({ entry, repeatCount: 1 });
    }
  }
  return rows;
}

export const useConsoleStore = create<ConsoleState>((set) => ({
  entries: [],
  collapsedEntries: [],
  activeFilters: new Set<ConsoleEntryType>(ALL_TYPES),
  // RL-044 Slice 1B fold A — payload-kind chip filter. Empty by
  // default so users never lose visibility on payload kinds they
  // haven't explicitly chosen to hide.
  hiddenPayloadKinds: new Set<ConsolePayloadKindFilter>(),
  showTimestamps: true,

  addEntry: (entry) => {
    entryCounter++;
    const equalityHash = consoleEntryHash(entry);
    // Spread carries the additive `payload?` field through to the
    // stored ConsoleEntry — additive, never overwriting `content`.
    const newEntry: ConsoleEntry = {
      ...entry,
      id: `entry-${entryCounter}`,
      timestamp: Date.now(),
      equalityHash,
    };
    set((state) => {
      // RL-123 — collapse consecutive identical entries here (once per
      // push) instead of in the ConsolePanel render. Collapsed groups are
      // homogeneous, so the panel can filter these rows by type / payload
      // kind and still match a filter-then-collapse result.
      const collapsed = state.collapsedEntries;
      const last = collapsed.length > 0 ? collapsed[collapsed.length - 1] : undefined;
      const collapsedEntries =
        last && last.entry.equalityHash === equalityHash
          ? [
              ...collapsed.slice(0, -1),
              { entry: last.entry, repeatCount: last.repeatCount + 1 },
            ]
          : [...collapsed, { entry: newEntry, repeatCount: 1 }];
      return {
        entries: [...state.entries, newEntry],
        collapsedEntries,
      };
    });
  },

  clear: () =>
    // RL-044 Slice 1B fold A — clearing the console also resets any
    // payload-kind filter chips the user had toggled off, so a fresh
    // run never displays "No entries match the active filters" against
    // stale filter state from a previous session.
    set({ entries: [], collapsedEntries: [], hiddenPayloadKinds: new Set() }),

  restore: (snapshot) =>
    // UX Sweep T2 fold B — Undo for a console clear. Copy the arrays /
    // set so the caller's stashed snapshot stays immutable if the store
    // mutates later. Preserve entries that arrived after the clear; a
    // running program can keep logging while the Undo toast is visible.
    set((state) => {
      const restoredEntryIds = new Set(snapshot.entries.map((entry) => entry.id));
      const liveEntries = state.entries.filter(
        (entry) => !restoredEntryIds.has(entry.id)
      );
      const mergedEntries = [...snapshot.entries, ...liveEntries];
      return {
        entries: mergedEntries,
        // Recompute the collapsed view from the merged entries (not by
        // concatenating the two precomputed lists) so a restored entry and
        // an identical live entry at the boundary collapse into one row
        // instead of two — keeps collapsedEntries the true view of entries.
        collapsedEntries: collapseConsoleEntries(mergedEntries),
        hiddenPayloadKinds: new Set(snapshot.hiddenPayloadKinds),
      };
    }),

  toggleFilter: (type: ConsoleEntryType) =>
    set((state) => {
      const next = new Set(state.activeFilters);
      if (next.has(type)) {
        // Keep at least one filter active
        if (next.size > 1) next.delete(type);
      } else {
        next.add(type);
      }
      return { activeFilters: next };
    }),

  togglePayloadKindFilter: (kind: ConsolePayloadKindFilter) =>
    set((state) => {
      const next = new Set(state.hiddenPayloadKinds);
      if (next.has(kind)) {
        next.delete(kind);
      } else {
        next.add(kind);
      }
      return { hiddenPayloadKinds: next };
    }),

  clearPayloadKindFilters: () => set({ hiddenPayloadKinds: new Set() }),

  toggleTimestamps: () => set((state) => ({ showTimestamps: !state.showTimestamps })),
}));
