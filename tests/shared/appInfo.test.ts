import { describe, expect, it } from 'vitest';
import {
  canOpenExternalUrl,
  getBundledAppInfo,
  resolveLicenseType,
} from '../../src/shared/appInfo';
import pkg from '../../package.json';

describe('appInfo helpers', () => {
  it('returns bundled product metadata with repository-derived license url', () => {
    const info = getBundledAppInfo();

    expect(info.productName).toBe('Lingua');
    expect(info.version).toBe(pkg.version);
    // RL-062 flipped package.json to `SEE LICENSE IN LICENSE` so the About
    // panel shows a human-readable label instead of the raw SPDX expression.
    expect(info.licenseType).toBe('Commercial');
    expect(info.repositoryUrl).toBe('https://github.com/johnny4young/lingua');
    expect(info.licenseUrl).toBe('https://github.com/johnny4young/lingua/blob/main/LICENSE');
  });

  it('allows only safe http and https external urls', () => {
    expect(canOpenExternalUrl('https://github.com/johnny4young/lingua')).toBe(true);
    expect(canOpenExternalUrl('http://localhost:4173')).toBe(true);
    expect(canOpenExternalUrl('javascript:alert(1)')).toBe(false);
    expect(canOpenExternalUrl('file:///tmp/test')).toBe(false);
    expect(canOpenExternalUrl(null)).toBe(false);
    expect(canOpenExternalUrl({ href: 'https://github.com/johnny4young/lingua' })).toBe(false);
    expect(canOpenExternalUrl(['https://github.com/johnny4young/lingua'])).toBe(false);
  });

  it('resolveLicenseType maps SEE LICENSE / UNLICENSED expressions to Commercial', () => {
    expect(resolveLicenseType('SEE LICENSE IN LICENSE')).toBe('Commercial');
    expect(resolveLicenseType('see license in ./LICENSE.txt')).toBe('Commercial');
    expect(resolveLicenseType('UNLICENSED')).toBe('Commercial');
    expect(resolveLicenseType('MIT')).toBe('MIT');
    expect(resolveLicenseType('Apache-2.0')).toBe('Apache-2.0');
    expect(resolveLicenseType(undefined)).toBe('Unknown');
    expect(resolveLicenseType('   ')).toBe('Unknown');
  });
});
