import {
  TIMELINE_MAX_FRAMES,
  TIMELINE_MAX_STEPS,
  TIMELINE_MAX_VALUE_CHARS,
  TIMELINE_MAX_VARS,
  TIMELINE_VALUE_MAX_CHARS,
  type ExecutionTimeline,
  type TimelineFrame,
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
  rec: (line: unknown, getLocals: unknown) => void;
  enter: (name: unknown, line: unknown) => void;
  exit: () => void;
  noteConsole: (method: ConsoleMethod) => void;
  noteError: () => void;
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
 * long loops stay fast, and it never throws into the user's code.
 */
export function createJsWorkerTimeline(): JsWorkerTimeline {
  const steps: TimelineStep[] = [];
  const frames: TimelineFrame[] = [{ name: '<module>', line: 0 }];
  const calls = [0];
  let lastCall = 0;
  let truncated = false;
  let chars = 0;

  return {
    rec: (line, getLocals) => {
      try {
        frames[frames.length - 1]!.line = safeLine(line);
        if (truncated) return;
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
        steps.push({ line: frames[frames.length - 1]!.line, frames: kept, vars, depth: frames.length - 1, call: calls[calls.length - 1]! });
      } catch {
        truncated = true;
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
      if (step && (!step.log || LOG_WEIGHT[method] > LOG_WEIGHT[step.log])) step.log = method;
    },
    noteError: () => {
      const step = steps[steps.length - 1];
      if (step) step.error = true;
    },
    snapshot: () => ({ steps, truncated }),
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
