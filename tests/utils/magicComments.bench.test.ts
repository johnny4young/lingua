/**
 * implementation note — magic-comment parser performance defense.
 *
 * The detect/transform pass runs on every auto-run, debounced
 * keystroke. A regression to "let's compile the whole buffer to AST"
 * would push the per-call cost from microseconds into milliseconds
 * and turn the Scratchpad workflow into a janky surface.
 *
 * Sizing rationale: 5 KB realistic JS buffer with a mix of regular
 * lines, `//=>` arrows, and `// @watch` watches × 10 000 iterations.
 * Budget: 400 ms CPU time (~40 µs / call). Same shape as
 * `autoRunGating.bench.test.ts` (implementation note), with extra
 * headroom because the magic-comment scanner also matches the
 * watch-shape regex which is materially slower per line.
 */

import { describe, it, expect } from 'vitest';
import {
  detectJSMagicComments,
  transformJSMagicComments,
  detectJSAutoLogLines,
  transformJSAutoLog,
} from '@/utils/magicComments';

const IS_CI = process.env.CI === 'true';
const CI_MULTIPLIER = 2;
const MAGIC_COMMENT_BUDGET_MS = IS_CI ? 400 * CI_MULTIPLIER : 400;
const AUTO_LOG_BUDGET_MS = IS_CI ? 750 * CI_MULTIPLIER : 750;

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
  // Realistic mix: variable declarations, arrow + watch markers,
  // multi-line comments, template literals.
  const sample = [
    '// Generated benchmark fixture — implementation note.',
    'const items = [1, 2, 3, 4, 5].map((n) => n * n);',
    'items.length //=> length',
    'const greet = (name) => `hello ${name}`;',
    'greet("world") // @watch greet("world")',
    'function compute(a, b) {',
    '  return { a, b, sum: a + b };',
    '}',
    'const acc = compute(1, 2); // @watch acc.sum',
    'console.log(items, acc);',
    '',
  ].join('\n');
  let buffer = '';
  while (buffer.length < minBytes) buffer += sample;
  return buffer;
}

describe('magicComments bench — 5 KB / 10 000 iterations', () => {
  it('detect + transform stay under 400 ms (~40 µs / call ceiling)', () => {
    const buffer = buildBuffer(5_000);

    // Warm-up so V8 inlines before measuring.
    for (let i = 0; i < 100; i++) {
      detectJSMagicComments(buffer);
      transformJSMagicComments(buffer);
    }

    const elapsed = createElapsedTimer();
    let lastLength = 0;
    for (let i = 0; i < 10_000; i++) {
      const detected = detectJSMagicComments(buffer);
      lastLength = detected.length;
      // Transform once every 100 iterations — exercise both paths
      // without doubling the work per loop.
      if (i % 100 === 0) {
        transformJSMagicComments(buffer);
      }
    }
    const elapsedMs = elapsed();

    expect(lastLength).toBeGreaterThan(0);
    expect(elapsedMs).toBeLessThan(MAGIC_COMMENT_BUDGET_MS);
  });
});

describe('implementation note — auto-log detector bench', () => {
  it('detect + transform stay under 750 ms across 5 000 iterations on a 5 KB buffer', () => {
    // Realistic mix: declarations, bare expressions, function
    // bodies, arrows, watches, multi-line objects. The detector
    // must walk the buffer once per call; transform only runs when
    // there are candidate lines, so we batch one transform per 100
    // detector calls (same shape as the implementation bench above).
    const sample = [
      'const xs = [1, 2, 3, 4, 5];',
      'xs.length',
      'function compute(a, b) {',
      '  return { a, b, sum: a + b };',
      '}',
      'const acc = compute(1, 2);',
      'acc.sum + xs.length',
      '// commentary',
      'const greet = (name) => `hello ${name}`;',
      'greet("world")',
      '',
    ].join('\n');
    let buffer = '';
    while (buffer.length < 5_000) buffer += sample;

    for (let i = 0; i < 100; i++) {
      const lines = detectJSAutoLogLines(buffer);
      transformJSAutoLog(buffer, lines);
    }

    const elapsed = createElapsedTimer();
    let lastCount = 0;
    for (let i = 0; i < 5_000; i++) {
      const lines = detectJSAutoLogLines(buffer);
      lastCount = lines.length;
      if (i % 100 === 0) {
        transformJSAutoLog(buffer, lines);
      }
    }
    const elapsedMs = elapsed();
    expect(lastCount).toBeGreaterThan(0);
    expect(elapsedMs).toBeLessThan(AUTO_LOG_BUDGET_MS);
  });
});
