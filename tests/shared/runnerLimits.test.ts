import { describe, expect, it } from 'vitest';
import {
  MAX_COMPILE_OUTPUT_BYTES,
  MAX_GO_WASM_BYTES,
  MAX_NATIVE_STDERR_BYTES,
  truncateBytes,
} from '../../src/shared/runnerLimits';

describe('truncateBytes', () => {
  const MARKER = '\n[truncated]';

  it('returns the input unchanged when it fits', () => {
    expect(truncateBytes('short', 100, MARKER)).toBe('short');
  });

  it('returns the input unchanged at the exact boundary', () => {
    const value = 'x'.repeat(64);
    expect(truncateBytes(value, 64, MARKER)).toBe(value);
  });

  it('clips and appends the marker so total length equals maxBytes', () => {
    const value = 'a'.repeat(100);
    const result = truncateBytes(value, 50, MARKER);
    expect(result).toBe('a'.repeat(50 - MARKER.length) + MARKER);
    expect(result.length).toBe(50);
  });

  it('always emits at least one source character before the marker', () => {
    // Documented contract: when maxBytes leaves no room for the marker,
    // the marker is still appended in full after >= 1 source char, so
    // the output may exceed maxBytes but the truncation is unambiguous.
    const result = truncateBytes('abcdef', 3, MARKER);
    expect(result).toBe('a' + MARKER);
  });

  it('measures UTF-16 code units, matching String.prototype.length', () => {
    // '😀' is one code point but two UTF-16 code units. The contract is
    // deliberately code-unit based (see the doc comment) — pin it so a
    // future byte-accurate rewrite is a conscious decision.
    const value = '😀'.repeat(10); // length 20
    expect(truncateBytes(value, 20, MARKER)).toBe(value);
    const clipped = truncateBytes(value, 19, MARKER);
    expect(clipped.endsWith(MARKER)).toBe(true);
    expect(clipped.length).toBe(19);
  });

  it('keeps the main-process caps on their RL-079 deliberate values', () => {
    // 1 MiB subprocess caps and the 10 MiB Go WASM ceiling are
    // user-facing decisions; homogenizing them with the tighter
    // renderer-side caps requires updating both surfaces in lockstep.
    expect(MAX_NATIVE_STDERR_BYTES).toBe(1024 * 1024);
    expect(MAX_COMPILE_OUTPUT_BYTES).toBe(1024 * 1024);
    expect(MAX_GO_WASM_BYTES).toBe(10 * 1024 * 1024);
  });
});
