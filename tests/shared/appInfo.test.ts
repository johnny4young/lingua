import { describe, expect, it } from 'vitest';
import { canOpenExternalUrl, getBundledAppInfo } from '../../src/shared/appInfo';

describe('appInfo helpers', () => {
  it('returns bundled product metadata with repository-derived license url', () => {
    const info = getBundledAppInfo();

    expect(info.productName).toBe('Lingua');
    expect(info.version).toBe('0.1.0');
    expect(info.licenseType).toBe('MIT');
    expect(info.repositoryUrl).toBe('https://github.com/johnny4young/lingua');
    expect(info.licenseUrl).toBe('https://github.com/johnny4young/lingua/blob/main/LICENSE');
  });

  it('allows only safe http and https external urls', () => {
    expect(canOpenExternalUrl('https://github.com/johnny4young/lingua')).toBe(true);
    expect(canOpenExternalUrl('http://localhost:4173')).toBe(true);
    expect(canOpenExternalUrl('javascript:alert(1)')).toBe(false);
    expect(canOpenExternalUrl('file:///tmp/test')).toBe(false);
  });
});
