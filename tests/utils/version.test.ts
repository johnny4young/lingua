/**
 * RL-061 Slice 5 — pin the renderer-side semver helper.
 *
 * Mirrors `update-server/src/version.ts`. Both helpers share their
 * shape on purpose — the worker emits the latest tag and the
 * renderer compares against the build-time pin; if either side
 * disagrees on what "newer" means, the banner either misfires or
 * stays silent when it shouldn't.
 */

import { describe, expect, it } from 'vitest';
import { isVersionNewer, parseVersion } from '../../src/renderer/utils/version';

describe('parseVersion', () => {
  it.each([
    ['0.2.1', [0, 2, 1]],
    ['v0.2.1', [0, 2, 1]],
    ['1.0.0', [1, 0, 0]],
    ['10.20.30', [10, 20, 30]],
  ])('parses %s into a 3-tuple', (input, expected) => {
    expect(parseVersion(input)).toEqual(expected);
  });

  it.each([
    'invalid',
    '0.2',
    '0.2.',
    '01.2.3',
    '1e2.0.0',
    '0x1.0.0',
    '0.2.1.4',
    '',
    'v',
    '0.2.x',
    '-1.0.0',
    'v0.2.1-rc.1', // prereleases unsupported by intent
  ])('returns null for malformed: %s', (input) => {
    expect(parseVersion(input)).toBeNull();
  });

  it('returns null on non-string inputs (defensive)', () => {
    expect(parseVersion(null as unknown as string)).toBeNull();
    expect(parseVersion(undefined as unknown as string)).toBeNull();
    expect(parseVersion(42 as unknown as string)).toBeNull();
  });
});

describe('isVersionNewer', () => {
  it.each([
    ['0.2.1', '0.2.0', true],
    ['0.2.0', '0.2.0', false],
    ['0.2.0', '0.2.1', false],
    ['1.0.0', '0.99.99', true],
    ['v0.4.0', 'v0.3.999', true],
    // Equal tags with mixed prefixes are still equal.
    ['v0.2.0', '0.2.0', false],
  ])('isVersionNewer(%s, %s) === %s', (latest, current, expected) => {
    expect(isVersionNewer(latest, current)).toBe(expected);
  });

  it('returns false when either side is malformed (conservative — banner stays hidden)', () => {
    expect(isVersionNewer('garbage', '0.2.0')).toBe(false);
    expect(isVersionNewer('0.2.1', 'garbage')).toBe(false);
    expect(isVersionNewer('garbage', 'garbage')).toBe(false);
  });
});
