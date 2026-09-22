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

  it('allows only the chosen renderer document and its fragments', () => {
    const trusted = 'http://localhost:5174/';
    expect(isAllowedNavigationTarget(trusted, trusted)).toBe(true);
    expect(isAllowedNavigationTarget(`${trusted}#settings`, trusted)).toBe(true);
    expect(isAllowedNavigationTarget('http://localhost:5174/settings', trusted)).toBe(false);
    expect(isAllowedNavigationTarget('http://localhost:5174/?raw', trusted)).toBe(false);
    expect(isAllowedNavigationTarget('http://127.0.0.1:5174/', trusted)).toBe(false);
    expect(isAllowedNavigationTarget('https://example.com', trusted)).toBe(false);
  });

  it('does not treat the file scheme as authority to open any local document', () => {
    expect(isAllowedNavigationTarget('file:///tmp/index.html', null)).toBe(false);
    const packaged =
      'file:///Applications/Lingua.app/Contents/Resources/app.asar/renderer/index.html';
    expect(isAllowedNavigationTarget(packaged, packaged)).toBe(true);
    expect(isAllowedNavigationTarget(`${packaged}#tab`, packaged)).toBe(true);
    expect(isAllowedNavigationTarget('file:///tmp/index.html', packaged)).toBe(false);
    expect(isAllowedNavigationTarget(`${packaged}?raw`, packaged)).toBe(false);
  });

  it.each(['file:///C:/Lingua%20App/index.html', 'file://trusted-share/Lingua/index.html'])(
    'preserves the exact trusted packaged location %s',
    document => {
      expect(isAllowedNavigationTarget(document, document)).toBe(true);
      expect(isAllowedNavigationTarget(`${document}#tab`, document)).toBe(true);
      expect(
        isAllowedNavigationTarget(document.replace('index.html', 'other.html'), document)
      ).toBe(false);
    }
  );

  it.each([
    'javascript:alert(1)',
    'data:text/html,hello',
    'about:blank',
    'http://user:password@localhost:5174/',
    'http://localhost:5175/',
    'file://remote/share/index.html',
    'not a URL',
  ])('rejects unrelated or credential-bearing targets: %s', target => {
    expect(isAllowedNavigationTarget(target, 'http://localhost:5174/')).toBe(false);
  });
});
