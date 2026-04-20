/**
 * RL-038 Slice A — pack array integrity. Locks the descriptor shape so
 * future additions can't drift on a required field, and verifies the
 * resolver helpers round-trip every built-in language id, extension, and
 * file name. Slice B + C tests will pin runner dispatch and capability
 * UI separately; this file is the foundation.
 */

import { describe, expect, it } from 'vitest';
import {
  LANGUAGE_PACKS,
  executionModeForPack,
  formatterStrategyForPack,
  getLanguagePackById,
  getLanguagePackForExtension,
  getLanguagePackForFileName,
  monacoLanguageForPack,
  runnerIdForPack,
  type LanguagePack,
} from '../../src/shared/languagePacks';

describe('LANGUAGE_PACKS array integrity', () => {
  it('keeps every built-in language id unique', () => {
    const ids = LANGUAGE_PACKS.map((pack) => pack.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every pack carries the required descriptor fields', () => {
    for (const pack of LANGUAGE_PACKS) {
      expect(pack.id, 'id').toBeTruthy();
      expect(pack.labelKey, `labelKey for ${pack.id}`).toBeTruthy();
      expect(pack.shortLabelKey, `shortLabelKey for ${pack.id}`).toBeTruthy();
      expect(pack.monacoLanguage, `monacoLanguage for ${pack.id}`).toBeTruthy();
      expect(pack.execution, `execution for ${pack.id}`).toMatch(/^(run|compile|validate|view)$/);
      expect(pack.formatter, `formatter for ${pack.id}`).toMatch(
        /^(prettier|ipc:gofmt|ipc:rustfmt|ipc:python|none)$/
      );
      expect(pack.capabilities.lsp, `lsp for ${pack.id}`).toMatch(/^(builtin|desktop|none)$/);
      expect(pack.capabilities.debugger, `debugger for ${pack.id}`).toMatch(
        /^(available|planned|none)$/
      );
    }
  });

  it('every runnable pack ships a runnerId, every non-runnable pack does not', () => {
    for (const pack of LANGUAGE_PACKS) {
      const runnable = pack.execution === 'run' || pack.execution === 'compile';
      if (runnable) {
        expect(pack.runnerId, `runnable pack ${pack.id} needs a runnerId`).toBe(pack.id);
      } else {
        expect(pack.runnerId, `non-runnable pack ${pack.id} should not have a runnerId`).toBeNull();
      }
    }
  });

  it('every extension maps to exactly one pack', () => {
    const extensions = new Map<string, string>();
    for (const pack of LANGUAGE_PACKS) {
      for (const extension of pack.extensions) {
        const existing = extensions.get(extension);
        expect(
          existing,
          `extension ${extension} double-claimed by ${existing} and ${pack.id}`
        ).toBeUndefined();
        extensions.set(extension, pack.id);
      }
    }
  });

  it('every file name resolves to at most one pack across the registry', () => {
    // Same-pack duplicates are legal (e.g. Makefile + makefile case
    // variants both belong to the makefile pack). Cross-pack duplicates
    // are the actual bug we want to catch.
    const fileNames = new Map<string, string>();
    for (const pack of LANGUAGE_PACKS) {
      for (const fileName of pack.fileNames ?? []) {
        const lower = fileName.toLowerCase();
        const existing = fileNames.get(lower);
        if (existing !== undefined) {
          expect(
            existing,
            `file name ${fileName} double-claimed by ${existing} and ${pack.id}`
          ).toBe(pack.id);
        }
        fileNames.set(lower, pack.id);
      }
    }
  });

  it('contains every built-in language the legacy meta named', () => {
    const required = [
      'javascript',
      'typescript',
      'go',
      'python',
      'rust',
      'json',
      'yaml',
      'dotenv',
      'toml',
      'ini',
      'csv',
      'dockerfile',
      'makefile',
      'gitignore',
      'editorconfig',
      'shellscript',
    ];
    const ids = new Set(LANGUAGE_PACKS.map((pack) => pack.id));
    for (const id of required) {
      expect(ids.has(id), `missing built-in pack: ${id}`).toBe(true);
    }
  });

  it('runtime-dependent packs declare their host binaries', () => {
    const goPack = getLanguagePackById('go') as LanguagePack;
    const rustPack = getLanguagePackById('rust') as LanguagePack;
    expect(goPack.capabilities.runtimeDependencies).toContain('go');
    expect(rustPack.capabilities.runtimeDependencies).toContain('rustc');
  });
});

describe('resolver helpers', () => {
  it('getLanguagePackById is undefined for unknown ids', () => {
    expect(getLanguagePackById('not-a-language')).toBeUndefined();
  });

  it('getLanguagePackForExtension resolves canonical extensions and tolerates leading dots', () => {
    expect(getLanguagePackForExtension('ts')?.id).toBe('typescript');
    expect(getLanguagePackForExtension('.ts')?.id).toBe('typescript');
    expect(getLanguagePackForExtension('YML')?.id).toBe('yaml');
    expect(getLanguagePackForExtension('')).toBeUndefined();
  });

  it('getLanguagePackForFileName resolves bare file names case-insensitively', () => {
    expect(getLanguagePackForFileName('Dockerfile')?.id).toBe('dockerfile');
    expect(getLanguagePackForFileName('dockerfile')?.id).toBe('dockerfile');
    expect(getLanguagePackForFileName('Makefile')?.id).toBe('makefile');
    expect(getLanguagePackForFileName('.editorconfig')?.id).toBe('editorconfig');
    expect(getLanguagePackForFileName('not-real')).toBeUndefined();
  });

  it('monaco / execution / formatter / runnerId helpers fall back safely for unknown ids', () => {
    expect(monacoLanguageForPack('mystery')).toBe('plaintext');
    expect(monacoLanguageForPack('mystery', 'shell')).toBe('shell');
    expect(executionModeForPack('mystery')).toBe('view');
    expect(formatterStrategyForPack('mystery')).toBe('none');
    expect(runnerIdForPack('mystery')).toBeNull();
    expect(runnerIdForPack('typescript')).toBe('typescript');
    expect(runnerIdForPack('json')).toBeNull();
  });
});
