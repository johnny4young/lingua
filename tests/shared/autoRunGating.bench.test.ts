/**
 * RL-020 Slice 1 fold F — auto-run gating performance defense.
 *
 * The gate runs on every debounced auto-run keystroke. A regression
 * to "let's just call the TS worker / Monaco diagnostics" would push
 * the per-call cost from microseconds into milliseconds and turn
 * auto-run into a janky surface. This bench locks the contract: a
 * pure string scan stays under a hard ceiling for a buffer shape that
 * exercises every scanner branch.
 *
 * Sizing rationale: a typical Lingua scratchpad tab body is 1–5 KB.
 * We bench at 5 KB × 5 000 iterations — that simulates ~70 minutes of
 * sustained typing (one auto-run candidate per 0.8 s) compressed
 * into a single test run. The budget is 750 ms CPU time (~150 µs /
 * call), still orders of magnitude under the 1.2 s auto-run debounce
 * while leaving room for Vitest's full-suite CPU contention. A flake
 * here is the signal that someone wired a Monaco / TS-worker
 * round-trip into the gate's hot path.
 */

import { describe, it, expect } from 'vitest';
import { isLikelyComplete } from '#src/shared/autoRunGating';

function createElapsedTimer(): () => number {
  if (typeof process !== 'undefined' && typeof process.cpuUsage === 'function') {
    const start = process.cpuUsage();
    return () => {
      const elapsed = process.cpuUsage(start);
      return (elapsed.user + elapsed.system) / 1_000;
    };
  }

  const now = () =>
    typeof performance !== 'undefined' && performance.now
      ? performance.now()
      : Date.now();
  const startMs = now();
  return () => now() - startMs;
}

function buildBuffer(minBytes: number): string {
  // Repeat a realistic JS sample until we cross the byte target.
  // Mix of declarations, template literals, comments, and bracket
  // groupings exercises every branch of the scanner. We never slice
  // the result — splitting mid-statement would leave the buffer
  // unbalanced and the gate would correctly report `incomplete`,
  // confusing the test assertion.
  const sample = [
    '// Generated benchmark fixture — RL-020 Slice 1 fold F.',
    'const items = [1, 2, 3, 4, 5].map((n) => n * n);',
    'const greet = (name) => `hello ${name}, ${items.length} items`;',
    'function compute(a, b) {',
    '  /* multi-line comment',
    '     spanning lines */',
    '  const out = { a, b, sum: a + b };',
    '  return out;',
    '}',
    "console.log(greet('world'), compute(1, 2));",
    '',
  ].join('\n');
  let buffer = '';
  while (buffer.length < minBytes) buffer += sample;
  return buffer;
}

describe('autoRunGating bench — 5 KB / 5 000 iterations', () => {
  it('completes 5 000 calls in well under 750 ms (~150 µs / call ceiling)', () => {
    const buffer = buildBuffer(5_000);
    // Warm-up — let V8 inline before measuring.
    for (let i = 0; i < 100; i++) isLikelyComplete('javascript', buffer);

    const elapsed = createElapsedTimer();
    let last = { ready: true, reason: 'ok' as const };
    for (let i = 0; i < 5_000; i++) {
      last = isLikelyComplete('javascript', buffer);
    }
    const elapsedMs = elapsed();

    // The sample buffer always ends on a blank line, so the gate
    // should clear.
    expect(last.ready).toBe(true);
    // Hard CPU-time budget. 750 ms x 5000 calls = 150 us / call,
    // comfortably under the perceptible threshold and with enough
    // headroom that shared CI runners do not fail from contention.
    expect(elapsedMs).toBeLessThan(750);
  });
});
