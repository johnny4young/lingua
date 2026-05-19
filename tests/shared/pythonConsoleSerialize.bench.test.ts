/**
 * RL-044 Slice 1C fold G — renderer-side Python console-payload
 * processing budget. Mirrors the JS Slice 1B fold G bench
 * (`consoleRich.bench.test.ts`), but on the path the Python runner
 * actually exercises: a flooded Pyodide `print(...)` loop produces a
 * thousand-entry `print_entries` array, the renderer maps each entry
 * through `richKindBucket` (telemetry dispatch) + payload-aware
 * dedup (`entriesAreEqual`-style JSON.stringify on the rich
 * payloads).
 *
 * Sizing: a 1 000-print scratchpad run is a realistic ceiling — a
 * pandas head() with a tight loop is the worst-case workload Python
 * users hit. Budget 750 ms wall clock locks the per-entry cost at
 * ~750 µs, leaving headroom for shared CI runner contention.
 *
 * Failing this bench is the signal that someone wired a heavier
 * per-entry walk (e.g. memoising the renderer payload-format) into
 * the dispatch's hot path without measuring.
 */

import { describe, it, expect } from 'vitest';
import type { RichOutputPayload } from '#src/shared/richOutput';
import { richKindBucket } from '#src/renderer/components/Console/richConsoleFormat';

function makePrintEntry(index: number): {
  text: string;
  method: 'log' | 'error';
  payloads: RichOutputPayload[];
} {
  // Mix of payload kinds matching what the Python preamble actually
  // emits — object / table / primitive / set / date — to exercise
  // every branch of `richKindBucket`.
  const payloads: RichOutputPayload[] = [
    {
      kind: 'object',
      previewType: 'dict',
      entries: [
        { key: 'name', value: { kind: 'primitive', type: 'string', repr: `"user-${index}"` } },
        { key: 'age', value: { kind: 'primitive', type: 'number', repr: String(20 + index) } },
      ],
    },
    {
      kind: 'table',
      columns: ['name', 'age'],
      rows: [
        [
          { kind: 'primitive', type: 'string', repr: '"alice"' },
          { kind: 'primitive', type: 'number', repr: '30' },
        ],
      ],
    },
    { kind: 'primitive', type: 'string', repr: `"text-${index}"` },
    {
      kind: 'set',
      size: 3,
      entries: [
        { kind: 'primitive', type: 'number', repr: '1' },
        { kind: 'primitive', type: 'number', repr: '2' },
        { kind: 'primitive', type: 'number', repr: '3' },
      ],
    },
    { kind: 'date', iso: '2026-05-19T10:52:47.000Z' },
  ];
  return { text: `entry-${index}\n`, method: 'log', payloads };
}

describe('python console payload bench — 1 000 entries / 750 ms budget', () => {
  it('processes 1 000 Python print entries well under 750 ms', () => {
    const entries = Array.from({ length: 1_000 }, (_, idx) => makePrintEntry(idx));

    // Warm-up — let V8 inline the bucket dispatch before measuring.
    for (let i = 0; i < 50; i++) {
      for (const entry of entries.slice(0, 10)) {
        for (const payload of entry.payloads) {
          richKindBucket(payload);
        }
      }
    }

    const now = () =>
      typeof performance !== 'undefined' && performance.now
        ? performance.now()
        : Date.now();

    const startMs = now();
    let lastBucket = '';
    for (const entry of entries) {
      // Mirror the renderer-side hot path: bucket every payload (one
      // telemetry emit per payload index) AND JSON.stringify the
      // payload row for the consecutive-entry collapse equality check.
      for (const payload of entry.payloads) {
        lastBucket = richKindBucket(payload);
      }
      JSON.stringify(entry.payloads);
    }
    const elapsedMs = now() - startMs;

    expect(lastBucket.length).toBeGreaterThan(0);
    expect(elapsedMs).toBeLessThan(750);
  });
});
