import { describe, expect, it } from 'vitest';
import {
  extractLinguaDeepLinkUrl,
  isLinguaDeepLink,
  parseLinguaDeepLink,
} from '../../src/shared/deepLinks';

describe('deepLinks parser', () => {
  it('recognizes lingua protocol URLs', () => {
    expect(isLinguaDeepLink('lingua://new?lang=python')).toBe(true);
    expect(isLinguaDeepLink('lingua:open?file=/tmp/test.ts')).toBe(true);
    expect(isLinguaDeepLink('https://example.com')).toBe(false);
  });

  it('extracts the first lingua deep link from argv', () => {
    expect(
      extractLinguaDeepLinkUrl(['electron', '.', 'lingua://new?lang=go', '--flag'])
    ).toBe('lingua://new?lang=go');
    expect(extractLinguaDeepLinkUrl(['electron', '.'])).toBeNull();
  });

  it('parses open-file links', () => {
    expect(parseLinguaDeepLink('lingua://open?file=/tmp/demo.ts')).toEqual({
      kind: 'open-file',
      filePath: '/tmp/demo.ts',
      rawUrl: 'lingua://open?file=/tmp/demo.ts',
    });
  });

  it('parses snippet links', () => {
    expect(parseLinguaDeepLink('lingua://snippet?id=snippet-123')).toEqual({
      kind: 'open-snippet',
      snippetId: 'snippet-123',
      rawUrl: 'lingua://snippet?id=snippet-123',
    });
  });

  it('parses new-file links and normalizes language aliases', () => {
    expect(parseLinguaDeepLink('lingua://new?lang=ts')).toEqual({
      kind: 'new-file',
      language: 'typescript',
      rawUrl: 'lingua://new?lang=ts',
    });
    expect(parseLinguaDeepLink('lingua:new?lang=py')).toEqual({
      kind: 'new-file',
      language: 'python',
      rawUrl: 'lingua:new?lang=py',
    });
  });

  it('rejects invalid or incomplete links', () => {
    expect(parseLinguaDeepLink('lingua://open')).toBeNull();
    expect(parseLinguaDeepLink('lingua://snippet')).toBeNull();
    expect(parseLinguaDeepLink('lingua://new')).toBeNull();
    expect(parseLinguaDeepLink('lingua://unknown?x=1')).toBeNull();
    expect(parseLinguaDeepLink('notaurl')).toBeNull();
  });
  it('parses license links into a shape-checked token without echoing the raw URL', () => {
    const token = 'eyJ0aWVyIjoicHJvIn0.c2lnbmF0dXJlLWJ5dGVz_-';
    expect(parseLinguaDeepLink(`lingua://license?token=${encodeURIComponent(token)}`)).toEqual({
      kind: 'license-token',
      token,
    });
    expect(parseLinguaDeepLink(`lingua:license?token=${token}`)).toEqual({
      kind: 'license-token',
      token,
    });
  });

  it.each([
    ['missing token', 'lingua://license'],
    ['empty token', 'lingua://license?token='],
    ['one segment', 'lingua://license?token=abc'],
    ['three segments', 'lingua://license?token=a.b.c'],
    ['non-base64url characters', 'lingua://license?token=a%2Bb.c%2Fd'],
    ['oversized token', `lingua://license?token=${'a'.repeat(8192)}.b`],
  ])('rejects license links with %s', (_label, url) => {
    expect(parseLinguaDeepLink(url)).toBeNull();
  });
});
