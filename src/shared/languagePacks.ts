/**
 * Language pack descriptor (RL-038 Slice A).
 *
 * Single source of truth for built-in language metadata. The legacy
 * helpers in `src/renderer/utils/languageMeta.ts`, `language.ts`, and
 * `languageCapabilities.ts` now proxy to this array so adding a new
 * built-in language only requires a new entry here plus an i18n key.
 *
 * Slice A is intentionally **zero-behavior-change**: every consumer
 * still goes through the legacy helper names. Slices B (runner
 * dispatch) and C (capability-aware UI) live in
 * `LANGUAGE_PACK_ADR.md` and ship in follow-up sessions.
 *
 * Constraint per the ADR: NO third-party arbitrary-code loading is
 * introduced. Plugin runtimes register pack descriptors at build time
 * (today: `pluginRegistry`). The pack array intentionally stays in
 * `src/shared/` — both renderer and main can read it, and there's no
 * React dependency.
 */

export type LanguagePackId =
  | 'javascript'
  | 'typescript'
  | 'go'
  | 'python'
  | 'rust'
  | 'lua'
  | 'json'
  | 'yaml'
  | 'dotenv'
  | 'toml'
  | 'ini'
  | 'csv'
  | 'dockerfile'
  | 'makefile'
  | 'gitignore'
  | 'editorconfig'
  | 'shellscript';

export type LanguagePackExecution = 'run' | 'compile' | 'validate' | 'view';

export type LanguagePackFormatter =
  | 'prettier'
  | 'ipc:gofmt'
  | 'ipc:rustfmt'
  | 'ipc:python'
  | 'none';

export type LanguagePackLspSupport = 'builtin' | 'desktop' | 'none';

export type LanguagePackDebuggerSupport = 'available' | 'planned' | 'none';

export interface LanguagePackCapabilities {
  /**
   * Where richer-than-Monaco language services come from. `builtin` =
   * Monaco's bundled service (TS / JS), `desktop` = an LSP that needs
   * a desktop bridge (RL-026), `none` = keyword + snippet completions
   * only.
   */
  lsp: LanguagePackLspSupport;
  /** RL-027 debugger MVP gate. */
  debugger: LanguagePackDebuggerSupport;
  /**
   * Things the runtime expects on the host. Empty for self-contained
   * runtimes (Pyodide, Lua via Fengari) and populated with the
   * binary names that need to be on PATH (`go`, `rustc`, `gofmt`,
   * `rustfmt`, `ruff`, `black`, ...). Read by future capability-aware
   * UI to surface "missing toolchain" badges.
   */
  runtimeDependencies?: readonly string[];
}

export interface LanguagePack {
  /** Stable id — matches the `Language` string union and the runner id. */
  id: LanguagePackId;
  /** i18n key for the long display label ("JavaScript", "Dockerfile"). */
  labelKey: string;
  /** i18n key for the compact 2–4-letter badge ("JS", "Py"). */
  shortLabelKey: string;
  /**
   * Tailwind class string for the colored badge background. Kept here
   * (not in i18n) because design tokens are not localized; the i18n
   * keys above own the *text*.
   */
  badgeClass: string;
  textColorClass: string;
  /** File extensions without the leading dot (e.g. `'js'`, `'mjs'`). */
  extensions: readonly string[];
  /** Bare file names (no extension) that always resolve to this pack. */
  fileNames?: readonly string[];
  /** Monaco editor language id. */
  monacoLanguage: string;
  /** Boilerplate inserted into a fresh tab for this language. */
  defaultCode: string;
  /** What the editor surfaces for execution semantics. */
  execution: LanguagePackExecution;
  /**
   * Runner id consumed by `runners/manager.ts`. `null` for validate /
   * view-only packs. Equal to `id` for built-in runnable languages.
   */
  runnerId: LanguagePackId | null;
  /** Format-on-save strategy for this language. */
  formatter: LanguagePackFormatter;
  capabilities: LanguagePackCapabilities;
  /** Optional canonical docs link surfaced in capability-aware UI. */
  docsUrl?: string;
  /**
   * Starter template ids that belong to this language. Sourced from
   * `src/renderer/data/templates.ts`. Empty for non-runnable packs.
   */
  templateIds: readonly string[];
}

