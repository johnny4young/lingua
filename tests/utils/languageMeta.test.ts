import { describe, expect, it } from 'vitest';

import {
  extensionForLanguage,
  languageForExtension,
  monacoLanguageFor,
} from '@/utils/languageMeta';

describe('languageMeta', () => {
  it('derives the primary file extension from the language metadata', () => {
    expect(extensionForLanguage('javascript')).toBe('js');
    expect(extensionForLanguage('typescript')).toBe('ts');
    expect(extensionForLanguage('plaintext')).toBe('txt');
  });

  it('detects built-in languages from normalized file extensions', () => {
    expect(languageForExtension('.go')).toBe('go');
    expect(languageForExtension('PY')).toBe('python');
    expect(languageForExtension(' rs ')).toBe('rust');
    expect(languageForExtension('tsx')).toBe('typescript');
    expect(languageForExtension('.mjs')).toBe('javascript');
    expect(languageForExtension('.json')).toBe('json');
    expect(languageForExtension('yaml')).toBe('yaml');
    expect(languageForExtension('env')).toBe('dotenv');
    expect(languageForExtension('csv')).toBe('csv');
    expect(languageForExtension('toml')).toBe('toml');
    expect(languageForExtension('ini')).toBe('ini');
  });

  it('returns undefined for unknown extensions so callers can fall back to plaintext', () => {
    expect(languageForExtension('.txt')).toBeUndefined();
    expect(languageForExtension('md')).toBeUndefined();
  });

  it('maps unknown editor languages to the Monaco plaintext mode', () => {
    expect(monacoLanguageFor('plaintext')).toBe('plaintext');
  });
});
