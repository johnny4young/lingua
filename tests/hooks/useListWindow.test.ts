/**
 * implementation detail implementation — pure windowing math.
 *
 * `computeWindow` and `offsetForIndex` are the only non-trivial parts of the
 * windower, and jsdom cannot measure layout, so they are extracted as pure
 * functions and exhaustively tested here. The React hook (`useListWindow`)
 * is exercised end-to-end by `tests/e2e/consoleWindowing.spec.ts` (console)
 * and `tests/e2e/notebook.spec.ts` (notebook rows, implementation) in real
 * Chromium.
 */

import { describe, it, expect } from 'vitest';
import {
  computeWindow,
  offsetForIndex,
} from '../../src/renderer/hooks/useListWindow';

const BASE = { overscanPx: 0, estimate: 28 };

describe('computeWindow ', () => {
  it('returns an empty window for an empty list', () => {
    expect(
      computeWindow({ count: 0, heights: [], scrollTop: 0, viewportHeight: 300, ...BASE })
    ).toEqual({ startIndex: 0, endIndex: -1, topSpacer: 0, bottomSpacer: 0 });
  });

  it('degrades to the full list when the viewport has no height (jsdom)', () => {
    const heights = Array.from({ length: 50 }, () => 28);
    const result = computeWindow({
      count: 50,
      heights,
      scrollTop: 0,
      viewportHeight: 0,
      ...BASE,
    });
    expect(result).toEqual({ startIndex: 0, endIndex: 49, topSpacer: 0, bottomSpacer: 0 });
  });

  it('windows uniform rows scrolled into the middle of the list', () => {
    const heights = Array.from({ length: 100 }, () => 20);
    // viewport [scrollTop=400, height=100] => rows [20..24] (top edges 400..480)
    const result = computeWindow({
      count: 100,
      heights,
      scrollTop: 400,
      viewportHeight: 100,
      overscanPx: 0,
      estimate: 20,
    });
    expect(result.startIndex).toBe(20);
    expect(result.endIndex).toBe(24);
    expect(result.topSpacer).toBe(400);
    expect(result.bottomSpacer).toBe(100 * 20 - 25 * 20);
    // Geometry is conserved: spacers + windowed heights === total height.
    const windowed = (result.endIndex - result.startIndex + 1) * 20;
    expect(result.topSpacer + windowed + result.bottomSpacer).toBe(100 * 20);
  });

  it('extends the window by the overscan margin on both sides', () => {
    const heights = Array.from({ length: 100 }, () => 20);
    const tight = computeWindow({
      count: 100,
      heights,
      scrollTop: 400,
      viewportHeight: 100,
      overscanPx: 0,
      estimate: 20,
    });
    const loose = computeWindow({
      count: 100,
      heights,
      scrollTop: 400,
      viewportHeight: 100,
      overscanPx: 40,
      estimate: 20,
    });
    expect(loose.startIndex).toBeLessThan(tight.startIndex);
    expect(loose.endIndex).toBeGreaterThan(tight.endIndex);
  });

  it('honours variable row heights when slicing the window', () => {
    // Row 0 is tall (200px), the rest are 20px each.
    const heights = [200, ...Array.from({ length: 20 }, () => 20)];
    const result = computeWindow({
      count: 21,
      heights,
      scrollTop: 0,
      viewportHeight: 100,
      overscanPx: 0,
      estimate: 20,
    });
    // Only the tall row intersects [0,100].
    expect(result.startIndex).toBe(0);
    expect(result.endIndex).toBe(0);
    expect(result.topSpacer).toBe(0);
    expect(result.bottomSpacer).toBe(20 * 20);
  });

  it('falls back to the estimate for unmeasured rows', () => {
    const heights: Array<number | undefined> = Array.from({ length: 100 }, () => undefined);
    const result = computeWindow({
      count: 100,
      heights,
      scrollTop: 280,
      viewportHeight: 56,
      overscanPx: 0,
      estimate: 28,
    });
    // Estimate 28 => row 10 top edge at 280.
    expect(result.startIndex).toBe(10);
    expect(result.topSpacer).toBe(280);
    expect(result.topSpacer + (result.endIndex - result.startIndex + 1) * 28 + result.bottomSpacer).toBe(
      100 * 28
    );
  });

  it('keeps the windowed set small for a flooded 500-row console (implementation note)', () => {
    // implementation note — lock the windowing bound: a 500-row session must mount only a
    // viewport-sized slice, not all 500 rows.
    const heights = Array.from({ length: 500 }, () => 28);
    const result = computeWindow({
      count: 500,
      heights,
      scrollTop: 28 * 500, // pinned to bottom (auto-scroll)
      viewportHeight: 320,
      overscanPx: 600,
      estimate: 28,
    });
    const visible = result.endIndex - result.startIndex + 1;
    expect(visible).toBeLessThan(80);
    expect(result.endIndex).toBe(499);
    expect(result.topSpacer + visible * 28 + result.bottomSpacer).toBe(500 * 28);
  });

  it('clamps the window to the last row when scrolled past the end', () => {
    const heights = Array.from({ length: 10 }, () => 20);
    const result = computeWindow({
      count: 10,
      heights,
      scrollTop: 100_000,
      viewportHeight: 100,
      overscanPx: 0,
      estimate: 20,
    });
    expect(result.endIndex).toBe(9);
    expect(result.startIndex).toBeLessThanOrEqual(9);
    expect(result.bottomSpacer).toBe(0);
  });
});

