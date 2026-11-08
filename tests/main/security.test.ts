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

  it('allows only the exact built renderer document on the app scheme', () => {
    const app = 'app://lingua/index.html';
    expect(isAllowedNavigationTarget(app, app)).toBe(true);
    expect(isAllowedNavigationTarget(`${app}#tab`, app)).toBe(true);
    expect(isAllowedNavigationTarget('app://lingua/other.html', app)).toBe(false);
    expect(isAllowedNavigationTarget(`${app}?raw`, app)).toBe(false);
    expect(isAllowedNavigationTarget('app://other/index.html', app)).toBe(false);
    expect(isAllowedNavigationTarget('file:///tmp/index.html', app)).toBe(false);
    expect(isAllowedNavigationTarget('http://localhost:5174/', app)).toBe(false);
  });

  it('gives a file document no navigation authority, not even to itself', () => {
    expect(isAllowedNavigationTarget('file:///tmp/index.html', null)).toBe(false);
    const legacy =
      'file:///Applications/Lingua.app/Contents/Resources/app.asar/renderer/index.html';
    expect(isAllowedNavigationTarget(legacy, legacy)).toBe(false);
    expect(isAllowedNavigationTarget(`${legacy}#tab`, legacy)).toBe(false);
  });

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
