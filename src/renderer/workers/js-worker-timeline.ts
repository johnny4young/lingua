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
import { serializeJsWorkerValues } from './js-worker-serialization';

type ConsoleMethod = NonNullable<TimelineStep['log']>;

const LOG_WEIGHT: Record<ConsoleMethod, number> = { info: 1, log: 2, warn: 3, error: 4 };

export interface JsWorkerTimeline {
  rec: (line: number, getLocals: () => Record<string, unknown>) => void;
  enter: (name: string, line: number) => void;
  exit: () => void;
  noteConsole: (method: ConsoleMethod) => void;
  noteError: () => void;
  snapshot: () => ExecutionTimeline;
}

/** Step buffer for Record run. Past a cap it only tracks the current line, so long loops stay fast. */
export function createJsWorkerTimeline(marker: string): JsWorkerTimeline {
  const steps: TimelineStep[] = [];
  const frames: TimelineFrame[] = [{ name: '<module>', line: 0 }];
  let truncated = false;
  let valueChars = 0;

  const preview = (value: unknown): string => {
    let text: string;
    try {
      text = serializeJsWorkerValues([value], marker)[0] ?? '';
    } catch {
      text = String(value);
    }
    return text.length > TIMELINE_VALUE_MAX_CHARS ? `${text.slice(0, TIMELINE_VALUE_MAX_CHARS - 1)}…` : text;
  };

  return {
    rec: (line, getLocals) => {
      frames[frames.length - 1]!.line = line;
      if (truncated) return;
      if (steps.length >= TIMELINE_MAX_STEPS) {
        truncated = true;
        return;
      }
      let locals: Record<string, unknown>;
      try {
        locals = getLocals();
      } catch {
        locals = {};
      }
      const vars: TimelineStep['vars'] = [];
      for (const [name, value] of Object.entries(locals)) {
        if (vars.length >= TIMELINE_MAX_VARS) break;
        if (typeof value === 'function') continue;
        const text = preview(value);
        valueChars += text.length;
        vars.push([name, text]);
      }
      if (valueChars > TIMELINE_MAX_VALUE_CHARS) {
        truncated = true;
        return;
      }
      steps.push({ line, frames: frames.slice(-TIMELINE_MAX_FRAMES).map(frame => ({ ...frame })), vars });
    },
    enter: (name, line) => {
      frames.push({ name, line });
    },
    exit: () => {
      if (frames.length > 1) frames.pop();
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
  for (const method of ['log', 'info', 'warn', 'error'] as const) {
    const write = console[method];
    console[method] = (...args: unknown[]) => {
      timeline.noteConsole(method);
      write(...args);
    };
  }
}
