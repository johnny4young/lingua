// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { assertionValues } from '../../src/main/projectTestAssertions';

describe('assertionValues', () => {
  it.each([
    ['Vitest', 'jest', 'AssertionError: expected 1211 to be 1210.5 // Object.is equality', '1211', '1210.5'],
    ['Vitest deep', 'jest', 'AssertionError: expected [ 1, 2 ] to deeply equal [ 1, 3 ]', '[ 1, 2 ]', '[ 1, 3 ]'],
    ['Jest', 'jest', 'Error: expect(received).toBe(expected) // Object.is equality\n\nExpected: 1210.5\nReceived: 1211', '1211', '1210.5'],
    ['pytest', 'pytest', 'assert 1211 == 1210.5', '1211', '1210.5'],
    ['pytest with the exception name', 'pytest', 'AssertionError: assert 1211 == 1210.5', '1211', '1210.5'],
    ['Cargo', 'cargo', 'assertion `left == right` failed: rounding\n  left: 4\n right: 5', '4', '5'],
    ['Go', 'go', 'total_test.go:9: expected 1210.5 but got 1000.42', '1000.42', '1210.5'],
    ['Go got/want', 'go', 'total_test.go:9: got 3, want 4', '3', '4'],
    ['testify', 'go', 'Error:      \tNot equal: \n\t\t\texpected: 1210.5\n\t\t\tactual  : 1211', '1211', '1210.5'],
  ] as const)('reads expected and received from %s', (_runner, family, message, received, expected) => {
    expect(assertionValues(family, message)).toEqual({ received, expected });
  });

  it('reads nothing when the message has no comparison or belongs to another runner', () => {
    expect(assertionValues('go', 'total_test.go:15: two failed')).toBeNull();
    expect(assertionValues('jest', 'AssertionError: expected 3 to not be 3')).toBeNull();
    expect(assertionValues('jest', 'AssertionError: expected 3 to be a string')).toBeNull();
    expect(assertionValues('jest', 'assert 1211 == 1210.5')).toBeNull();
    expect(assertionValues('cargo', 'Expected: 1\nReceived: 2')).toBeNull();
    expect(assertionValues('pytest', undefined)).toBeNull();
  });

  it('clips long values', () => {
    const values = assertionValues('pytest', `assert ${'x'.repeat(300)} == 1`)!;
    expect(values.received).toHaveLength(120);
    expect(values.received.endsWith('…')).toBe(true);
  });
});