export const LANGUAGE_PACKS: readonly LanguagePack[] = [
  {
    id: 'javascript',
    labelKey: 'language.javascript.label',
    shortLabelKey: 'language.javascript.shortLabel',
    badgeClass: 'bg-yellow-500/20 text-yellow-400',
    textColorClass: 'text-yellow-400',
    extensions: ['js', 'jsx', 'mjs', 'cjs'],
    monacoLanguage: 'javascript',
    defaultCode: '// Welcome to Lingua\nconsole.log("Hello, World!");\n',
    execution: 'run',
    runnerId: 'javascript',
    formatter: 'prettier',
    capabilities: { lsp: 'builtin', debugger: 'planned' },
    docsUrl: 'https://developer.mozilla.org/en-US/docs/Web/JavaScript',
    templateIds: [],
  },
  {
    id: 'typescript',
    labelKey: 'language.typescript.label',
    shortLabelKey: 'language.typescript.shortLabel',
    badgeClass: 'bg-blue-500/20 text-blue-400',
    textColorClass: 'text-blue-400',
    extensions: ['ts', 'tsx'],
    monacoLanguage: 'typescript',
    defaultCode:
      '// Welcome to Lingua\nconst greeting: string = "Hello, World!";\nconsole.log(greeting);\n',
    execution: 'run',
    runnerId: 'typescript',
    formatter: 'prettier',
    capabilities: { lsp: 'builtin', debugger: 'planned' },
    docsUrl: 'https://www.typescriptlang.org/docs/',
    templateIds: [],
  },
  {
    id: 'go',
    labelKey: 'language.go.label',
    shortLabelKey: 'language.go.shortLabel',
    badgeClass: 'bg-cyan-500/20 text-cyan-400',
    textColorClass: 'text-cyan-400',
    extensions: ['go'],
    monacoLanguage: 'go',
    defaultCode:
      '// Welcome to Lingua\npackage main\n\nimport "fmt"\n\nfunc main() {\n\tfmt.Println("Hello, World!")\n}\n',
    execution: 'compile',
    runnerId: 'go',
    formatter: 'ipc:gofmt',
    capabilities: { lsp: 'desktop', debugger: 'planned', runtimeDependencies: ['go'] },
    docsUrl: 'https://go.dev/doc/',
    templateIds: [],
  },
  {
    id: 'python',
    labelKey: 'language.python.label',
    shortLabelKey: 'language.python.shortLabel',
    badgeClass: 'bg-green-500/20 text-green-400',
    textColorClass: 'text-green-400',
    extensions: ['py'],
    monacoLanguage: 'python',
    defaultCode: '# Welcome to Lingua\nprint("Hello, World!")\n',
    execution: 'run',
    runnerId: 'python',
    formatter: 'ipc:python',
    capabilities: { lsp: 'desktop', debugger: 'planned' },
    docsUrl: 'https://docs.python.org/3/',
    templateIds: [],
  },
  {
    id: 'rust',
    labelKey: 'language.rust.label',
    shortLabelKey: 'language.rust.shortLabel',
    badgeClass: 'bg-orange-500/20 text-orange-400',
    textColorClass: 'text-orange-400',
    extensions: ['rs'],
    monacoLanguage: 'rust',
    defaultCode:
      '// Welcome to Lingua\nfn main() {\n    println!("Hello, World!");\n}\n',
    execution: 'compile',
    runnerId: 'rust',
    formatter: 'ipc:rustfmt',
    capabilities: { lsp: 'desktop', debugger: 'planned', runtimeDependencies: ['rustc'] },
    docsUrl: 'https://doc.rust-lang.org/book/',
    templateIds: [],
  },
  {
    id: 'lua',
    labelKey: 'language.lua.label',
    shortLabelKey: 'language.lua.shortLabel',
    badgeClass: 'bg-violet-500/20 text-violet-300',
    textColorClass: 'text-violet-300',
    extensions: ['lua'],
    monacoLanguage: 'lua',
    defaultCode:
      '-- Lua example\nlocal function greet(name)\n  print("Hello, " .. name .. "!")\nend\n\ngreet("Lingua")\n',
    execution: 'run',
    // Lua's runner is plugin-sourced (see src/renderer/plugins/lua-runner.ts
    // + plugins/catalog.ts). Slice B keeps `runnerId` populated so the pack
    // array's invariant ("every runnable pack ships a runnerId") stays
    // intact, but `RunnerManager` intentionally has no factory for it —
    // resolution falls through to `pluginRegistry`. This proves the
    // factory-map walk is additive, not a pluginRegistry replacement.
    runnerId: 'lua',
    formatter: 'none',
    capabilities: { lsp: 'none', debugger: 'none' },
    docsUrl: 'https://www.lua.org/docs.html',
    templateIds: [],
  },
  {
    id: 'json',
    labelKey: 'language.json.label',
    shortLabelKey: 'language.json.shortLabel',
    badgeClass: 'bg-emerald-500/15 text-emerald-300',
    textColorClass: 'text-emerald-300',
    extensions: ['json'],
    monacoLanguage: 'json',
    defaultCode: '{\n  "name": "lingua"\n}\n',
    execution: 'validate',
    runnerId: null,
    formatter: 'prettier',
    capabilities: { lsp: 'builtin', debugger: 'none' },
    templateIds: [],
  },
  {
    id: 'yaml',
    labelKey: 'language.yaml.label',
    shortLabelKey: 'language.yaml.shortLabel',
    badgeClass: 'bg-teal-500/15 text-teal-300',
    textColorClass: 'text-teal-300',
    extensions: ['yaml', 'yml'],
    monacoLanguage: 'yaml',
    defaultCode: 'name: lingua\n',
    execution: 'validate',
    runnerId: null,
    formatter: 'none',
    capabilities: { lsp: 'none', debugger: 'none' },
    templateIds: [],
  },
  {
    id: 'dotenv',
    labelKey: 'language.dotenv.label',
    shortLabelKey: 'language.dotenv.shortLabel',
    badgeClass: 'bg-lime-500/15 text-lime-300',
    textColorClass: 'text-lime-300',
    extensions: ['env'],
    fileNames: ['.env'],
    monacoLanguage: 'dotenv',
    defaultCode: 'NODE_ENV=development\n',
    execution: 'validate',
    runnerId: null,
    formatter: 'none',
    capabilities: { lsp: 'none', debugger: 'none' },
    templateIds: [],
  },
  {
    id: 'toml',
    labelKey: 'language.toml.label',
    shortLabelKey: 'language.toml.shortLabel',
    badgeClass: 'bg-amber-500/15 text-amber-300',
    textColorClass: 'text-amber-300',
    extensions: ['toml'],
    monacoLanguage: 'toml',
    defaultCode: 'title = "Lingua"\n',
    execution: 'view',
    runnerId: null,
    formatter: 'none',
    capabilities: { lsp: 'none', debugger: 'none' },
    templateIds: [],
  },
  {
    id: 'ini',
    labelKey: 'language.ini.label',
    shortLabelKey: 'language.ini.shortLabel',
    badgeClass: 'bg-sky-500/15 text-sky-300',
    textColorClass: 'text-sky-300',
    extensions: ['ini', 'cfg', 'conf'],
    monacoLanguage: 'ini',
    defaultCode: '[section]\nkey=value\n',
    execution: 'view',
    runnerId: null,
    formatter: 'none',
    capabilities: { lsp: 'none', debugger: 'none' },
    templateIds: [],
  },
  {
    id: 'csv',
    labelKey: 'language.csv.label',
    shortLabelKey: 'language.csv.shortLabel',
    badgeClass: 'bg-rose-500/15 text-rose-300',
    textColorClass: 'text-rose-300',
    extensions: ['csv'],
    monacoLanguage: 'csv',
    defaultCode: 'name,value\nexample,1\n',
    execution: 'validate',
    runnerId: null,
    formatter: 'none',
    capabilities: { lsp: 'none', debugger: 'none' },
    templateIds: [],
  },
  {
    id: 'dockerfile',
    labelKey: 'language.dockerfile.label',
    shortLabelKey: 'language.dockerfile.shortLabel',
    badgeClass: 'bg-sky-500/15 text-sky-300',
    textColorClass: 'text-sky-300',
    extensions: ['dockerfile'],
    fileNames: ['Dockerfile', 'Containerfile'],
    monacoLanguage: 'dockerfile',
    defaultCode: 'FROM node:20\nWORKDIR /app\n',
    execution: 'validate',
    runnerId: null,
    formatter: 'none',
    capabilities: { lsp: 'none', debugger: 'none' },
    templateIds: [],
  },
  {
    id: 'makefile',
    labelKey: 'language.makefile.label',
    shortLabelKey: 'language.makefile.shortLabel',
    badgeClass: 'bg-amber-500/15 text-amber-300',
    textColorClass: 'text-amber-300',
    extensions: ['mk', 'mak'],
    fileNames: ['Makefile', 'GNUmakefile', 'makefile'],
    monacoLanguage: 'makefile',
    defaultCode: 'all:\n\t@echo "Hello"\n',
    execution: 'validate',
    runnerId: null,
    formatter: 'none',
    capabilities: { lsp: 'none', debugger: 'none' },
    templateIds: [],
  },
  {
    id: 'gitignore',
    labelKey: 'language.gitignore.label',
    shortLabelKey: 'language.gitignore.shortLabel',
    badgeClass: 'bg-stone-500/15 text-stone-300',
    textColorClass: 'text-stone-300',
    extensions: [],
    fileNames: ['.gitignore', '.dockerignore', '.npmignore'],
    monacoLanguage: 'shell',
    defaultCode: 'node_modules/\ndist/\n',
    execution: 'validate',
    runnerId: null,
    formatter: 'none',
    capabilities: { lsp: 'none', debugger: 'none' },
    templateIds: [],
  },
  {
    id: 'editorconfig',
    labelKey: 'language.editorconfig.label',
    shortLabelKey: 'language.editorconfig.shortLabel',
    badgeClass: 'bg-indigo-500/15 text-indigo-300',
    textColorClass: 'text-indigo-300',
    extensions: [],
    fileNames: ['.editorconfig'],
    monacoLanguage: 'ini',
    defaultCode: 'root = true\n\n[*]\nindent_style = space\nindent_size = 2\n',
    execution: 'validate',
    runnerId: null,
    formatter: 'none',
    capabilities: { lsp: 'none', debugger: 'none' },
    templateIds: [],
  },
  {
    id: 'shellscript',
    labelKey: 'language.shellscript.label',
    shortLabelKey: 'language.shellscript.shortLabel',
    badgeClass: 'bg-zinc-500/15 text-zinc-300',
    textColorClass: 'text-zinc-300',
    extensions: ['sh', 'bash', 'zsh'],
    fileNames: ['.bashrc', '.zshrc', '.bash_profile', '.profile'],
    monacoLanguage: 'shell',
    defaultCode: '#!/usr/bin/env bash\nset -euo pipefail\n\necho "Hello, World!"\n',
    execution: 'validate',
    runnerId: null,
    formatter: 'none',
    capabilities: { lsp: 'none', debugger: 'none' },
    templateIds: [],
  },
];

