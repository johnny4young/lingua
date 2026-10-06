import { describe, expect, it } from 'vitest';
import {
  MAX_COMPILE_OUTPUT_BYTES,
  MAX_GO_WASM_BYTES,
  MAX_NATIVE_STDERR_BYTES,
} from '../../src/shared/runnerLimits';

describe('runner limits', () => {
  it('keeps the main-process caps on their deliberate values', () => {
    // 1 MiB subprocess caps and the 10 MiB Go WASM ceiling are
    // user-facing decisions; homogenizing them with the tighter
    // renderer-side caps requires updating both surfaces in lockstep.
    expect(MAX_NATIVE_STDERR_BYTES).toBe(1024 * 1024);
    expect(MAX_COMPILE_OUTPUT_BYTES).toBe(1024 * 1024);
    expect(MAX_GO_WASM_BYTES).toBe(10 * 1024 * 1024);
  });
});
