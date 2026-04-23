import { describe, expect, it } from 'vitest';
import { isParsedUrl, parseUrl } from '@/utils/urlParser';

describe('parseUrl', () => {
  it('returns { error: "empty" } for empty or whitespace-only input', () => {
    expect(parseUrl('')).toEqual({ error: 'empty' });
    expect(parseUrl('   ')).toEqual({ error: 'empty' });
    expect(parseUrl('\t\n')).toEqual({ error: 'empty' });
  });

  it('returns { error: "invalid" } for strings the URL constructor rejects', () => {
    expect(parseUrl('not a url')).toEqual({ error: 'invalid' });
    expect(parseUrl('javascript')).toEqual({ error: 'invalid' });
    expect(parseUrl('http//missing-colon')).toEqual({ error: 'invalid' });
  });

  it('extracts every standard component from a canonical URL', () => {
    const result = parseUrl('https://user:pw@example.com:8443/p/q?a=1#section');
    expect(isParsedUrl(result)).toBe(true);
    if (!isParsedUrl(result)) return;
    expect(result.protocol).toBe('https:');
    expect(result.username).toBe('user');
    expect(result.password).toBe('pw');
    expect(result.hostname).toBe('example.com');
    expect(result.port).toBe('8443');
    expect(result.pathname).toBe('/p/q');
    expect(result.search).toBe('?a=1');
    expect(result.hash).toBe('#section');
    expect(result.origin).toBe('https://example.com:8443');
  });

  it('preserves query parameter order and duplicate keys', () => {
    const result = parseUrl('https://example.com/?tag=dev&tag=web&page=2');
    if (!isParsedUrl(result)) throw new Error('expected a parsed URL');
    expect(result.query).toEqual([
      { key: 'tag', value: 'dev' },
      { key: 'tag', value: 'web' },
      { key: 'page', value: '2' },
    ]);
  });

  it('returns an empty query list when the URL has no search component', () => {
    const result = parseUrl('https://example.com/path');
    if (!isParsedUrl(result)) throw new Error('expected a parsed URL');
    expect(result.query).toEqual([]);
    expect(result.search).toBe('');
  });

  it('trims leading and trailing whitespace before parsing', () => {
    const result = parseUrl('   https://example.com/   ');
    if (!isParsedUrl(result)) throw new Error('expected a parsed URL');
    expect(result.hostname).toBe('example.com');
  });

  it('handles IPv6 literals without throwing', () => {
    const result = parseUrl('https://[::1]:8080/health');
    if (!isParsedUrl(result)) throw new Error('expected a parsed URL');
    expect(result.hostname).toBe('[::1]');
    expect(result.port).toBe('8080');
    expect(result.pathname).toBe('/health');
  });

  it('handles internationalized domain names (IDN)', () => {
    const result = parseUrl('https://例え.jp/path');
    if (!isParsedUrl(result)) throw new Error('expected a parsed URL');
    // `new URL` punycodes the hostname; just assert it did not throw and kept the path.
    expect(result.pathname).toBe('/path');
    expect(result.hostname.length).toBeGreaterThan(0);
  });

  it('decodes percent-encoded query values and preserves keys verbatim', () => {
    const result = parseUrl('https://example.com/?q=hello%20world&empty=');
    if (!isParsedUrl(result)) throw new Error('expected a parsed URL');
    expect(result.query).toEqual([
      { key: 'q', value: 'hello world' },
      { key: 'empty', value: '' },
    ]);
  });

  it('keeps blank credentials as empty strings (not undefined)', () => {
    const result = parseUrl('https://example.com/');
    if (!isParsedUrl(result)) throw new Error('expected a parsed URL');
    expect(result.username).toBe('');
    expect(result.password).toBe('');
    expect(result.hash).toBe('');
  });

  it('exposes href identical to the underlying URL.href for round-trip safety', () => {
    const raw = 'https://user:pw@example.com:8443/p/q?a=1&a=2#x';
    const result = parseUrl(raw);
    if (!isParsedUrl(result)) throw new Error('expected a parsed URL');
    expect(result.href).toBe(new URL(raw).href);
  });
});

describe('isParsedUrl', () => {
  it('narrows to the parsed shape on the happy path', () => {
    const result = parseUrl('https://example.com/');
    if (isParsedUrl(result)) {
      // Type narrowing keeps this expression compile-safe.
      expect(result.hostname).toBe('example.com');
    } else {
      throw new Error('unexpected error branch');
    }
  });

  it('returns false for every error shape', () => {
    expect(isParsedUrl({ error: 'empty' })).toBe(false);
    expect(isParsedUrl({ error: 'invalid' })).toBe(false);
  });
});
