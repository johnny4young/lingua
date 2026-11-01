import { describe, expect, it } from 'vitest';
import { normalizeExternalUrl } from '../../src/shared/appInfo';

describe('normalizeExternalUrl', () => {
  it('opens only plain http and https URLs', () => {
    expect(normalizeExternalUrl('https://lingua.dev/docs')).toBe('https://lingua.dev/docs');
    expect(normalizeExternalUrl('  http://lingua.dev  ')).toBe('http://lingua.dev/');
    expect(normalizeExternalUrl('javascript:alert(1)')).toBeNull();
    expect(normalizeExternalUrl('file:///etc/passwd')).toBeNull();
    expect(normalizeExternalUrl('https://accounts.google.com@evil.com/')).toBeNull();
    expect(normalizeExternalUrl('https://user:pass@lingua.dev/')).toBeNull();
    expect(normalizeExternalUrl(42)).toBeNull();
    expect(normalizeExternalUrl('')).toBeNull();
  });
});
