/**
 * Where a run is while it goes: the line that is running, how long it has been
 * on it, and the pass of each loop around it. Workers post at most one snapshot
 * per `LIVE_RUN_THROTTLE_MS`; every time is measured on the worker's clock.
 */
export const LIVE_RUN_PROTOCOL_VERSION = 1;
export const LIVE_RUN_THROTTLE_MS = 50;
/** Innermost loops kept per snapshot. */
export const LIVE_RUN_MAX_LOOPS = 8;

export interface LiveRunLoop {
  /** The loop's header line. */
  readonly line: number;
  /** 1-based pass of this execution of the loop; 0 before its first pass. */
  readonly pass: number;
  /** Passes the loop will make, when the runtime can tell without running it. */
  readonly total?: number;
}

export interface LiveRunSnapshot {
  readonly line: number;
  /** Time on `line` since it started, when the snapshot was taken. */
  readonly lineMs: number;
  /** Run time when the snapshot was taken. */
  readonly elapsedMs: number;
  /** Loops around the running line, outermost first, the caller's loops included. */
  readonly loops: readonly LiveRunLoop[];
  /** The line is blocked in a sleep of this length. */
  readonly waitMs?: number;
}

/** Additive: a newer worker may send fields this version ignores. */
export interface LiveRunWorkerMessage {
  type: 'live-line';
  runId: string;
  v: number;
  live: LiveRunSnapshot;
}

const lineOf = (value: unknown): number => (Number.isSafeInteger(value) && (value as number) > 0 ? (value as number) : 0);
const countOf = (value: unknown): number | undefined =>
  Number.isSafeInteger(value) && (value as number) >= 0 ? (value as number) : undefined;
const msOf = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;

/** A result's loop pass from a worker reply, as a field to spread; see `ConsoleOutput.pass`. */
export function livePassField(value: unknown): { pass?: number } {
  const pass = countOf(value);
  return pass === undefined ? {} : { pass };
}

/** Re-checks a snapshot from a worker, which user code can reach; undefined when it has no line. */
export function sanitizeLiveRun(value: unknown): LiveRunSnapshot | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as Record<string, unknown>;
  const line = lineOf(raw.line);
  if (line === 0) return undefined;
  const loops: LiveRunLoop[] = [];
  // Bounded before the walk; the innermost loops are kept after the bad entries are gone.
  for (const item of Array.isArray(raw.loops) ? raw.loops.slice(-LIVE_RUN_MAX_LOOPS * 4) : []) {
    if (!item || typeof item !== 'object') continue;
    const loop = item as Record<string, unknown>;
    const loopLine = lineOf(loop.line);
    const pass = countOf(loop.pass);
    if (loopLine === 0 || pass === undefined) continue;
    const total = countOf(loop.total);
    loops.push({ line: loopLine, pass, ...(total !== undefined ? { total } : {}) });
  }
  const waitMs = msOf(raw.waitMs);
  return {
    line,
    lineMs: msOf(raw.lineMs) ?? 0,
    elapsedMs: msOf(raw.elapsedMs) ?? 0,
    loops: loops.slice(-LIVE_RUN_MAX_LOOPS),
    ...(waitMs !== undefined ? { waitMs } : {}),
  };
}

/** Maps every line of a snapshot, dropping loops whose header does not map. */
export function mapLiveRunLines(live: LiveRunSnapshot, map: (line: number) => number | undefined): LiveRunSnapshot | undefined {
  const line = map(live.line);
  if (!line) return undefined;
  const loops = live.loops.flatMap(loop => {
    const header = map(loop.line);
    return header ? [{ ...loop, line: header }] : [];
  });
  return { ...live, line, loops };
}
