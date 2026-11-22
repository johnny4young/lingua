import type { RunCapsuleStatus, RunCapsuleV1 } from '../../../shared/runCapsule';
import type { ExecutionHistoryEntry } from '../../stores/executionHistoryStore';
import type { RunCompareSummary } from '../../utils/runCompareRecord';
import type { ImportedCapsuleEntry } from '../../stores/importedCapsuleStore';
import { errorNameOf } from '../../utils/describeError';
import { formatRunAge, splitRunDuration } from '../../utils/timeLabels';

export type CapsuleRowResult = 'success' | 'error' | 'timeout' | 'stopped' | 'not-run';
export type CapsuleResultFilter = 'all' | 'ok' | 'errors';

export const RESULT_DOT: Record<CapsuleRowResult, string> = {
  success: 'bg-success-fg',
  error: 'bg-error-fg',
  timeout: 'bg-warning-fg',
  stopped: 'bg-error-fg',
  'not-run': 'bg-border-strong',
};

export const RESULT_KEY: Record<CapsuleRowResult, string> = {
  success: 'capsuleList.result.success',
  error: 'capsuleList.result.error',
  timeout: 'capsuleList.result.timeout',
  stopped: 'capsuleList.result.stopped',
  'not-run': 'capsuleList.result.notRun',
};

export interface CapsuleBrowserRow {
  id: string;
  kind: 'run' | 'imported';
  capsule: RunCapsuleV1;
  timestamp: number;
  result: CapsuleRowResult;
  runNumber?: number;
  summary?: RunCompareSummary;
  /** Name, language and code, lowercased once so search stays cheap per keystroke. */
  searchText: string;
}

/** What a capsule row answers with: its rows, its status line, its error or its time. */
export type CapsuleAnswer =
  | { kind: 'duration'; value: string; unit: 'ms' | 's' | null }
  | { kind: 'rows'; count: number }
  | { kind: 'http'; status: number; statusText: string }
  | { kind: 'failed'; name: string | null; status: Exclude<RunCapsuleStatus, 'success'> };

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
    rows.push({
      id: entry.id,
      kind: 'run',
      capsule: entry.lastCapsule,
      timestamp: entry.timestamp,
      result: entry.lastCapsule.result.status,
      ...(entry.runNumber !== undefined ? { runNumber: entry.runNumber } : {}),
      ...(entry.resultSummary ? { summary: entry.resultSummary } : {}),
      searchText: searchTextOf(entry.lastCapsule),
    });
  }
  for (const entry of [...imported].reverse()) {
    rows.push({ id: entry.id, kind: 'imported', capsule: entry.capsule, timestamp: entry.importedAt, result: 'not-run', searchText: searchTextOf(entry.capsule) });
  }
  return rows.sort((a, b) => b.timestamp - a.timestamp).slice(0, cap);
}

/** The newest own run goes first under Your last run; the rest keep their order. */
export function pinLastRun(rows: readonly CapsuleBrowserRow[]): { lastRunId: string | null; rows: CapsuleBrowserRow[] } {
  const last = rows.find((row) => row.kind === 'run');
  if (!last) return { lastRunId: null, rows: [...rows] };
  return { lastRunId: last.id, rows: [last, ...rows.filter((row) => row !== last)] };
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

export function capsuleAnswer(row: Pick<CapsuleBrowserRow, 'capsule' | 'summary'>): CapsuleAnswer {
  const { result } = row.capsule;
  if (row.summary?.kind === 'http') return { kind: 'http', status: row.summary.status, statusText: row.summary.statusText };
  if (result.status !== 'success') {
    return { kind: 'failed', name: errorNameOf(result.errorMessage) ?? errorNameOf(result.stderr), status: result.status };
  }
  if (row.summary?.kind === 'rows') return { kind: 'rows', count: row.summary.count };
  return { kind: 'duration', ...splitRunDuration(result.durationMs) };
}

/** Orders two rows older then newer for the comparison modal. */
export function orderForComparison(a: CapsuleBrowserRow, b: CapsuleBrowserRow): [RunCapsuleV1, RunCapsuleV1] {
  const [older, newer] = a.timestamp < b.timestamp || (a.timestamp === b.timestamp && a.id < b.id) ? [a, b] : [b, a];
  return [older.capsule, newer.capsule];
}

export function capsuleRunLabel(row: CapsuleBrowserRow, t: (key: string, values?: Record<string, number>) => string): string | null {
  return row.runNumber !== undefined ? t('capsuleList.row.run', { run: row.runNumber }) : null;
}

export function formatCapsuleWhen(row: CapsuleBrowserRow, now: number, t: (key: string, values?: Record<string, number>) => string): string {
  return row.kind === 'imported' ? t('capsuleList.when.imported') : formatRunAge(row.timestamp, now, t);
}
