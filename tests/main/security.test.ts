import { describe, expect, it } from 'vitest';
import {
  getTrustedRendererUrl,
  isAllowedNavigationTarget,
  isTrustedRendererUrl,
} from '../../src/main/security';

describe('main security helpers', () => {
  it('allows loopback renderer URLs only', () => {
    expect(isTrustedRendererUrl('http://localhost:5174/')).toBe(true);
    expect(isTrustedRendererUrl('http://127.0.0.1:4173/')).toBe(true);
    expect(isTrustedRendererUrl('https://example.com')).toBe(false);
    expect(isTrustedRendererUrl('javascript:alert(1)')).toBe(false);
  });

  it('returns null for untrusted renderer URLs', () => {
    expect(getTrustedRendererUrl('https://example.com')).toBeNull();
    expect(getTrustedRendererUrl('http://localhost:5174/')).toBe('http://localhost:5174/');
  });

  it('only allows same-origin navigation for trusted renderer URLs', () => {
    const trusted = 'http://localhost:5174/';
    expect(isAllowedNavigationTarget('http://localhost:5174/settings', trusted)).toBe(
      true
    );
    expect(isAllowedNavigationTarget('http://127.0.0.1:5174/', trusted)).toBe(false);
    expect(isAllowedNavigationTarget('https://example.com', trusted)).toBe(false);
  });

  it('allows file navigation only when using the packaged file renderer', () => {
    expect(isAllowedNavigationTarget('file:///tmp/index.html', null)).toBe(true);
    expect(
      isAllowedNavigationTarget('file:///tmp/index.html', 'http://localhost:5174/')
    ).toBe(false);
  });
});
