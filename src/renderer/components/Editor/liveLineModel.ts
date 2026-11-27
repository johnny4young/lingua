import type { LiveRunBinding, LiveRunSnapshot } from '../../../shared/liveRun';

/** A line holds the run at least this long before its answer turns to RUNNING, so a fast loop does not flicker. */
export const RUNNING_SHOWN_MS = 150;

export type LiveLineAnswer =
  | { readonly line: number; readonly kind: 'running'; readonly lineMs: number }
  | { readonly line: number; readonly kind: 'loop'; readonly pass: number; readonly total?: number; readonly binding?: LiveRunBinding };

/** Time on the running line `nowMs` after the snapshot arrived at `atMs`; a sleep never reads past its length. */
export function liveLineMs(live: LiveRunSnapshot, atMs: number, nowMs: number): number {
  const ms = live.lineMs + Math.max(0, nowMs - atMs);
  return live.waitMs === undefined ? ms : Math.min(ms, live.waitMs);
}

/**
 * What the answer column says while a run goes: each open loop on its header
 * line (the innermost when a recursion opens the same loop twice), and RUNNING
 * on the line that has held the run for `RUNNING_SHOWN_MS`, in place of
 * whatever that line answered.
 */
export function liveLineAnswers(live: LiveRunSnapshot, lineMs: number): LiveLineAnswer[] {
  const byLine = new Map<number, LiveLineAnswer>();
  for (const loop of live.loops) {
    if (loop.pass < 1) continue;
    byLine.set(loop.line, {
      line: loop.line,
      kind: 'loop',
      pass: loop.pass,
      ...(loop.total !== undefined ? { total: loop.total } : {}),
      ...(loop.binding ? { binding: loop.binding } : {}),
    });
  }
  if (lineMs >= RUNNING_SHOWN_MS) byLine.set(live.line, { line: live.line, kind: 'running', lineMs });
  return [...byLine.values()].sort((a, b) => a.line - b.line);
}

/** The innermost open loop around a line: the passes it makes and the one it is on. */
export interface EnclosingLoop {
  readonly total: number;
  readonly pass: number;
}

/**
 * The open loops as `line:end:total:pass`, so a snapshot that moves only the
 * running line or its time keeps the same key. A loop without a total stays in
 * the key, so it still shadows the loops around it.
 */
export function loopTotalsKey(live: LiveRunSnapshot | undefined): string {
  return (live?.loops ?? [])
    .flatMap(loop => (loop.end !== undefined ? [`${loop.line}:${loop.end}:${loop.total ?? '-'}:${loop.pass}`] : []))
    .join(',');
}

/** The innermost loop in `key` whose body holds `line`; undefined when that loop has no total. */
export function enclosingLoop(key: string, line: number): EnclosingLoop | undefined {
  if (!key) return undefined;
  const loops = key.split(',');
  for (let index = loops.length - 1; index >= 0; index -= 1) {
    const [header, end, total, pass] = loops[index]!.split(':').map(Number) as [number, number, number, number];
    if (line > header && line <= end) return Number.isNaN(total) ? undefined : { total, pass };
  }
  return undefined;
}
