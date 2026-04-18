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
      expect(languageFromPath('/workspace/package.json')).toBe('json');
      expect(languageFromPath('/workspace/docker-compose.yml')).toBe('yaml');
      expect(languageFromPath('/workspace/.env')).toBe('dotenv');
      expect(languageFromPath('/workspace/.env.local')).toBe('dotenv');
      expect(languageFromPath('/workspace/data.csv')).toBe('csv');
      expect(languageFromPath('notes.md')).toBeUndefined();
    });

    it('returns undefined for files with no extension', () => {
      expect(languageFromPath('/etc/hosts')).toBeUndefined();
      expect(languageFromPath('README')).toBeUndefined();
      expect(languageFromPath('trailing.')).toBeUndefined();
    });

    it('recognizes canonical infra files even without an extension', () => {
      expect(languageFromPath('/repo/Dockerfile')).toBe('dockerfile');
      expect(languageFromPath('/repo/Dockerfile.dev')).toBe('dockerfile');
      expect(languageFromPath('/repo/Containerfile')).toBe('dockerfile');
      expect(languageFromPath('/repo/Makefile')).toBe('makefile');
      expect(languageFromPath('/repo/GNUmakefile')).toBe('makefile');
      expect(languageFromPath('/repo/subdir/.gitignore')).toBe('gitignore');
      expect(languageFromPath('.dockerignore')).toBe('gitignore');
      expect(languageFromPath('/repo/.editorconfig')).toBe('editorconfig');
    });

    it('still picks up extension-based infra files', () => {
      expect(languageFromPath('build.mk')).toBe('makefile');
      expect(languageFromPath('deploy.dockerfile')).toBe('dockerfile');
    });

    it('detects shell scripts by extension and by dotfile name', () => {
      expect(languageFromPath('scripts/deploy.sh')).toBe('shellscript');
      expect(languageFromPath('run.bash')).toBe('shellscript');
      expect(languageFromPath('init.zsh')).toBe('shellscript');
      expect(languageFromPath('/home/me/.bashrc')).toBe('shellscript');
      expect(languageFromPath('/home/me/.zshrc')).toBe('shellscript');
      expect(languageFromPath('/home/me/.profile')).toBe('shellscript');
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
