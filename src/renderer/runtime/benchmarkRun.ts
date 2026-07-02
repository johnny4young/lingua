/**
 * Benchmark runtime (F-5) — micro-profiling for a single tab's code.
 *
 * Runs the active tab's source through the normal runner N times and
 * summarizes the per-run `executionTime` the runner already reports. A
 * few warmup runs are executed first and discarded so JIT / worker
 * spin-up cost does not skew the sample.
 *
 * Pure-ish and dependency-light: the stats helper (`computeBenchmarkStats`)
 * is a pure function unit-tested in isolation; `runBenchmark` is the thin
 * async loop that drives `runnerManager.execute` and aggregates the
 * samples. The first run that errors aborts the batch and surfaces the
 * runner's error message so the user is not shown stats for code that
 * never actually ran.
 *
 * Gating: this module does NOT check entitlements — the caller (the
 * command-palette action / hook) is responsible for the `BENCHMARK`
 * entitlement gate so the pure runtime stays testable without a license
 * store. That mirrors how `executeTabManually` leaves tier policy to its
 * callers.
 */

import { runnerManager } from '../runners';
import type { RuntimeMode } from '../../shared/runtimeModes';

export const BENCHMARK_MIN_ITERATIONS = 1;
export const BENCHMARK_MAX_ITERATIONS = 500;
export const BENCHMARK_DEFAULT_ITERATIONS = 20;
export const BENCHMARK_DEFAULT_WARMUP = 3;

export interface BenchmarkStats {
  /** Number of timed samples (excludes warmup). */
  runs: number;
  min: number;
  max: number;
  mean: number;
  median: number;
  /** 95th percentile (nearest-rank). */
  p95: number;
  /** Population standard deviation. */
  stdev: number;
  /** Sum of every timed sample. */
  total: number;
}

export type BenchmarkResult =
  | { ok: true; stats: BenchmarkStats; samples: readonly number[] }
  | { ok: false; reason: 'no-samples' | 'run-error'; message?: string };

export interface RunBenchmarkArgs {
  code: string;
  language: string;
  runtimeMode?: RuntimeMode;
  iterations: number;
  warmup?: number;
  /** Per-run wall-clock budget passed to the runner. */
  timeout?: number;
  /** Fired after each timed run so the UI can show progress. */
  onProgress?: (completed: number, total: number) => void;
}

/** Clamp iterations to the supported window. */
export function clampIterations(value: number): number {
  if (!Number.isFinite(value)) return BENCHMARK_DEFAULT_ITERATIONS;
  return Math.max(
    BENCHMARK_MIN_ITERATIONS,
    Math.min(BENCHMARK_MAX_ITERATIONS, Math.floor(value))
  );
}

/**
 * Compute summary statistics for a non-empty list of millisecond samples.
 * Pure — no I/O, no rounding beyond what callers apply for display.
 * Returns `null` for an empty sample set so callers surface `no-samples`.
 */
export function computeBenchmarkStats(samples: readonly number[]): BenchmarkStats | null {
  if (samples.length === 0) return null;
  const sorted = [...samples].sort((a, b) => a - b);
  const runs = sorted.length;
  const total = sorted.reduce((sum, value) => sum + value, 0);
  const mean = total / runs;

  const mid = Math.floor(runs / 2);
  const median =
    runs % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;

  // Nearest-rank p95: index = ceil(0.95 * n) - 1, clamped into range.
  const rank = Math.ceil(0.95 * runs) - 1;
  const p95 = sorted[Math.max(0, Math.min(runs - 1, rank))]!;

  const variance =
    sorted.reduce((sum, value) => sum + (value - mean) ** 2, 0) / runs;
  const stdev = Math.sqrt(variance);

  return {
    runs,
    min: sorted[0]!,
    max: sorted[runs - 1]!,
    mean,
    median,
    p95,
    stdev,
    total,
  };
}

/**
 * Execute `code` `iterations` times (after `warmup` discarded runs) and
 * return aggregate stats. Aborts on the first run that errors.
 */
export async function runBenchmark(args: RunBenchmarkArgs): Promise<BenchmarkResult> {
  const iterations = clampIterations(args.iterations);
  const warmup = Math.max(0, Math.min(20, Math.floor(args.warmup ?? BENCHMARK_DEFAULT_WARMUP)));

  const execute = () =>
    runnerManager.execute(
      args.language,
      args.code,
      {
        language: args.language,
        ...(args.timeout !== undefined ? { timeout: args.timeout } : {}),
      },
      args.runtimeMode
    );

  // Warmup — discard results, but a warmup error still aborts because it
  // means the code cannot run at all.
  for (let i = 0; i < warmup; i += 1) {
    const result = await execute();
    if (result.error) {
      return { ok: false, reason: 'run-error', message: result.error.message };
    }
  }

  const samples: number[] = [];
  for (let i = 0; i < iterations; i += 1) {
    const result = await execute();
    if (result.error) {
      return { ok: false, reason: 'run-error', message: result.error.message };
    }
    samples.push(result.executionTime);
    args.onProgress?.(i + 1, iterations);
  }

  const stats = computeBenchmarkStats(samples);
  if (!stats) {
    return { ok: false, reason: 'no-samples' };
  }
  return { ok: true, stats, samples };
}
