import type { RunCapsuleV1 } from '../../../shared/runCapsule';
import type { ExecutionHistoryEntry } from '../../stores/executionHistoryStore';
import type { ImportedCapsuleEntry } from '../../stores/importedCapsuleStore';
import { formatRunAge } from '../../utils/timeLabels';

export type CapsuleRowResult = 'success' | 'error' | 'timeout' | 'stopped' | 'not-run';
export type CapsuleResultFilter = 'all' | 'ok' | 'errors';

export const CAPSULE_ROW_GRID = 'grid grid-cols-[30px_minmax(0,1fr)_120px_96px] items-center gap-x-3.5';

export interface CapsuleBrowserRow {
  id: string;
  kind: 'run' | 'imported';
  capsule: RunCapsuleV1;
  timestamp: number;
  result: CapsuleRowResult;
  /** Name, language and code, lowercased once so search stays cheap per keystroke. */
  searchText: string;
}

function searchTextOf(capsule: RunCapsuleV1): string {
  return `${capsule.tab.name}\n${capsule.tab.language}\n${capsule.source.content}`.toLowerCase();
}

/** Newest first, capped; imported capsules count against the same cap. */
export function buildCapsuleRows(
  history: readonly ExecutionHistoryEntry[],
  imported: readonly ImportedCapsuleEntry[],
  cap: number
): CapsuleBrowserRow[] {
  // Both stores are oldest first; walking them backwards keeps same-second rows newest first.
  const rows: CapsuleBrowserRow[] = [];
  for (const entry of [...history].reverse()) {
    if (!entry.lastCapsule) continue;
    rows.push({ id: entry.id, kind: 'run', capsule: entry.lastCapsule, timestamp: entry.timestamp, result: entry.lastCapsule.result.status, searchText: searchTextOf(entry.lastCapsule) });
  }
  for (const entry of [...imported].reverse()) {
    rows.push({ id: entry.id, kind: 'imported', capsule: entry.capsule, timestamp: entry.importedAt, result: 'not-run', searchText: searchTextOf(entry.capsule) });
  }
  return rows.sort((a, b) => b.timestamp - a.timestamp).slice(0, cap);
}

/** Errors covers anything that did not finish cleanly; capsules not run here only show under All. */
function matchesFilter(result: CapsuleRowResult, filter: CapsuleResultFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'ok') return result === 'success';
  return result === 'error' || result === 'timeout' || result === 'stopped';
}

/** Search looks at the name, the language and the code. */
export function filterCapsuleRows(
  rows: readonly CapsuleBrowserRow[],
  query: string,
  filter: CapsuleResultFilter
): CapsuleBrowserRow[] {
  const needle = query.trim().toLowerCase();
  return rows.filter((row) => matchesFilter(row.result, filter) && (!needle || row.searchText.includes(needle)));
}

/** Orders two rows older then newer for the comparison modal. */
export function orderForComparison(a: CapsuleBrowserRow, b: CapsuleBrowserRow): [RunCapsuleV1, RunCapsuleV1] {
  const [older, newer] = a.timestamp < b.timestamp || (a.timestamp === b.timestamp && a.id < b.id) ? [a, b] : [b, a];
  return [older.capsule, newer.capsule];
}

export function formatCapsuleWhen(row: CapsuleBrowserRow, now: number, t: (key: string, values?: Record<string, number>) => string): string {
  return row.kind === 'imported' ? t('capsuleList.when.imported') : formatRunAge(row.timestamp, now, t);
}
