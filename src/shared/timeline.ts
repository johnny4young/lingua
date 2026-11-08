/**
 * A recorded JS / TS run: one step before every statement the recorder
 * reached, in memory only. Recording stops at its caps and says so.
 */
export const TIMELINE_MAX_STEPS = 5_000;
export const TIMELINE_MAX_VARS = 30;
export const TIMELINE_VALUE_MAX_CHARS = 120;
export const TIMELINE_MAX_FRAMES = 16;
/** All values of one recording together, so a wide loop cannot grow the message without bound. */
export const TIMELINE_MAX_VALUE_CHARS = 2_000_000;
/** Free sees the last steps of a recording; paid tiers see all of them. */
export const TIMELINE_FREE_STEPS = 20;

/** Record run instruments the JS / TS Worker; Node, Deno, Bun and Browser preview run elsewhere. */
export function canRecordTimeline(tab: { language: string; runtimeMode?: string }): boolean {
  return (tab.language === 'javascript' || tab.language === 'typescript') && (tab.runtimeMode ?? 'worker') === 'worker';
}

export interface TimelineFrame {
  name: string;
  line: number;
}

export interface TimelineStep {
  line: number;
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
}

export interface ExecutionTimeline {
  steps: TimelineStep[];
  /** Recording stopped at a cap before the run ended. */
  truncated: boolean;
}

const text = (value: unknown, fallback = ''): string =>
  typeof value === 'string' ? value.slice(0, TIMELINE_VALUE_MAX_CHARS) : fallback;
const lineOf = (value: unknown): number => (Number.isInteger(value) && (value as number) > 0 ? (value as number) : 0);
const LOGS = new Set(['log', 'info', 'warn', 'error']);
const isCount = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;

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
    steps.push({
      line: lineOf(step.line),
      frames: frames.map(frame => ({
        name: text((frame as TimelineFrame | null)?.name, '<anonymous>'),
        line: lineOf((frame as TimelineFrame | null)?.line),
      })),
      vars: vars.map(pair => [text(Array.isArray(pair) ? pair[0] : ''), text(Array.isArray(pair) ? pair[1] : '')]),
      ...(isCount(step.depth) ? { depth: step.depth } : {}),
      ...(isCount(step.call) ? { call: step.call } : {}),
      ...(typeof step.log === 'string' && LOGS.has(step.log) ? { log: step.log as TimelineStep['log'] } : {}),
      ...(step.error === true ? { error: true as const } : {}),
    });
  }
  return { steps, truncated: raw.truncated === true || raw.steps.length > TIMELINE_MAX_STEPS };
}

export interface TimelineWorkerMessage {
  type: 'timeline';
  runId: string;
  timeline: ExecutionTimeline;
}
