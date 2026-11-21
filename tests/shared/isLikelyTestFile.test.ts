import { describe, expect, it } from 'vitest';
import { isLikelyTestFile } from '../../src/shared/projectTests';

describe('isLikelyTestFile', () => {
  it.each([
    ['src/sum.test.ts', true],
    ['src/App.spec.tsx', true],
    ['lib/util.test.mjs', true],
    ['pkg/sum_test.go', true],
    ['tests/test_sum.py', true],
    ['tests/sum_test.py', true],
    ['src/sum.ts', false],
    ['src/testing/helpers.ts', false],
    ['test_dir/sum.py', false],
  ])('%s → %s', (path, expected) => {
    expect(isLikelyTestFile(path)).toBe(expected);
  });
});
