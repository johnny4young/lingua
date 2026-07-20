/**
 * implementation — pure helper that turns a `(snapshot, current)`
 * pair into the row shape consumed by `<CompareResultsPanel>`.
 *
 * Two flavors:
 *   - **Dynamic languages** (JS / TS / Python where `lineResults`
 *     is the source of truth) — produce `rows`: one entry per line
 *     that exists on EITHER side, with the previous + current value
 *     and a coarse `kind`.
 *   - **Compiled languages** (Go / Rust where `fullOutput` is the
 *     source of truth) — produce `fullOutputDiff`: a unified diff
 *     via `computeDiff(left, right, granularity)`.
 *
 * The helper is pure + deterministic so the result panel can
 * re-render without surprise. The granularity argument only
 * applies to the compiled-mode branch; dynamic-mode rows are
 * always line-keyed.
 */
import type { LineResult, ResultSnapshot } from '../stores/resultStore';
import { computeDiff, type DiffGranularity, type DiffSegment } from './diff';

export type CompareRowKind = 'unchanged' | 'added' | 'removed' | 'changed';

export interface CompareRow {
  line: number;
  /**
   * The value the previous snapshot recorded on this line. `null`
   * means the line did not exist in the previous snapshot (the row
   * is `added`).
   */
  previous: string | null;
  /**
   * The value the current run produced on this line. `null` means
   * the line was deleted (the row is `removed`).
   */
  current: string | null;
  kind: CompareRowKind;
  /**
   * The renderable `type` for this line on the current side, used by
   * `<CompareResultsPanel>` to colorize matching the inline-result
   * shapes (`log` / `warn` / `error` / `info` / `result` / `magic` /
   * `watch` / `autoLog`). Falls back to the previous side's type when
   * the line was removed.
   */
  type: LineResult['type'];
}

export interface DynamicCompareResult {
  mode: 'dynamic';
  rows: CompareRow[];
  identical: boolean;
}

export interface CompiledCompareResult {
  mode: 'compiled';
  segments: DiffSegment[];
  identical: boolean;
  granularity: DiffGranularity;
}

export type SnapshotDiffResult = DynamicCompareResult | CompiledCompareResult;

interface DiffSnapshotInput {
  /**
   * The previous successful run. When `null`, callers should render
   * the "no snapshot yet" empty state instead of calling this
   * helper.
   */
  snapshot: ResultSnapshot;
  /**
   * The currently surfaced result fields. `<CompareResultsPanel>`
   * pulls them from `useResultStore`.
   */
  current: {
    lineResults: readonly LineResult[];
    fullOutput: string;
  };
  /**
   * Compiled-mode granularity. Defaults to `'line'` so the unified
   * diff stays human-readable.
   */
  granularity?: DiffGranularity;
}

interface ResolveCompareTargetInput {
  snapshotRing: readonly ResultSnapshot[];
  language: string;
  selectedCapturedAt: number | null;
  current: DiffSnapshotInput['current'];
}

/**
 * Resolve the comparator snapshot for the visible Compare panel.
 *
 * The result store's `lastSuccessfulSnapshot` must keep pointing at
 * the newest clean run for the auto-run gate restore path. For
 * Compare, that newest snapshot often equals the currently-rendered
 * output because clean runs capture immediately after they render.
 * When the newest language-matching snapshot is identical to the
 * current output, the useful default comparator is therefore the
 * previous stable snapshot. An explicit target selection still wins.
 */
export function resolveCompareTargetSnapshot({
  snapshotRing,
  language,
  selectedCapturedAt,
  current,
}: ResolveCompareTargetInput): ResultSnapshot | null {
  const relevant = snapshotRing.filter((entry) => entry.language === language);
  if (relevant.length === 0) return null;

  if (selectedCapturedAt !== null) {
    const selected = relevant.find(
      (entry) => entry.capturedAt === selectedCapturedAt
    );
    if (selected) return selected;
  }

  const latest = relevant[relevant.length - 1]!;
  if (relevant.length > 1 && snapshotMatchesCurrent(latest, current)) {
    return relevant[relevant.length - 2]!;
  }
  return latest;
}