describe('offsetForIndex ', () => {
  it('returns 0 for index 0 and for an empty list', () => {
    expect(offsetForIndex([], 0, 120)).toBe(0);
    expect(offsetForIndex([20, 20, 20], 0, 120)).toBe(0);
    // Empty list, any positive index still clamps to the (zero) total.
    expect(offsetForIndex([], 5, 120)).toBe(0);
  });

  it('sums measured heights for rows before the index', () => {
    const heights = [10, 20, 30, 40];
    expect(offsetForIndex(heights, 1, 120)).toBe(10);
    expect(offsetForIndex(heights, 2, 120)).toBe(30);
    expect(offsetForIndex(heights, 3, 120)).toBe(60);
  });

  it('falls back to the estimate for unmeasured rows', () => {
    const heights: Array<number | undefined> = [undefined, undefined, undefined];
    // Three unmeasured rows before index 3 => 3 * estimate.
    expect(offsetForIndex(heights, 3, 120)).toBe(360);
    expect(offsetForIndex(heights, 1, 120)).toBe(120);
  });

  it('mixes measured + estimated rows (estimate fills the gaps)', () => {
    // Row 0 measured (50), row 1 unmeasured (=> estimate 120), row 2
    // measured (30). Offset of row 3 = 50 + 120 + 30 = 200.
    const heights: Array<number | undefined> = [50, undefined, 30];
    expect(offsetForIndex(heights, 3, 120)).toBe(200);
    expect(offsetForIndex(heights, 2, 120)).toBe(170);
    expect(offsetForIndex(heights, 1, 120)).toBe(50);
  });

  it('treats a non-positive measured height as unmeasured (uses estimate)', () => {
    // A 0 / negative reading (content-visibility-skipped row) must not
    // collapse the offset; it falls back to the estimate like `undefined`.
    const heights: Array<number | undefined> = [0, -5, 40];
    expect(offsetForIndex(heights, 2, 120)).toBe(240);
    expect(offsetForIndex(heights, 3, 120)).toBe(280);
  });

  it('clamps an out-of-range index to the bounds', () => {
    const heights = [20, 30, 40];
    // Negative index => 0.
    expect(offsetForIndex(heights, -3, 120)).toBe(0);
    // Index past the end => total content height (the bottom edge).
    expect(offsetForIndex(heights, 99, 120)).toBe(90);
    // Exactly at length => total too.
    expect(offsetForIndex(heights, 3, 120)).toBe(90);
  });
});
