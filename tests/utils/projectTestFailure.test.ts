import { describe, expect, it } from 'vitest';
import { summarizeProjectTestFailure } from '../../src/renderer/utils/projectTestFailure';

describe('summarizeProjectTestFailure', () => {
  it.each([
    ['Vitest', 'AssertionError: expected 1211 to be 1210.5 // Object.is equality', 'expected 1211 to be 1210.5 // Object.is equality', '1211', '1210.5'],
    ['Vitest deep', "AssertionError: expected [ 1, 2 ] to deeply equal [ 1, 3 ]", 'expected [ 1, 2 ] to deeply equal [ 1, 3 ]', '[ 1, 2 ]', '[ 1, 3 ]'],
    ['Jest', 'Error: expect(received).toBe(expected) // Object.is equality\n\nExpected: 1210.5\nReceived: 1211', 'expect(received).toBe(expected) // Object.is equality', '1211', '1210.5'],
    ['pytest', 'assert 1211 == 1210.5', 'assert 1211 == 1210.5', '1211', '1210.5'],
    ['Cargo', 'assertion `left == right` failed: rounding\n  left: 4\n right: 5', 'assertion `left == right` failed: rounding', '4', '5'],
    ['Go', 'total_test.go:9: expected 1210.5 but got 1000.42', 'expected 1210.5 but got 1000.42', '1000.42', '1210.5'],
    ['Go got/want', 'total_test.go:9: got 3, want 4', 'got 3, want 4', '3', '4'],
    ['testify', 'Error:      \tNot equal: \n\t\t\texpected: 1210.5\n\t\t\tactual  : 1211', 'Not equal:', '1211', '1210.5'],
  ])('reads expected and received from %s', (_runner, message, headline, received, expected) => {
    expect(summarizeProjectTestFailure(message)).toEqual({ headline, received, expected });
  });

  it('keeps only the headline when the runner gives no comparison', () => {
    expect(summarizeProjectTestFailure('total_test.go:15: two failed')).toEqual({ headline: 'two failed' });
    expect(summarizeProjectTestFailure('AssertionError: expected 3 to not be 3')).toEqual({ headline: 'expected 3 to not be 3' });
    expect(summarizeProjectTestFailure('AssertionError: expected 3 to be a string')).toEqual({ headline: 'expected 3 to be a string' });
  });

  it('returns null without a message and clips long values', () => {
    expect(summarizeProjectTestFailure(undefined)).toBeNull();
    expect(summarizeProjectTestFailure('  \n ')).toBeNull();
    const long = 'x'.repeat(300);
    const summary = summarizeProjectTestFailure(`assert ${long} == 1`)!;
    expect(summary.received).toHaveLength(120);
    expect(summary.received!.endsWith('…')).toBe(true);
  });
});
