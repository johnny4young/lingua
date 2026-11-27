import {
  LIVE_RUN_MAX_LOOPS,
  LIVE_RUN_THROTTLE_MS,
  type LiveLoopSpan,
  type LiveRunBinding,
  type LiveRunLoop,
  type LiveRunSnapshot,
} from '../../shared/liveRun';
import { readPreview } from './js-worker-live-preview';

/**
 * Probes run before every statement, so the clock is read only once per
 * countdown. The countdown doubles while probes come faster than SAMPLE_MS and
 * drops to 1 when they slow down, so slow code reads the clock at every line
 * and a hot loop pays for one read per few hundred probes.
 */
const SAMPLE_MS = 0.5;
const MAX_COUNTDOWN = 512;

interface ActiveLoop {
  readonly id: number;
  readonly line: number;
  readonly end: number;
  /** Reads the pass counter the instrumented loop keeps. */
  readonly pass: () => number;
  /** Reads the loop variable's slot, for a loop that binds one name. */
  readonly binding: { readonly name: string; readonly read: () => unknown } | undefined;
  total?: number;
  /** The run-wide number given to the pass `numberedPass`. */
  ordinal: number;
  numberedPass: number;
}

export interface JsWorkerLiveTracker {
  readonly line: (line: number) => void;
  readonly loop: (id: number, pass: () => number, read?: () => unknown, name?: string) => void;
  readonly end: (id: number) => void;
  /** Called on some passes of a hot loop, so its countdown still reaches the clock. */
  readonly pass: () => void;
  readonly of: <T>(id: number, value: T) => T;
  /** The innermost running loop's pass number, 0 outside loops. */
  readonly passOrdinal: () => number;
  readonly stop: () => void;
}

function bindingOf(entry: ActiveLoop): { binding?: LiveRunBinding } {
  const value = entry.binding && entry.pass() > 0 ? readPreview(entry.binding.read) : undefined;
  return value === undefined ? {} : { binding: { name: entry.binding!.name, value } };
}

function sizeOf(value: unknown): number | undefined {
  if (typeof value === 'string' || Array.isArray(value) || ArrayBuffer.isView(value)) {
    return (value as { length: number }).length;
  }
  if (value instanceof Set || value instanceof Map) return value.size;
  return undefined;
}

/** `loopSpans[id]` is the header and body end of loop `id` in the source. */
export function createJsWorkerLive(
  post: (live: LiveRunSnapshot) => void,
  loopSpans: readonly LiveLoopSpan[],
  now: () => number = () => performance.now()
): JsWorkerLiveTracker {
  const start = now();
  let current = 0;
  let sampledLine = 0;
  let lineStart = start;
  let countdown = 1;
  let budget = 1;
  let lastSample = start;
  let lastPost = start;
  let ordinals = 0;
  const stack: ActiveLoop[] = [];

  const snapshot = (at: number): LiveRunSnapshot => ({
    line: current,
    lineMs: at - lineStart,
    elapsedMs: at - start,
    loops: stack.slice(-LIVE_RUN_MAX_LOOPS).map(
      (entry): LiveRunLoop => ({
        line: entry.line,
        ...(entry.end > 0 ? { end: entry.end } : {}),
        pass: entry.pass(),
        ...(entry.total !== undefined ? { total: entry.total } : {}),
        ...bindingOf(entry),
      })
    ),
  });

  // `exact` when a line probe reads the clock at every probe, so it stands right before its statement.
  const sample = (exact: boolean) => {
    const at = now();
    if (current !== sampledLine) {
      lineStart = exact && budget === 1 ? at : lastSample;
      sampledLine = current;
    }
    const gap = at - lastSample;
    lastSample = at;
    budget = gap < SAMPLE_MS / 2 ? Math.min(budget * 2, MAX_COUNTDOWN) : gap > SAMPLE_MS * 2 ? 1 : budget;
    countdown = budget;
    if (current > 0 && at - lastPost >= LIVE_RUN_THROTTLE_MS) {
      lastPost = at;
      post(snapshot(at));
    }
  };

  // Fires only while the run awaits, which is when a probe cannot.
  const heartbeat = setInterval(() => sample(false), LIVE_RUN_THROTTLE_MS);

  // Loops close in reverse order: every tracked loop sits in sync code and closes in `finally`.
  const top = (id: number): ActiveLoop | undefined => {
    const entry = stack[stack.length - 1];
    return entry?.id === id ? entry : undefined;
  };

  return {
    line(line) {
      current = line;
      if (--countdown <= 0) sample(true);
    },
    loop(id, pass, read, name) {
      const { line = 0, end = 0 } = loopSpans[id] ?? {};
      stack.push({ id, line, end, pass, binding: read && typeof name === 'string' ? { name, read } : undefined, ordinal: 0, numberedPass: -1 });
    },
    end(id) {
      if (top(id)) stack.pop();
    },
    pass() {
      if (--countdown <= 0) sample(false);
    },
    of(id, value) {
      const entry = top(id);
      if (entry) entry.total = sizeOf(value);
      return value;
    },
    passOrdinal() {
      const entry = stack[stack.length - 1];
      if (entry === undefined) return 0;
      const pass = entry.pass();
      if (pass !== entry.numberedPass) {
        entry.numberedPass = pass;
        entry.ordinal = ++ordinals;
      }
      return entry.ordinal;
    },
    stop: () => clearInterval(heartbeat),
  };
}
