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
  templateIdsForPack,
  type LanguagePack,
} from '../../src/shared/languagePacks';
import { BUILT_IN_TEMPLATES } from '../../src/renderer/data/templates';

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
      expect(pack.capabilities.lsp, `lsp for ${pack.id}`).toMatch(
        /^(builtin|adapter|desktop|none)$/
      );
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
      'lua',
      'ruby',
      'c',
      'cpp',
      'swift',
      'kotlin',
      'java',
      'scala',
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

  it('ships Java and Scala as validate-only packs (RL-042 fourth slice)', () => {
    const java = getLanguagePackById('java') as LanguagePack;
    const scala = getLanguagePackById('scala') as LanguagePack;
    for (const pack of [java, scala]) {
      expect(pack).toBeDefined();
      expect(pack.execution).toBe('validate');
      expect(pack.runnerId).toBeNull();
      expect(pack.formatter).toBe('none');
    }
    expect(java.monacoLanguage).toBe('java');
    expect(java.extensions).toContain('java');
    expect(java.badgeClass).toContain('amber');
    expect(scala.monacoLanguage).toBe('scala');
    expect(scala.extensions).toEqual(expect.arrayContaining(['scala', 'sc']));
    expect(scala.badgeClass).toContain('rose');
  });

  it('resolves Java and Scala packs by their canonical extensions', () => {
    expect(getLanguagePackForExtension('java')?.id).toBe('java');
    expect(getLanguagePackForExtension('.java')?.id).toBe('java');
    expect(getLanguagePackForExtension('scala')?.id).toBe('scala');
    expect(getLanguagePackForExtension('sc')?.id).toBe('scala');
  });

  it('ships Swift and Kotlin as validate-only packs (RL-042 third slice)', () => {
    const swift = getLanguagePackById('swift') as LanguagePack;
    const kotlin = getLanguagePackById('kotlin') as LanguagePack;
    for (const pack of [swift, kotlin]) {
      expect(pack).toBeDefined();
      expect(pack.execution).toBe('validate');
      expect(pack.runnerId).toBeNull();
      expect(pack.formatter).toBe('none');
    }
    expect(swift.monacoLanguage).toBe('swift');
    expect(swift.extensions).toContain('swift');
    expect(swift.badgeClass).toContain('orange');
    expect(kotlin.monacoLanguage).toBe('kotlin');
    expect(kotlin.extensions).toEqual(expect.arrayContaining(['kt', 'kts']));
    expect(kotlin.badgeClass).toContain('purple');
  });

  it('resolves Swift and Kotlin packs by their canonical extensions', () => {
    expect(getLanguagePackForExtension('swift')?.id).toBe('swift');
    expect(getLanguagePackForExtension('.swift')?.id).toBe('swift');
    expect(getLanguagePackForExtension('kt')?.id).toBe('kotlin');
    expect(getLanguagePackForExtension('kts')?.id).toBe('kotlin');
  });

  it('ships C and C++ as validate-only packs (RL-042 second slice)', () => {
    const cPack = getLanguagePackById('c') as LanguagePack;
    const cppPack = getLanguagePackById('cpp') as LanguagePack;
    for (const pack of [cPack, cppPack]) {
      expect(pack).toBeDefined();
      expect(pack.execution).toBe('validate');
      expect(pack.runnerId).toBeNull();
      expect(pack.formatter).toBe('none');
      expect(pack.capabilities.lsp).toBe('none');
    }
    expect(cPack.monacoLanguage).toBe('c');
    expect(cPack.extensions).toEqual(expect.arrayContaining(['c', 'h']));
    expect(cppPack.monacoLanguage).toBe('cpp');
    expect(cppPack.extensions).toEqual(
      expect.arrayContaining(['cpp', 'cc', 'cxx', 'hpp', 'hh', 'hxx'])
    );
  });

  it('resolves C and C++ packs by their canonical extensions', () => {
    expect(getLanguagePackForExtension('c')?.id).toBe('c');
    expect(getLanguagePackForExtension('h')?.id).toBe('c');
    expect(getLanguagePackForExtension('cpp')?.id).toBe('cpp');
    expect(getLanguagePackForExtension('.hpp')?.id).toBe('cpp');
    expect(getLanguagePackForExtension('cxx')?.id).toBe('cpp');
  });

  it('ships Ruby as a runnable pack (RL-042 Slice 5 — web @ruby/wasm-wasi runtime)', () => {
    const ruby = getLanguagePackById('ruby') as LanguagePack;
    expect(ruby).toBeDefined();
    expect(ruby.execution).toBe('run');
    expect(ruby.runnerId).toBe('ruby');
    // Formatter stays `none` this slice — wiring `ipc:ruby` (gem
    // rubocop / standardrb) is a separate desktop-only follow-up.
    expect(ruby.formatter).toBe('none');
    expect(ruby.monacoLanguage).toBe('ruby');
    expect(ruby.extensions).toContain('rb');
    // Ruby now has renderer-local language intelligence. A process-backed
    // ruby-lsp / solargraph bridge remains a separate desktop-only follow-up.
    expect(ruby.capabilities.lsp).toBe('adapter');
    expect(ruby.capabilities.debugger).toBe('none');
  });

  it('resolves the ruby pack by its .rb extension round-trip', () => {
    expect(getLanguagePackForExtension('rb')?.id).toBe('ruby');
    expect(getLanguagePackForExtension('.rb')?.id).toBe('ruby');
  });

  it('ships Lua as a first-class pack entry (Slice B) with plugin-sourced runner', () => {
    const lua = getLanguagePackById('lua') as LanguagePack;
    expect(lua).toBeDefined();
    expect(lua.execution).toBe('run');
    // Lua keeps a runnerId to satisfy the "every runnable pack ships a
    // runnerId" invariant even though the actual runner is plugin-sourced.
    expect(lua.runnerId).toBe('lua');
    expect(lua.extensions).toContain('lua');
    expect(lua.monacoLanguage).toBe('lua');
  });

  it('runtime-dependent packs declare their host binaries', () => {
    const goPack = getLanguagePackById('go') as LanguagePack;
    const rustPack = getLanguagePackById('rust') as LanguagePack;
    expect(goPack.capabilities.runtimeDependencies).toContain('go');
    expect(rustPack.capabilities.runtimeDependencies).toContain('rustc');
    // Ruby declares `ruby` as a preferred host binary, but the bundled
    // WASM worker remains the portable fallback.
    const rubyPack = getLanguagePackById('ruby') as LanguagePack;
    expect(rubyPack.capabilities.runtimeDependencies).toContain('ruby');
    expect(rubyPack.capabilities.runtimeDependencyMode).toBe('optional');
  });

  it('marks Python language intelligence as the renderer adapter slice', () => {
    const python = getLanguagePackById('python') as LanguagePack;
    expect(python.capabilities.lsp).toBe('adapter');
    expect(python.execution).toBe('run');
    expect(python.runnerId).toBe('python');
  });
});

