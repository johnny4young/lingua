import type { TabRun } from '../../stores/resultStore';

export type MeterState =
  | 'idle'
  | 'running'
  | 'paused'
  | 'done'
  | 'error'
  | 'timeout'
  | 'stopped'
  | 'stale';

/** Bars the meter column holds at its full width. */
const METER_BARS = 7;

export function meterState(input: {
  running: boolean;
  paused: boolean;
  stale: boolean;
  last: TabRun | null;
}): MeterState {
  if (input.paused) return 'paused';
  if (input.running) return 'running';
  if (!input.last) return 'idle';
  if (input.stale) return 'stale';
  return input.last.kind === 'success' ? 'done' : input.last.kind;
}

type MeterBarKind = 'ok' | 'error' | 'timeout' | 'stopped' | 'live';

export interface MeterBar {
  number: number;
  kind: MeterBarKind;
  durationMs: number | null;
  /** Fill height, 0–1. Failed and stopped runs draw a stub instead. */
  height: number;
  /** The previous run's height, dashed behind the live bar. */
  expected?: number;
  latest: boolean;
}

const MIN_HEIGHT = 0.12;

function barKind(run: TabRun): MeterBarKind {
  return run.kind === 'success' ? 'ok' : run.kind === 'error' ? 'error' : run.kind;
}

/**
 * The newest runs as bars on a square-root scale, so one slow run does not
 * flatten the rest. A live run takes the last slot and fills toward the
 * previous run's duration.
 */
export function meterBars(
  runs: readonly TabRun[],
  live: { number: number; elapsedMs: number } | null,
  slots: number = METER_BARS
): MeterBar[] {
  const settled = runs.slice(-(live ? slots - 1 : slots));
  const previous = runs.at(-1)?.durationMs ?? null;
  const scaled = [
    ...settled.filter(run => run.kind === 'success').map(run => run.durationMs ?? 0),
    ...(live ? [live.elapsedMs, previous ?? 0] : []),
  ];
  const max = Math.sqrt(Math.max(1, ...scaled));
  const height = (ms: number) => Math.min(1, Math.max(MIN_HEIGHT, Math.sqrt(Math.max(0, ms)) / max));
  const bars: MeterBar[] = settled.map((run, index) => ({
    number: run.number,
    kind: barKind(run),
    durationMs: run.durationMs,
    height: run.kind === 'success' ? height(run.durationMs ?? 0) : 0,
    latest: !live && index === settled.length - 1,
  }));
  if (live) {
    bars.push({
      number: live.number,
      kind: 'live',
      durationMs: live.elapsedMs,
      height: height(live.elapsedMs),
      ...(previous !== null ? { expected: height(previous) } : {}),
      latest: true,
    });
  }
  return bars;
}
