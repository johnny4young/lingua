/**
 * A recorded JS / TS or Python run: one step before every statement (Python:
 * every line) the recorder reached, in memory only. Recording stops at its caps and says so.
 */
export const TIMELINE_MAX_STEPS = 5_000;
export const TIMELINE_MAX_VARS = 30;
export const TIMELINE_VALUE_MAX_CHARS = 120;
export const TIMELINE_MAX_FRAMES = 16;
/** All values of one recording together, so a wide loop cannot grow the message without bound. */
export const TIMELINE_MAX_VALUE_CHARS = 2_000_000;
/** Free sees the last steps of a recording; paid tiers see all of them. */
export const TIMELINE_FREE_STEPS = 20;

/** Steps reach the renderer at most this often while a recording goes. */
export const TIMELINE_PROGRESS_MS = 100;

/** Record run instruments the JS / TS Worker and Pyodide; Node, Deno, Bun and Browser preview run elsewhere. */
export function canRecordTimeline(tab: { language: string; runtimeMode?: string }): boolean {
  if (tab.language === 'python') return true;
  return (tab.language === 'javascript' || tab.language === 'typescript') && (tab.runtimeMode ?? 'worker') === 'worker';
}

export interface TimelineFrame {
  name: string;
  line: number;
}

export interface TimelineStep {
  line: number;
  /** Last line the statement covers on its own, when it spans several. */
  end?: number;
  /** Innermost frame last; `<module>` first. */
  frames: TimelineFrame[];
  /** Call depth, which `frames` loses past its cap. */
  depth?: number;
  /** Which call the step ran in, so two calls at the same depth stay apart. */
  call?: number;
  vars: Array<[name: string, value: string]>;
  /** Console output this step wrote, by its strongest method. */
  log?: 'log' | 'info' | 'warn' | 'error';
  /** The run threw while this step was the latest. */
  error?: true;
  /** Run time in ms when the step began, without the recorder's own time. */
  ms?: number;
}

/** Marks the previous batch's last step got after it was posted: its current ones, which replace those it went out with. */
export type TimelineStepMarks = Pick<TimelineStep, 'log' | 'error'>;

/** What a recording in flight posts: its new steps, the run time at the post, and late marks. */
export interface TimelineProgress {
  steps: TimelineStep[];
  ms: number;
  marks?: TimelineStepMarks;
}

export interface ExecutionTimeline {
  steps: TimelineStep[];
  /** Recording stopped at a cap before the run ended. */
  truncated: boolean;
  /** Run time in ms when recording ended, on the same clock as `TimelineStep.ms`. */
  ms?: number;
}

const text = (value: unknown, fallback = ''): string =>
  typeof value === 'string' ? value.slice(0, TIMELINE_VALUE_MAX_CHARS) : fallback;
const lineOf = (value: unknown): number => (Number.isInteger(value) && (value as number) > 0 ? (value as number) : 0);
const LOGS = new Set(['log', 'info', 'warn', 'error']);
const isCount = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const isTime = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;

/** A step's console and error marks from worker data, or undefined when it has none. */
function marksOf(value: unknown): TimelineStepMarks | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as Record<string, unknown>;
  const log = typeof raw.log === 'string' && LOGS.has(raw.log) ? (raw.log as TimelineStep['log']) : undefined;
  if (!log && raw.error !== true) return undefined;
  return { ...(log ? { log } : {}), ...(raw.error === true ? { error: true as const } : {}) };
}

/** Re-applies the caps and types to a timeline from the worker, which user code can reach. */
export function sanitizeTimeline(value: unknown): ExecutionTimeline | undefined {
  if (!value || typeof value !== 'object' || !Array.isArray((value as ExecutionTimeline).steps)) return undefined;
  const raw = value as { steps: unknown[]; truncated?: unknown };
  const steps: TimelineStep[] = [];
  for (const item of raw.steps.slice(0, TIMELINE_MAX_STEPS)) {
    if (!item || typeof item !== 'object') continue;
    const step = item as Record<string, unknown>;
    const frames = Array.isArray(step.frames) ? step.frames.slice(-TIMELINE_MAX_FRAMES) : [];
    const vars = Array.isArray(step.vars) ? step.vars.slice(0, TIMELINE_MAX_VARS) : [];
    const line = lineOf(step.line);
    steps.push({
      line,
      ...(line > 0 && lineOf(step.end) > line ? { end: step.end as number } : {}),
      frames: frames.map(frame => ({
        name: text((frame as TimelineFrame | null)?.name, '<anonymous>'),
        line: lineOf((frame as TimelineFrame | null)?.line),
      })),
      vars: vars.map(pair => [text(Array.isArray(pair) ? pair[0] : ''), text(Array.isArray(pair) ? pair[1] : '')]),
      ...(isCount(step.depth) ? { depth: step.depth } : {}),
      ...(isCount(step.call) ? { call: step.call } : {}),
      ...marksOf(step),
      ...(isTime(step.ms) ? { ms: step.ms } : {}),
    });
  }
  const ms = (raw as { ms?: unknown }).ms;
  return { steps, truncated: raw.truncated === true || raw.steps.length > TIMELINE_MAX_STEPS, ...(isTime(ms) ? { ms } : {}) };
}

/** A batch a recording in flight posted, re-checked like the whole timeline; null when there is nothing to show. */
export function sanitizeTimelineSteps(message: { steps: unknown; ms: unknown; marks?: unknown }): TimelineProgress | null {
  const progress = sanitizeTimeline({ steps: Array.isArray(message.steps) ? message.steps : [], ms: message.ms });
  const marks = marksOf(message.marks);
  if (progress?.ms === undefined || (progress.steps.length === 0 && !marks)) return null;
  return { steps: progress.steps, ms: progress.ms, ...(marks ? { marks } : {}) };
}

/** Maps each step's and frame's line, as runners do for code they rewrote before it ran. */
export function mapTimelineLines(timeline: ExecutionTimeline, map: (line: number) => number | undefined): ExecutionTimeline {
  const to = (line: number) => (line > 0 ? (map(line) ?? line) : line);
  return {
    ...timeline,
    steps: timeline.steps.map(({ end, ...step }) => {
      const line = to(step.line);
      const last = end === undefined ? line : to(end);
      return { ...step, line, ...(last > line ? { end: last } : {}), frames: step.frames.map(frame => ({ ...frame, line: to(frame.line) })) };
    }),
  };
}

export type TimelineWorkerMessage =
  | { type: 'timeline'; runId: string; timeline: ExecutionTimeline }
  /** Steps recorded since the last post while the run goes, and the run time at the post. */
  | ({ type: 'timeline-steps'; runId: string } & TimelineProgress);
