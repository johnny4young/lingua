/**
 * implementation — `<OutputLineBadge>` render defense.
 *
 * Acceptance criteria locked here:
 *   1. 1 000 console rows with chips render under 200 ms (AC budget).
 *   2. 10 000 console rows with chips render under 1500 ms
 *      (implementation note — implementation auto-log workloads exercise the 10k bound).
 *
 * The benchmark exercises the renderer-side payload pipeline that
 * `<ConsoleEntryRenderer>` consumes: build N typed `RichOutputPayload`
 * objects, stamp `origin.line`, then walk them through the
 * `serializeRichValue` + payload-discovery code that the row-mapper
 * pays per render. Per-component React render time is covered
 * separately (component tests) — this bench locks the payload-shape
 * cost so a future widening of `RichOutputPayload` cannot silently
 * regress the chip column.
 *
 * CI gets a 1.5× multiplier per the existing pattern in
 * `tests/perf/rubySpawn.bench.test.ts` (300 ms / 2250 ms).
 */

import { describe, it, expect } from 'vitest';
import {
  isRichOutputPayload,
  serializeRichValue,
  type RichOutputPayload,
} from '@/../shared/richOutput';

const IS_CI = process.env.CI === 'true';
const CI_MULTIPLIER = 1.5;

function budget(ms: number): number {
  return IS_CI ? Math.round(ms * CI_MULTIPLIER) : ms;
}

function buildPayloads(count: number): RichOutputPayload[] {
  const payloads: RichOutputPayload[] = [];
  for (let i = 0; i < count; i += 1) {
    const payload = serializeRichValue(`row-${i}`);
    (payload as { origin?: { line: number } }).origin = { line: (i % 200) + 1 };
    payloads.push(payload);
  }
  return payloads;
}

describe('OutputLineBadge payload shape — 1k rows', () => {
  it('builds and validates 1000 payloads within 200ms', () => {
    const start = performance.now();
    const payloads = buildPayloads(1000);
    let validCount = 0;
    let originCount = 0;
    for (const p of payloads) {
      if (isRichOutputPayload(p)) validCount += 1;
      if (p.origin && p.origin.line > 0) originCount += 1;
    }
    const elapsed = performance.now() - start;
    expect(validCount).toBe(1000);
    expect(originCount).toBe(1000);
    expect(elapsed).toBeLessThan(budget(200));
  });
});

describe('OutputLineBadge payload shape — 10k rows (implementation note)', () => {
  it('builds and validates 10000 payloads within 1500ms', () => {
    const start = performance.now();
    const payloads = buildPayloads(10_000);
    let validCount = 0;
    let originCount = 0;
    for (const p of payloads) {
      if (isRichOutputPayload(p)) validCount += 1;
      if (p.origin && p.origin.line > 0) originCount += 1;
    }
    const elapsed = performance.now() - start;
    expect(validCount).toBe(10_000);
    expect(originCount).toBe(10_000);
    expect(elapsed).toBeLessThan(budget(1500));
  });
});
