import { describe, expect, it } from 'vitest';

import {
  executionModeForLanguage,
  extensionForLanguage,
  languageCapabilityBadgeKey,
  languageForExtension,
  languageSupportsFileName,
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

  it('maps Dockerfile and Makefile extensions to the new built-in languages', () => {
    expect(languageForExtension('dockerfile')).toBe('dockerfile');
    expect(languageForExtension('mk')).toBe('makefile');
    expect(languageForExtension('mak')).toBe('makefile');
  });

  it('marks every infra file language as validate-only (never run)', () => {
    expect(executionModeForLanguage('dockerfile')).toBe('validate');
    expect(executionModeForLanguage('editorconfig')).toBe('validate');
    expect(executionModeForLanguage('makefile')).toBe('validate');
    expect(executionModeForLanguage('gitignore')).toBe('validate');
    expect(executionModeForLanguage('shellscript')).toBe('validate');
  });

  it('maps shell-script extensions and common dotfiles to the shellscript language', () => {
    expect(languageForExtension('sh')).toBe('shellscript');
    expect(languageForExtension('bash')).toBe('shellscript');
    expect(languageForExtension('zsh')).toBe('shellscript');
    expect(languageSupportsFileName('shellscript', '.bashrc')).toBe(true);
    expect(languageSupportsFileName('shellscript', '.zshrc')).toBe(true);
    expect(monacoLanguageFor('shellscript')).toBe('shell');
  });

  it('recognizes canonical infra file names via languageSupportsFileName', () => {
    expect(languageSupportsFileName('dockerfile', 'Dockerfile')).toBe(true);
    expect(languageSupportsFileName('dockerfile', 'Containerfile')).toBe(true);
    expect(languageSupportsFileName('makefile', 'Makefile')).toBe(true);
    expect(languageSupportsFileName('makefile', 'GNUmakefile')).toBe(true);
    expect(languageSupportsFileName('gitignore', '.gitignore')).toBe(true);
    expect(languageSupportsFileName('gitignore', '.dockerignore')).toBe(true);
    expect(languageSupportsFileName('editorconfig', '.editorconfig')).toBe(true);
  });

  it('resolves C and C++ through the LanguagePack descriptor (RL-042 second slice)', () => {
    expect(languageForExtension('c')).toBe('c');
    expect(languageForExtension('.h')).toBe('c');
    expect(languageForExtension('cpp')).toBe('cpp');
    expect(languageForExtension('hpp')).toBe('cpp');
    expect(languageForExtension('.cxx')).toBe('cpp');
    expect(extensionForLanguage('c')).toBe('c');
    expect(extensionForLanguage('cpp')).toBe('cpp');
    expect(monacoLanguageFor('c')).toBe('c');
    expect(monacoLanguageFor('cpp')).toBe('cpp');
    expect(executionModeForLanguage('c')).toBe('validate');
    expect(executionModeForLanguage('cpp')).toBe('validate');
  });

  it('resolves Ruby through the LanguagePack descriptor (RL-042 first slice)', () => {
    expect(languageForExtension('rb')?.toString()).toBe('ruby');
    expect(extensionForLanguage('ruby')).toBe('rb');
    expect(monacoLanguageFor('ruby')).toBe('ruby');
    // Ruby is validate-only in this slice — no execution yet.
    expect(executionModeForLanguage('ruby')).toBe('validate');
  });

  it('flags languages that need a host toolchain with a capability badge key (RL-038 Slice C)', () => {
    // Go + Rust depend on host binaries declared in LANGUAGE_PACKS.
    expect(languageCapabilityBadgeKey('go')).toBe('language.capability.desktopOnly');
    expect(languageCapabilityBadgeKey('rust')).toBe('language.capability.desktopOnly');
    // Self-contained runtimes return null so the toolbar shows no badge.
    expect(languageCapabilityBadgeKey('javascript')).toBeNull();
    expect(languageCapabilityBadgeKey('typescript')).toBeNull();
    expect(languageCapabilityBadgeKey('python')).toBeNull();
    // Plugin-only languages without a LANGUAGE_PACKS entry fall through to null.
    expect(languageCapabilityBadgeKey('unknown-language')).toBeNull();
  });

  it('routes infra files through plausible Monaco modes', () => {
    expect(monacoLanguageFor('dockerfile')).toBe('dockerfile');
    expect(monacoLanguageFor('makefile')).toBe('makefile');
    // gitignore has no native Monaco grammar — shell is the honest fallback
    expect(monacoLanguageFor('gitignore')).toBe('shell');
    // editorconfig is INI-compatible
    expect(monacoLanguageFor('editorconfig')).toBe('ini');
  });
});
