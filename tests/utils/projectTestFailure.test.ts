import { describe, expect, it } from 'vitest';
import { projectTestFailureHeadline } from '../../src/renderer/utils/projectTestFailure';

describe('projectTestFailureHeadline', () => {
  it('drops the error class and a file:line prefix', () => {
    expect(projectTestFailureHeadline('AssertionError: expected 3 to not be 3')).toBe('expected 3 to not be 3');
    expect(projectTestFailureHeadline('total_test.go:15: two failed')).toBe('two failed');
    expect(projectTestFailureHeadline('\n  Error: expect(received).toBe(expected)\n\nExpected: 1')).toBe('expect(received).toBe(expected)');
  });

  it('returns null without a message and clips a long line', () => {
    expect(projectTestFailureHeadline(undefined)).toBeNull();
    expect(projectTestFailureHeadline('  \n ')).toBeNull();
    const headline = projectTestFailureHeadline('x'.repeat(300))!;
    expect(headline).toHaveLength(120);
    expect(headline.endsWith('…')).toBe(true);
  });
});