const PACK_BY_ID = new Map<string, LanguagePack>(LANGUAGE_PACKS.map((pack) => [pack.id, pack]));

const PACK_BY_EXTENSION = new Map<string, LanguagePack>();
for (const pack of LANGUAGE_PACKS) {
  for (const extension of pack.extensions) {
    PACK_BY_EXTENSION.set(extension.toLowerCase(), pack);
  }
}

const PACK_BY_FILE_NAME = new Map<string, LanguagePack>();
for (const pack of LANGUAGE_PACKS) {
  for (const fileName of pack.fileNames ?? []) {
    PACK_BY_FILE_NAME.set(fileName.toLowerCase(), pack);
  }
}

function normalizeExtension(value: string): string {
  return value.trim().replace(/^\./u, '').toLowerCase();
}

export function getLanguagePackById(id: string): LanguagePack | undefined {
  return PACK_BY_ID.get(id);
}

export function getLanguagePackForExtension(extension: string): LanguagePack | undefined {
  const normalized = normalizeExtension(extension);
  if (normalized.length === 0) return undefined;
  return PACK_BY_EXTENSION.get(normalized);
}

export function getLanguagePackForFileName(fileName: string): LanguagePack | undefined {
  return PACK_BY_FILE_NAME.get(fileName.toLowerCase());
}

/** Convenience helpers — all read from the pack so behavior stays single-sourced. */

export function monacoLanguageForPack(id: string, fallback = 'plaintext'): string {
  return getLanguagePackById(id)?.monacoLanguage ?? fallback;
}

export function executionModeForPack(
  id: string,
  fallback: LanguagePackExecution = 'view'
): LanguagePackExecution {
  return getLanguagePackById(id)?.execution ?? fallback;
}

export function formatterStrategyForPack(id: string): LanguagePackFormatter {
  return getLanguagePackById(id)?.formatter ?? 'none';
}

export function runnerIdForPack(id: string): string | null {
  return getLanguagePackById(id)?.runnerId ?? null;
}
