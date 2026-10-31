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

export interface TimelineWorkerMessage {
  type: 'timeline';
  runId: string;
  timeline: ExecutionTimeline;
}
