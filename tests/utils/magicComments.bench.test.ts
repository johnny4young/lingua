/**
 * RL-020 Slice 3 fold D — magic-comment parser performance defense.
 *
 * The detect/transform pass runs on every auto-run, debounced
 * keystroke. A regression to "let's compile the whole buffer to AST"
 * would push the per-call cost from microseconds into milliseconds
 * and turn the Scratchpad workflow into a janky surface.
 *
 * Sizing rationale: 5 KB realistic JS buffer with a mix of regular
 * lines, `//=>` arrows, and `// @watch` watches × 10 000 iterations.
 * Budget: 400 ms wall clock (~40 µs / call). Same shape as
 * `autoRunGating.bench.test.ts` (Slice 1 fold F), with extra
 * headroom because the magic-comment scanner also matches the
 * watch-shape regex which is materially slower per line.
 */

import { describe, it, expect } from 'vitest';
import {
  detectJSMagicComments,
  transformJSMagicComments,
} from '@/utils/magicComments';

function buildBuffer(minBytes: number): string {
  // Realistic mix: variable declarations, arrow + watch markers,
  // multi-line comments, template literals.
  const sample = [
    '// Generated benchmark fixture — RL-020 Slice 3 fold D.',
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

    const now = () =>
      typeof performance !== 'undefined' && performance.now
        ? performance.now()
        : Date.now();

    const startMs = now();
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
    const elapsedMs = now() - startMs;

    expect(lastLength).toBeGreaterThan(0);
    expect(elapsedMs).toBeLessThan(400);
  });
});