/**
 * Decide which branch to take. Dynamic mode wins when EITHER side
 * has line-keyed results (some compiled runs incidentally emit a
 * single `log` line; that's fine — line mode handles those).
 * Compiled mode is the fallback for runs whose output lives in
 * `fullOutput` only (Go / Rust subprocess output).
 */
function shouldUseDynamicMode(
  snapshot: ResultSnapshot,
  current: DiffSnapshotInput['current']
): boolean {
  if (snapshot.lineResults.length > 0) return true;
  if (current.lineResults.length > 0) return true;
  return false;
}

function snapshotMatchesCurrent(
  snapshot: ResultSnapshot,
  current: DiffSnapshotInput['current']
): boolean {
  if (snapshot.fullOutput !== current.fullOutput) return false;
  if (snapshot.lineResults.length !== current.lineResults.length) return false;
  return snapshot.lineResults.every((entry, index) => {
    const currentEntry = current.lineResults[index];
    return (
      currentEntry !== undefined &&
      entry.line === currentEntry.line &&
      entry.type === currentEntry.type &&
      entry.value === currentEntry.value
    );
  });
}

export function diffSnapshot(input: DiffSnapshotInput): SnapshotDiffResult {
  const { snapshot, current, granularity = 'line' } = input;
  if (shouldUseDynamicMode(snapshot, current)) {
    return diffDynamic(snapshot.lineResults, current.lineResults);
  }
  const segments = computeDiff(snapshot.fullOutput, current.fullOutput, granularity);
  const identical =
    segments.length === 0 ||
    segments.every((segment) => segment.kind === 'equal');
  return { mode: 'compiled', segments, identical, granularity };
}

/**
 * Per-line dynamic diff. We collect every line that exists on EITHER
 * side, sort by line number, and emit a CompareRow with the
 * previous + current value. Multiple results on the same line
 * (rare — happens when both `magic` and `log` fire on the same
 * editor line) are joined with newline.
 */
function diffDynamic(
  previousRows: readonly LineResult[],
  currentRows: readonly LineResult[]
): DynamicCompareResult {
  const previousByLine = collapseRowsByLine(previousRows);
  const currentByLine = collapseRowsByLine(currentRows);
  const allLines = new Set<number>([
    ...previousByLine.keys(),
    ...currentByLine.keys(),
  ]);
  const sortedLines = Array.from(allLines).sort((a, b) => a - b);
  const rows: CompareRow[] = [];
  let identical = true;
  for (const line of sortedLines) {
    const previousEntry = previousByLine.get(line) ?? null;
    const currentEntry = currentByLine.get(line) ?? null;
    const previousValue = previousEntry?.value ?? null;
    const currentValue = currentEntry?.value ?? null;
    let kind: CompareRowKind;
    if (previousValue === null && currentValue !== null) {
      kind = 'added';
      identical = false;
    } else if (previousValue !== null && currentValue === null) {
      kind = 'removed';
      identical = false;
    } else if (previousValue !== currentValue) {
      kind = 'changed';
      identical = false;
    } else {
      kind = 'unchanged';
    }
    rows.push({
      line,
      previous: previousValue,
      current: currentValue,
      kind,
      type: currentEntry?.type ?? previousEntry?.type ?? 'log',
    });
  }
  return { mode: 'dynamic', rows, identical };
}

/**
 * Two `magic` entries on the same line collapse to a single row
 * with newline-joined values; same-line conflicts are rare but the
 * helper keeps the output deterministic.
 */
function collapseRowsByLine(
  rows: readonly LineResult[]
): Map<number, LineResult> {
  const out = new Map<number, LineResult>();
  for (const row of rows) {
    const existing = out.get(row.line);
    if (!existing) {
      out.set(row.line, row);
      continue;
    }
    out.set(row.line, {
      line: row.line,
      // Last-write-wins on `type` so the latest emission decides the
      // colour — matches how the live panel renders multiple results
      // on the same line.
      type: row.type,
      value: existing.value === '' ? row.value : `${existing.value}\n${row.value}`,
    });
  }
  return out;
}
