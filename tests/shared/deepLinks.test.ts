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
});
