import {
  TIMELINE_MAX_FRAMES,
  TIMELINE_MAX_STEPS,
  TIMELINE_MAX_VALUE_CHARS,
  TIMELINE_MAX_VARS,
  TIMELINE_PROGRESS_MS,
  TIMELINE_VALUE_MAX_CHARS,
  type ExecutionTimeline,
  type TimelineFrame,
  type TimelineProgress,
  type TimelineStep,
} from '../../shared/timeline';

type ConsoleMethod = NonNullable<TimelineStep['log']>;

const LOG_WEIGHT: Record<ConsoleMethod, number> = { info: 1, log: 2, warn: 3, error: 4 };
const MAX_DEPTH = 2;

function clip(text: string): string {
  return text.length > TIMELINE_VALUE_MAX_CHARS ? `${text.slice(0, TIMELINE_VALUE_MAX_CHARS - 1)}…` : text;
}

/**
 * A short preview that stops once it has enough characters and never calls
 * getters or `toJSON`, so user code does not run inside the recorder.
 */
export function previewTimelineValue(value: unknown, depth = 0): string {
  try {
    if (value === null) return 'null';
    switch (typeof value) {
      case 'string':
        return clip(JSON.stringify(value));
      case 'undefined':
        return 'undefined';
      case 'function':
        return '[Function]';
      case 'object':
        break;
      default:
        return clip(String(value));
    }
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? 'Invalid Date' : value.toISOString();
    if (value instanceof Error) return clip(`${value.name}: ${value.message}`);
    if (value instanceof Map) return `Map(${value.size})`;
    if (value instanceof Set) return `Set(${value.size})`;
    const isArray = Array.isArray(value);
    if (depth >= MAX_DEPTH) return isArray ? '[…]' : '{…}';
    const parts: string[] = [];
    let length = 0;
    const keys = isArray ? Array.from({ length: Math.min((value as unknown[]).length, TIMELINE_VALUE_MAX_CHARS) }, (_, i) => String(i)) : Object.keys(value);
    for (const key of keys) {
      if (length > TIMELINE_VALUE_MAX_CHARS) {
        parts.push('…');
        break;
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      const shown = !descriptor ? 'undefined' : 'value' in descriptor ? previewTimelineValue(descriptor.value, depth + 1) : '[Getter]';
      const part = isArray ? shown : `${/^[A-Za-z_$][\w$]*$/.test(key) ? key : JSON.stringify(key)}: ${shown}`;
      parts.push(part);
      length += part.length + 2;
    }
    if (isArray && (value as unknown[]).length > keys.length) parts.push('…');
    const body = parts.join(', ');
    return clip(isArray ? `[ ${body} ]` : parts.length === 0 ? '{}' : `{ ${body} }`);
  } catch {
    return '[unreadable]';
  }
}

export interface JsWorkerTimeline {
  /** `end` is the statement's last own line when it spans several. */
  rec: (line: unknown, getLocals: unknown, end?: unknown) => void;
  enter: (name: unknown, line: unknown) => void;
  exit: () => void;
  noteConsole: (method: ConsoleMethod) => void;
  noteError: () => void;
  /** Posts the steps since the last post and any marks the last posted step got since; nothing once `snapshot` has run, which also stops the timer. */
  flushSteps: () => void;
  snapshot: () => ExecutionTimeline;
}

const safeLine = (line: unknown): number => (Number.isInteger(line) && (line as number) > 0 ? (line as number) : 0);

function safeName(name: unknown): string {
  try {
    return String(name).slice(0, TIMELINE_VALUE_MAX_CHARS);
  } catch {
    return '<anonymous>';
  }
}

/**
 * Step buffer for Record run. Past a cap it only tracks the current line, so
 * long loops stay fast, and it never throws into the user's code. With
 * `postSteps`, steps also go out while the run records, at most every TIMELINE_PROGRESS_MS.
 */
export function createJsWorkerTimeline(
  now: () => number = () => performance.now(),
  postSteps?: (progress: TimelineProgress) => void
): JsWorkerTimeline {
  const steps: TimelineStep[] = [];
  const startedAt = now();
  let sent = 0;
  let flushedAt = startedAt;
  let ended = false;
  // Time spent reading locals is the recorder's, not the line's.
  let overhead = 0;
  const elapsedAt = (at: number) => Math.max(0, at - startedAt - overhead);
  const frames: TimelineFrame[] = [{ name: '<module>', line: 0 }];
  const calls = [0];
  let lastCall = 0;
  let truncated = false;
  let chars = 0;
  // Marks the last posted step got after it went out; they travel with the next post.
  let late: TimelineProgress['marks'];
  const mark = (step: TimelineStep) => {
    if (steps.length === sent) late = { ...(step.log ? { log: step.log } : {}), ...(step.error ? { error: true as const } : {}) };
  };
  const flushSteps = () => {
    if (ended || !postSteps || (sent >= steps.length && !late)) return;
    const fresh = steps.slice(sent);
    const marks = late;
    sent = steps.length;
    late = undefined;
    flushedAt = now();
    try {
      postSteps({ steps: fresh, ms: elapsedAt(flushedAt), ...(marks ? { marks } : {}) });
    } catch {
      // The final timeline still carries every step.
    }
  };
  // Steps before an await reach the trace while the run waits.
  const timer = postSteps ? setInterval(flushSteps, TIMELINE_PROGRESS_MS) : null;

  return {
    rec: (line, getLocals, end) => {
      let entered: number | null = null;
      try {
        frames[frames.length - 1]!.line = safeLine(line);
        if (truncated) return;
        entered = now();
        if (steps.length >= TIMELINE_MAX_STEPS) {
          truncated = true;
          return;
        }
        let locals: Record<string, unknown>;
        try {
          locals = typeof getLocals === 'function' ? (getLocals() as Record<string, unknown>) : {};
        } catch {
          locals = {};
        }
        const vars: TimelineStep['vars'] = [];
        for (const name of Object.keys(locals ?? {})) {
          if (vars.length >= TIMELINE_MAX_VARS) break;
          const value = locals[name];
          if (typeof value === 'function') continue;
          const label = safeName(name);
          const text = previewTimelineValue(value);
          chars += label.length + text.length;
          vars.push([label, text]);
        }
        const kept = frames.slice(-TIMELINE_MAX_FRAMES).map(frame => ({ ...frame }));
        chars += kept.reduce((sum, frame) => sum + frame.name.length, 0);
        if (chars > TIMELINE_MAX_VALUE_CHARS) {
          truncated = true;
          return;
        }
        const ms = elapsedAt(entered);
        const step: TimelineStep = { line: frames[frames.length - 1]!.line, frames: kept, vars, depth: frames.length - 1, call: calls[calls.length - 1]!, ms };
        if (safeLine(end) > step.line) step.end = safeLine(end);
        steps.push(step);
        if (entered - flushedAt >= TIMELINE_PROGRESS_MS) flushSteps();
      } catch {
        truncated = true;
      } finally {
        if (entered !== null && !truncated) overhead += now() - entered;
      }
    },
    enter: (name, line) => {
      frames.push({ name: safeName(name), line: safeLine(line) });
      lastCall += 1;
      calls.push(lastCall);
    },
    exit: () => {
      if (frames.length > 1) {
        frames.pop();
        calls.pop();
      }
    },
    noteConsole: method => {
      const step = steps[steps.length - 1];
      if (step && (!step.log || LOG_WEIGHT[method] > LOG_WEIGHT[step.log])) {
        step.log = method;
        mark(step);
      }
    },
    noteError: () => {
      const step = steps[steps.length - 1];
      if (step) {
        step.error = true;
        mark(step);
      }
    },
    flushSteps,
    snapshot: () => {
      ended = true;
      if (timer !== null) clearInterval(timer);
      return { steps, truncated, ms: elapsedAt(now()) };
    },
  };
}

/** Marks the latest step for each console call, on top of the run's console proxy. */
export function watchJsWorkerConsoleForTimeline(timeline: JsWorkerTimeline): void {
  for (const method of ['log', 'info', 'warn', 'error', 'debug', 'table', 'dir'] as const) {
    const write = console[method] as (...args: unknown[]) => void;
    if (typeof write !== 'function') continue;
    const mark: ConsoleMethod = method === 'info' || method === 'warn' || method === 'error' ? method : 'log';
    console[method] = (...args: unknown[]) => {
      timeline.noteConsole(mark);
      write(...args);
    };
  }
}
