import type {
  CollapsedConsoleRow,
  ConsoleEntry,
  ConsoleEntryType,
  ConsoleLevel,
} from '../types/console';
import { truncateText } from './truncateText';

/** True when a row of `type` shows under the `level` segment. */
export function entryMatchesLevel(type: ConsoleEntryType, level: ConsoleLevel): boolean {
  if (level === 'all') return true;
  if (level === 'log') return type === 'log' || type === 'info' || type === 'result';
  return type === level;
}

/** Source line from the rich payload origin, else the legacy entry line. */
export function sourceLineForEntry(entry: ConsoleEntry): number | null {
  const payload = Array.isArray(entry.payload) ? entry.payload : null;
  const payloadLine = payload?.find(p => p.origin)?.origin?.line;
  if (typeof payloadLine === 'number' && Number.isFinite(payloadLine) && payloadLine > 0) {
    return payloadLine;
  }
  return typeof entry.line === 'number' && Number.isFinite(entry.line) && entry.line > 0
    ? entry.line
    : null;
}

export interface PreviousRunPending {
  /** Line of the next output the previous run produced that this run has not yet. */
  waitingLine: number | null;
  /** Later previous-run rows on lines this run has not reached. */
  ghosts: CollapsedConsoleRow[];
}

/**
 * Match the previous run's line-keyed rows against the current run by
 * occurrence per line, so a loop printing three times on one line leaves the
 * third print pending after two. Rows without a source line cannot be placed.
 */
export function pendingFromPreviousRun(
  current: readonly CollapsedConsoleRow[],
  previous: readonly CollapsedConsoleRow[]
): PreviousRunPending {
  const seen = new Map<number, number>();
  let reached = 0;
  for (const { entry, repeatCount } of current) {
    const line = sourceLineForEntry(entry);
    if (line === null) continue;
    seen.set(line, (seen.get(line) ?? 0) + repeatCount);
    if (line > reached) reached = line;
  }

  const consumed = new Map<number, number>();
  let waitingLine: number | null = null;
  const ghosts: CollapsedConsoleRow[] = [];
  for (const row of previous) {
    const line = sourceLineForEntry(row.entry);
    if (line === null) continue;
    const before = consumed.get(line) ?? 0;
    consumed.set(line, before + row.repeatCount);
    const matched = Math.min(Math.max((seen.get(line) ?? 0) - before, 0), row.repeatCount);
    let left = row.repeatCount - matched;
    if (left === 0) continue;
    // The first owed print becomes the waiting row rather than a ghost.
    if (waitingLine === null) {
      waitingLine = line;
      left -= 1;
    }
    if (left > 0 && line > reached) {
      ghosts.push(left === row.repeatCount ? row : { entry: row.entry, repeatCount: left });
    }
  }
  return { waitingLine, ghosts };
}

/** `+0.44 s` from the run start; null when the row predates it. */
export function formatRunOffset(timestamp: number, startedAt: number): string | null {
  const ms = timestamp - startedAt;
  if (!Number.isFinite(ms) || ms < 0) return null;
  const seconds = ms / 1000;
  const digits = seconds < 10 ? 2 : seconds < 100 ? 1 : 0;
  return `+${seconds.toFixed(digits)} s`;
}

/** Trimmed source of `line` for the waiting row, clipped to stay on one tape row. */
export function sourceSnippet(code: string, line: number, max = 40): string | null {
  const text = code.split('\n')[line - 1]?.trim();
  return text ? truncateText(text, max) : null;
}
