import { describe, expect, it } from 'vitest';
import {
  BENCHMARK_MAX_ITERATIONS,
  clampIterations,
  computeBenchmarkStats,
} from '@/runtime/benchmarkRun';

describe('clampIterations', () => {
  it('clamps below the minimum up to 1', () => {
    expect(clampIterations(0)).toBe(1);
    expect(clampIterations(-10)).toBe(1);
  });

  it('clamps above the maximum down to the ceiling', () => {
    expect(clampIterations(BENCHMARK_MAX_ITERATIONS + 100)).toBe(BENCHMARK_MAX_ITERATIONS);
  });

  it('floors fractional counts', () => {
    expect(clampIterations(12.9)).toBe(12);
  });

  it('falls back to the default for non-finite input', () => {
    expect(clampIterations(Number.NaN)).toBe(20);
  });
});

describe('computeBenchmarkStats', () => {
  it('returns null for an empty sample set', () => {
    expect(computeBenchmarkStats([])).toBeNull();
  });

  it('computes exact stats for a known sample', () => {
    const stats = computeBenchmarkStats([2, 4, 4, 4, 5, 5, 7, 9]);
    expect(stats).not.toBeNull();
    expect(stats!.runs).toBe(8);
    expect(stats!.min).toBe(2);
    expect(stats!.max).toBe(9);
    expect(stats!.total).toBe(40);
    expect(stats!.mean).toBe(5);
    // Even count → average of the two middle values (4 and 5).
    expect(stats!.median).toBe(4.5);
    // Population stdev of this classic sample is 2.
    expect(stats!.stdev).toBeCloseTo(2, 6);
  });

  it('computes median for an odd-length sample', () => {
    const stats = computeBenchmarkStats([10, 30, 20]);
    expect(stats!.median).toBe(20);
    expect(stats!.min).toBe(10);
    expect(stats!.max).toBe(30);
  });

  it('uses nearest-rank for p95', () => {
    const samples = Array.from({ length: 100 }, (_, i) => i + 1); // 1..100
    const stats = computeBenchmarkStats(samples);
    // ceil(0.95 * 100) - 1 = 94 → sorted[94] = 95.
    expect(stats!.p95).toBe(95);
  });

  it('is order-independent', () => {
    const a = computeBenchmarkStats([1, 2, 3, 4, 5]);
    const b = computeBenchmarkStats([5, 3, 1, 4, 2]);
    expect(a).toEqual(b);
  });
});