describe('RL-020 Slice 3 — Scratchpad default templates demo arrow + watch', () => {
  it.each([['javascript'], ['typescript'], ['python']])(
    '%s default template contains both arrow and @watch markers',
    (langId) => {
      const pack = LANGUAGE_PACKS.find((p) => p.id === langId);
      expect(pack, `language pack for ${langId}`).toBeDefined();
      // Arrow marker — `//=>` for JS/TS, `#=>` for Python.
      const arrowMarker = langId === 'python' ? '#=>' : '//=>';
      expect(
        pack!.defaultCode.includes(arrowMarker),
        `${langId} default should demo the ${arrowMarker} arrow`
      ).toBe(true);
      // Watch marker — `// @watch` for JS/TS, `# @watch` for Python.
      const watchMarker = langId === 'python' ? '# @watch' : '// @watch';
      expect(
        pack!.defaultCode.includes(watchMarker),
        `${langId} default should demo the ${watchMarker} pin`
      ).toBe(true);
    }
  );
});

describe('templateIds contract (RL-038 Slice C polish)', () => {
  it('every runnable built-in pack declares at least one starter template', () => {
    for (const pack of LANGUAGE_PACKS) {
      if (pack.execution !== 'run' && pack.execution !== 'compile') continue;
      // Lua is runnable but plugin-sourced and ships no built-in templates
      // yet; skip it so we don't force a template just to satisfy the guard.
      if (pack.id === 'lua') continue;
      expect(pack.templateIds.length, `${pack.id} has no templateIds`).toBeGreaterThan(0);
    }
  });

  it('every declared templateId resolves to a real template and matches its language', () => {
    const templatesById = new Map(BUILT_IN_TEMPLATES.map((template) => [template.id, template]));
    for (const pack of LANGUAGE_PACKS) {
      for (const templateId of pack.templateIds) {
        const template = templatesById.get(templateId);
        expect(template, `${pack.id} references unknown template ${templateId}`).toBeDefined();
        expect(
          template?.language,
          `template ${templateId} claims language ${template?.language} but pack is ${pack.id}`
        ).toBe(pack.id);
      }
    }
  });

  it('no built-in template is orphaned — every template is claimed by its pack', () => {
    const claimed = new Set<string>();
    for (const pack of LANGUAGE_PACKS) {
      for (const id of pack.templateIds) claimed.add(id);
    }
    for (const template of BUILT_IN_TEMPLATES) {
      expect(claimed.has(template.id), `template ${template.id} is not claimed by any pack`).toBe(true);
    }
  });

  it('templateIdsForPack falls back to an empty array for unknown ids', () => {
    expect(templateIdsForPack('mystery')).toEqual([]);
    expect(templateIdsForPack('javascript').length).toBeGreaterThan(0);
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

// RL-038 drift guard: the language-pack capabilities should stay in sync
// with the actual validators registered in `src/renderer/validation`. If a
// new validator ships without the corresponding pack flag, this test fails
// and points at the mismatch so the registry can't silently lie about what
// the pipeline actually does.
//
// Known overload: a few packs use `execution: 'validate'` as a "visible but
// no runtime yet" placeholder (see the Ruby pack comment in
// `src/shared/languagePacks.ts`). A future schema slice can split that into
// a dedicated `placeholder` mode; until then we allow-list those ids so the
// drift check stays strict on the real validators without blocking the
// placeholder UX.
// RL-042 ships several languages as "validate-mode placeholders" — file
// detection + Monaco highlighting work but there's no runtime or validator
// yet. See the inline comments on each of these packs in
// `src/shared/languagePacks.ts`. When a real validator lands, remove the
// pack id from this set so the drift guard starts enforcing it.
const VALIDATE_MODE_PLACEHOLDERS: ReadonlySet<string> = new Set([
  'ruby',
  'c',
  'cpp',
  'swift',
  'kotlin',
  'java',
  'scala',
]);

describe('language-pack ↔ validator drift guard', () => {
  it('every pack whose execution mode is "validate" has a validator registered', async () => {
    const { supportsValidation } = await import('../../src/renderer/validation');
    for (const pack of LANGUAGE_PACKS) {
      if (pack.execution !== 'validate') continue;
      if (VALIDATE_MODE_PLACEHOLDERS.has(pack.id)) continue;
      expect(
        supportsValidation(pack.id),
        `pack ${pack.id} is marked validate but has no validator wired`
      ).toBe(true);
    }
  });

  it('every registered validator has a pack that declares the validate execution mode', async () => {
    const { supportsValidation } = await import('../../src/renderer/validation');
    for (const pack of LANGUAGE_PACKS) {
      if (!supportsValidation(pack.id)) continue;
      expect(
        pack.execution,
        `pack ${pack.id} has a validator but pack.execution is ${pack.execution}`
      ).toBe('validate');
    }
  });
});
