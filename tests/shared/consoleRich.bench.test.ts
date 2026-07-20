/**
 * implementation note — rich console output performance defense.
 *
 * Sizing rationale: a flooded scratchpad emits up to ~1 k console
 * entries before the user reads them. We bench `serializeRichValue`
 * + `richKindBucket` against the worker-equivalent path 1 000 times
 * with a moderately-deep object payload and a table payload — a
 * regression to "let's recurse without the depth cap" would push the
 * per-entry cost from microseconds into milliseconds and stall
 * Settings → Editor's user-driven typing on hot loops.
 *
 * Budget: 750 ms wall clock for 1 000 iterations (~750 µs / entry).
 * Mirrors implementation note's auto-log detector lock (5 000
 * iter / 750 ms) — same wall-clock budget, fewer iterations because
 * the per-entry work is heavier (a real Map / nested object walk).
 */

import { describe, it, expect } from 'vitest';
import { serializeRichValue } from '#src/shared/richOutput';
import { richKindBucket } from '#src/renderer/components/Console/richConsoleFormat';

function makeFixtureValue(): unknown {
  // Mix of payload kinds that exercise every serializer branch:
  // - nested plain object
  // - Map
  // - array of objects (auto-table)
  // - Date
  // - Promise
  const map = new Map<string, unknown>();
  for (let i = 0; i < 20; i++) {
    map.set(`k${i}`, { idx: i, label: `lbl-${i}`, nested: [1, 2, 3] });
  }
  const rows: Array<Record<string, unknown>> = [];
  for (let i = 0; i < 30; i++) {
    rows.push({ name: `row-${i}`, age: 20 + i, active: i % 2 === 0 });
  }
  return {
    settings: { theme: 'dark', fontSize: 14, layout: 'horizontal' },
    counts: { items: 5_000, errors: 0, warnings: 3 },
    map,
    table: rows,
    when: new Date(),
    promise: Promise.resolve('value'),
  };
}

describe('consoleRich bench — 1 000 iterations / 750 ms budget', () => {
  it('serializeRichValue + richKindBucket complete 1 000 entries well under 750 ms', () => {
    const fixture = makeFixtureValue();
    // Warm-up — let V8 inline before measuring.
    for (let i = 0; i < 25; i++) {
      const payload = serializeRichValue(fixture);
      richKindBucket(payload);
    }

    const now = () =>
      typeof performance !== 'undefined' && performance.now
        ? performance.now()
        : Date.now();

    const startMs = now();
    let lastBucket = '';
    for (let i = 0; i < 1_000; i++) {
      const payload = serializeRichValue(fixture);
      lastBucket = richKindBucket(payload);
    }
    const elapsedMs = now() - startMs;

    expect(lastBucket.length).toBeGreaterThan(0);
    expect(elapsedMs).toBeLessThan(750);
  });
});
