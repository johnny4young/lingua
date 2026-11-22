import type { TimelineStep } from '../../shared/timeline';
import { timelineDepth } from './timelineModel';

export interface SlowestLine {
  line: number;
  ms: number;
  /** Run time when recording ended, including setup before the first step. */
  total: number;
  /** 0..1 of `total`. */
  share: number;
}

/**
 * Self time per line: each step lasts until the next one begins, the last
 * until `endMs`. Null when a step carries no time, so a partial clock is never shown.
 */
export function lineTimes(steps: readonly TimelineStep[], endMs: number | undefined): Map<number, number> | null {
  if (endMs === undefined || steps.length === 0) return null;
  const totals = new Map<number, number>();
  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index]!;
    const until = index + 1 < steps.length ? steps[index + 1]!.ms : endMs;
    if (step.ms === undefined || until === undefined) return null;
    totals.set(step.line, (totals.get(step.line) ?? 0) + Math.max(0, until - step.ms));
  }
  return totals;
}

export function slowestLine(steps: readonly TimelineStep[], endMs: number | undefined): SlowestLine | null {
  const totals = lineTimes(steps, endMs);
  if (!totals) return null;
  let total = 0;
  let line = 0;
  let ms = -1;
  for (const [at, spent] of totals) {
    total += spent;
    if (spent > ms) [line, ms] = [at, spent];
  }
  // The run clock starts before the first step, so the whole run is the base.
  const run = Math.max(total, endMs ?? 0);
  return total > 0 ? { line, ms, total: run, share: ms / run } : null;
}

export interface TraceLoop {
  /** The line each backward jump lands on. */
  head: number;
  /** Step ranges of each pass, inclusive. */
  passes: Array<{ start: number; end: number }>;
  start: number;
  end: number;
  minLine: number;
  maxLine: number;
}

interface OpenLoop {
  head: number;
  starts: number[];
}

const frameKey = (step: TimelineStep): string => `${step.call ?? '-'}:${timelineDepth(step)}`;

/**
 * Loops, read off the steps: inside one call a jump back to a smaller line
 * starts a new pass of the loop headed by that line. Calls made by the body
 * stay inside its pass.
 */
export function detectLoops(steps: readonly TimelineStep[]): TraceLoop[] {
  const frames = new Map<string, { indices: number[]; open: OpenLoop[] }>();
  const found: Array<OpenLoop & { frame: number[] }> = [];
  steps.forEach((step, index) => {
    let frame = frames.get(frameKey(step));
    if (!frame) frames.set(frameKey(step), (frame = { indices: [], open: [] }));
    const { indices } = frame;
    const previous = indices.length > 0 ? steps[indices[indices.length - 1]!]!.line : undefined;
    // Leaving above a loop's head ends it; coming back later is another loop.
    frame.open = frame.open.filter(loop => loop.head <= step.line);
    if (previous !== undefined && step.line < previous) {
      const live = frame.open.find(loop => loop.head === step.line);
      if (live) live.starts.push(index);
      else {
        let first = -1;
        for (let at = indices.length - 1; at >= 0 && steps[indices[at]!]!.line >= step.line; at -= 1) {
          if (steps[indices[at]!]!.line === step.line) first = indices[at]!;
        }
        const loop = { head: step.line, starts: first < 0 ? [index] : [first, index], frame: indices };
        frame.open.push(loop);
        found.push(loop);
      }
    }
    indices.push(index);
  });

  return found.flatMap(({ head, starts, frame }) => {
    if (starts.length < 2) return [];
    const lastStart = starts[starts.length - 1]!;
    let bodyMax = head;
    for (const at of frame) if (at >= starts[0]! && at < lastStart) bodyMax = Math.max(bodyMax, steps[at]!.line);
    // The last pass runs while the call stays on the lines earlier passes covered.
    let end = lastStart;
    for (let at = frame.indexOf(lastStart) + 1; at < frame.length; at += 1) {
      const line = steps[frame[at]!]!.line;
      if (line < head || line > bodyMax) break;
      end = frame[at]!;
    }
    const passes = starts.map((start, pass) => ({ start, end: pass + 1 < starts.length ? starts[pass + 1]! - 1 : end }));
    let minLine = head;
    let maxLine = head;
    for (let at = starts[0]!; at <= end; at += 1) {
      minLine = Math.min(minLine, steps[at]!.line);
      maxLine = Math.max(maxLine, steps[at]!.line);
    }
    return [{ head, passes, start: starts[0]!, end, minLine, maxLine }];
  });
}

/** The widest loops first, without the ones nested inside a loop already kept. */
export function pickLoops(loops: readonly TraceLoop[], max = 3): TraceLoop[] {
  const kept: TraceLoop[] = [];
  const widest = [...loops].sort((a, b) => b.end - b.start - (a.end - a.start) || a.start - b.start);
  for (const loop of widest) {
    if (kept.length >= max) break;
    if (!kept.some(outer => outer.start <= loop.start && loop.end <= outer.end)) kept.push(loop);
  }
  return kept.sort((a, b) => a.start - b.start);
}

/** Lines to label, top to bottom, dropping any closer than `minGap` to the label before it. */
export function pickTicks(lines: Iterable<number>, yOf: (line: number) => number, minGap = 12): number[] {
  const ticks: number[] = [];
  let lastY = -Infinity;
  for (const line of [...new Set(lines)].sort((a, b) => a - b)) {
    const y = yOf(line);
    if (y - lastY < minGap) continue;
    ticks.push(line);
    lastY = y;
  }
  return ticks;
}

/** Step indices to draw: all of them up to `max`, then an even sample that keeps marked steps. */
export function sampleSteps(steps: readonly TimelineStep[], current: number, max: number): number[] {
  if (steps.length <= Math.max(2, max)) return steps.map((_, index) => index);
  const every = Math.ceil(steps.length / Math.max(2, max));
  const last = steps.length - 1;
  return steps.flatMap((step, index) =>
    index % every === 0 || index === last || index === current || step.log || step.error ? [index] : []
  );
}
