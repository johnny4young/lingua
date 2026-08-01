/**
 * Renderer console-state contracts.
 *
 * Console stores and presentation surfaces import this leaf directly instead
 * of activating the historical renderer type facade.
 */

import type { RichOutputPayload } from '../../shared/richOutput';
import type { Language } from './language';

export type ConsoleEntryType = 'log' | 'warn' | 'error' | 'info' | 'result';

export interface ConsoleEntry {
  id: string;
  type: ConsoleEntryType;
  content: string;
  timestamp: number;
  line?: number;
  /** Source language for telemetry on payload-level interactions. */
  language?: Language;
  /** Execution time in ms — shown as a badge when set (only on the last entry) */
  executionTime?: number;
  /**
   * implementation — rich payload aligned with the legacy `content` string.
   * One entry per console-arg; absent on non-JS runners and on the text
   * fallback path. The renderer must always tolerate missing payload.
   */
  payload?: RichOutputPayload[];
  /**
   * implementation detail — content-equality hash of type + line + content +
   * payload shape, computed once at push time.
   * The store uses it to collapse consecutive identical entries without
   * re-running `JSON.stringify` on every render. Optional because callers
   * outside `consoleStore.addEntry` and test fixtures may omit it; store-created
   * entries always receive one before they can participate in `collapsedEntries`.
   */
  equalityHash?: string;
}

/**
 * implementation detail — one visible console row after consecutive identical
 * entries are collapsed. Derived store-side at push time (not on render);
 * `repeatCount >= 2` surfaces the ×N badge. `entry` is the first member of
 * the run and carries its `equalityHash` for the next push's comparison.
 */
export interface CollapsedConsoleRow {
  entry: ConsoleEntry;
  repeatCount: number;
}

export type ConsolePayloadKindBucket =
  | 'table'
  | 'object'
  | 'array'
  | 'mapSet'
  | 'date'
  | 'promise'
  | 'text'
  | 'rawText'
  | 'image'
  | 'chart'
  // implementation note — Python `BaseException` payloads ship
  // `kind: 'error'`. The renderer chip family already had an
  // `'errorish'` filter for warn/error entry types; this is the
  // distinct payload-level bucket.
  | 'error'
  // implementation — sandboxed HTML payloads.
  | 'html';

export type ConsolePayloadKindFilter = ConsolePayloadKindBucket | 'errorish';

/**
 * accessibility pass — the slice of console state that `clear()` wipes,
 * captured so the Undo toast can put it back without losing rows that
 * arrived after the clear. Holds the three fields `clear()` resets
 * (`entries`, `collapsedEntries`, `hiddenPayloadKinds`); the filter set
 * and timestamp toggle are not touched by clear and so are not part of
 * the snapshot.
 */
export interface ConsoleClearSnapshot {
  entries: ConsoleEntry[];
  collapsedEntries: CollapsedConsoleRow[];
  hiddenPayloadKinds: Set<ConsolePayloadKindFilter>;
}

export interface ConsoleState {
  entries: ConsoleEntry[];
  /**
   * implementation detail — consecutive identical entries collapsed once at
   * push time. The console renders (and then filters) these rows instead
   * of recomputing the collapse + `JSON.stringify` equality on every
   * render. Collapsed groups are homogeneous (same type + content +
   * payload), so filtering the rows yields the same visible result as
   * filtering the raw entries first.
   */
  collapsedEntries: CollapsedConsoleRow[];
  /** Which entry types are currently visible */
  activeFilters: Set<ConsoleEntryType>;
  /**
   * implementation note — which payload-kind chips are dimmed-out.
   * Empty set = all visible. We track *hidden* kinds so the default
   * (no filter applied) does not require pre-populating every kind.
   */
  hiddenPayloadKinds: Set<ConsolePayloadKindFilter>;
  showTimestamps: boolean;
  addEntry: (entry: Omit<ConsoleEntry, 'id' | 'timestamp'>) => void;
  clear: () => void;
  /**
   * accessibility pass — re-instate a {@link ConsoleClearSnapshot} that
   * `clear()` previously wiped, for the Undo toast. Rows emitted after the
   * clear are appended after the restored snapshot instead of being
   * dropped, so Undo cannot erase new runtime output. No-op-safe:
   * restoring an empty snapshot keeps any current rows.
   */
  restore: (snapshot: ConsoleClearSnapshot) => void;
  toggleFilter: (type: ConsoleEntryType) => void;
  togglePayloadKindFilter: (kind: ConsolePayloadKindFilter) => void;
  clearPayloadKindFilters: () => void;
  toggleTimestamps: () => void;
}
