/**
 * RL-123 / AUDIT-03 Slice 2 — pure windowing math.
 *
 * `computeWindow` is the only non-trivial part of the console windower, and
 * jsdom cannot measure layout, so it is extracted as a pure function and
 * exhaustively tested here. The React hook (`useListWindow`) is exercised
 * end-to-end by `tests/e2e/consoleWindowing.spec.ts` in real Chromium.
 */

import { describe, it, expect } from 'vitest';
import { computeWindow } from '../../../src/renderer/components/Console/useListWindow';

const BASE = { overscanPx: 0, estimate: 28 };

describe('computeWindow (RL-123 Slice 2)', () => {
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

  it('keeps the windowed set small for a flooded 500-row console (fold E)', () => {
    // Fold E — lock the windowing bound: a 500-row session must mount only a
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
