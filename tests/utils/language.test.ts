import { describe, expect, it } from 'vitest';

import {
  PLAINTEXT_LANGUAGE,
  languageFromPath,
  resolveFileLanguageOrPlaintext,
} from '@/utils/language';

describe('language', () => {
  it('exposes the plaintext fallback as a named constant', () => {
    expect(PLAINTEXT_LANGUAGE).toBe('plaintext');
  });

  describe('languageFromPath', () => {
    it('detects built-in extensions regardless of case', () => {
      expect(languageFromPath('/abs/path/Main.TS')).toBe('typescript');
      expect(languageFromPath('src\\index.MJS')).toBe('javascript');
      expect(languageFromPath('notes.md')).toBeUndefined();
    });

    it('returns undefined for files with no extension', () => {
      expect(languageFromPath('/etc/hosts')).toBeUndefined();
      expect(languageFromPath('README')).toBeUndefined();
      expect(languageFromPath('trailing.')).toBeUndefined();
    });
  });

  describe('resolveFileLanguageOrPlaintext', () => {
    it('returns the detected language when the extension is known', () => {
      expect(resolveFileLanguageOrPlaintext('src/index.ts')).toBe('typescript');
      expect(resolveFileLanguageOrPlaintext('/tmp/a.rs')).toBe('rust');
    });

    it('degrades to plaintext for unknown extensions', () => {
      expect(resolveFileLanguageOrPlaintext('/tmp/notes.txt')).toBe(PLAINTEXT_LANGUAGE);
      expect(resolveFileLanguageOrPlaintext('README')).toBe(PLAINTEXT_LANGUAGE);
    });

    it('degrades to plaintext when no path is provided', () => {
      expect(resolveFileLanguageOrPlaintext(undefined)).toBe(PLAINTEXT_LANGUAGE);
    });
  });
});
