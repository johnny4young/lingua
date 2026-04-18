import type { BuiltInLanguage, Language } from '../types';
import { pluginRegistry } from '../plugins';

type LanguageMeta = {
  label: string;
  shortLabel: string;
  badgeClass: string;
  textColorClass: string;
  extensions: readonly string[];
  fileNames?: readonly string[];
  monacoLanguage: string;
  defaultCode: string;
  executionMode: 'run' | 'validate' | 'view';
};

const BUILT_IN_LANGUAGE_META: Record<BuiltInLanguage, LanguageMeta> = {
  javascript: {
    label: 'JavaScript',
    shortLabel: 'JS',
    badgeClass: 'bg-yellow-500/20 text-yellow-400',
    textColorClass: 'text-yellow-400',
    extensions: ['js', 'jsx', 'mjs', 'cjs'],
    monacoLanguage: 'javascript',
    defaultCode: '// Welcome to Lingua\nconsole.log("Hello, World!");\n',
    executionMode: 'run',
  },
  typescript: {
    label: 'TypeScript',
    shortLabel: 'TS',
    badgeClass: 'bg-blue-500/20 text-blue-400',
    textColorClass: 'text-blue-400',
    extensions: ['ts', 'tsx'],
    monacoLanguage: 'typescript',
    defaultCode:
      '// Welcome to Lingua\nconst greeting: string = "Hello, World!";\nconsole.log(greeting);\n',
    executionMode: 'run',
  },
  go: {
    label: 'Go',
    shortLabel: 'Go',
    badgeClass: 'bg-cyan-500/20 text-cyan-400',
    textColorClass: 'text-cyan-400',
    extensions: ['go'],
    monacoLanguage: 'go',
    defaultCode:
      '// Welcome to Lingua\npackage main\n\nimport "fmt"\n\nfunc main() {\n\tfmt.Println("Hello, World!")\n}\n',
    executionMode: 'run',
  },
  python: {
    label: 'Python',
    shortLabel: 'Py',
    badgeClass: 'bg-green-500/20 text-green-400',
    textColorClass: 'text-green-400',
    extensions: ['py'],
    monacoLanguage: 'python',
    defaultCode: '# Welcome to Lingua\nprint("Hello, World!")\n',
    executionMode: 'run',
  },
  rust: {
    label: 'Rust',
    shortLabel: 'Rs',
    badgeClass: 'bg-orange-500/20 text-orange-400',
    textColorClass: 'text-orange-400',
    extensions: ['rs'],
    monacoLanguage: 'rust',
    defaultCode:
      '// Welcome to Lingua\nfn main() {\n    println!("Hello, World!");\n}\n',
    executionMode: 'run',
  },
  json: {
    label: 'JSON',
    shortLabel: 'JSON',
    badgeClass: 'bg-emerald-500/15 text-emerald-300',
    textColorClass: 'text-emerald-300',
    extensions: ['json'],
    monacoLanguage: 'json',
    defaultCode: '{\n  "name": "lingua"\n}\n',
    executionMode: 'validate',
  },
  yaml: {
    label: 'YAML',
    shortLabel: 'YML',
    badgeClass: 'bg-teal-500/15 text-teal-300',
    textColorClass: 'text-teal-300',
    extensions: ['yaml', 'yml'],
    monacoLanguage: 'yaml',
    defaultCode: 'name: lingua\n',
    executionMode: 'validate',
  },
  dotenv: {
    label: '.env',
    shortLabel: 'ENV',
    badgeClass: 'bg-lime-500/15 text-lime-300',
    textColorClass: 'text-lime-300',
    extensions: ['env'],
    fileNames: ['.env'],
    monacoLanguage: 'dotenv',
    defaultCode: 'NODE_ENV=development\n',
    executionMode: 'validate',
  },
  toml: {
    label: 'TOML',
    shortLabel: 'TOML',
    badgeClass: 'bg-amber-500/15 text-amber-300',
    textColorClass: 'text-amber-300',
    extensions: ['toml'],
    monacoLanguage: 'toml',
    defaultCode: 'title = "Lingua"\n',
    executionMode: 'view',
  },
  ini: {
    label: 'INI',
    shortLabel: 'INI',
    badgeClass: 'bg-sky-500/15 text-sky-300',
    textColorClass: 'text-sky-300',
    extensions: ['ini', 'cfg', 'conf'],
    monacoLanguage: 'ini',
    defaultCode: '[section]\nkey=value\n',
    executionMode: 'view',
  },
  csv: {
    label: 'CSV',
    shortLabel: 'CSV',
    badgeClass: 'bg-rose-500/15 text-rose-300',
    textColorClass: 'text-rose-300',
    extensions: ['csv'],
    monacoLanguage: 'csv',
    defaultCode: 'name,value\nexample,1\n',
    executionMode: 'validate',
  },
  dockerfile: {
    label: 'Dockerfile',
    shortLabel: 'DKR',
    badgeClass: 'bg-sky-500/15 text-sky-300',
    textColorClass: 'text-sky-300',
    // Dockerfiles commonly ship as `Dockerfile` or `Dockerfile.dev` and the
    // `.dockerfile` extension also exists in the wild.
    extensions: ['dockerfile'],
    fileNames: ['Dockerfile', 'Containerfile'],
    monacoLanguage: 'dockerfile',
    defaultCode: 'FROM node:20\nWORKDIR /app\n',
    executionMode: 'validate',
  },
  makefile: {
    label: 'Makefile',
    shortLabel: 'MK',
    badgeClass: 'bg-amber-500/15 text-amber-300',
    textColorClass: 'text-amber-300',
    extensions: ['mk', 'mak'],
    fileNames: ['Makefile', 'GNUmakefile', 'makefile'],
    monacoLanguage: 'makefile',
    defaultCode: 'all:\n\t@echo "Hello"\n',
    executionMode: 'view',
  },
  gitignore: {
    label: 'Gitignore',
    shortLabel: 'GI',
    badgeClass: 'bg-stone-500/15 text-stone-300',
    textColorClass: 'text-stone-300',
    extensions: [],
    fileNames: ['.gitignore', '.dockerignore', '.npmignore'],
    // Monaco doesn't ship a dedicated gitignore mode; `shell` gives a passable
    // comment+pattern highlight while staying honest about the lack of a real
    // grammar.
    monacoLanguage: 'shell',
    defaultCode: 'node_modules/\ndist/\n',
    executionMode: 'view',
  },
  editorconfig: {
    label: 'EditorConfig',
    shortLabel: 'EC',
    badgeClass: 'bg-indigo-500/15 text-indigo-300',
    textColorClass: 'text-indigo-300',
    extensions: [],
    fileNames: ['.editorconfig'],
    // EditorConfig's grammar is INI-compatible.
    monacoLanguage: 'ini',
    defaultCode: 'root = true\n\n[*]\nindent_style = space\nindent_size = 2\n',
    executionMode: 'validate',
  },
};

const FALLBACK_META: LanguageMeta = {
  label: 'Text',
  shortLabel: 'TXT',
  badgeClass: 'bg-surface-strong text-muted-strong',
  textColorClass: 'text-muted',
  extensions: ['txt'],
  monacoLanguage: 'plaintext',
  defaultCode: '',
  executionMode: 'view',
};
const FALLBACK_EXTENSION = 'txt';

const BUILT_IN_LANGUAGE_BY_EXTENSION = new Map<string, BuiltInLanguage>(
  Object.entries(BUILT_IN_LANGUAGE_META).flatMap(([language, meta]) =>
    meta.extensions.map((extension) => [extension, language as BuiltInLanguage])
  )
);

function normalizeExtension(extension: string): string {
  return extension.trim().replace(/^\./u, '').toLowerCase();
}

export function getLanguageMeta(language: Language): LanguageMeta {
  if (language in BUILT_IN_LANGUAGE_META) {
    return BUILT_IN_LANGUAGE_META[language as BuiltInLanguage];
  }

  const plugin = pluginRegistry.getByLanguage(language);
  if (!plugin) return FALLBACK_META;

  const extension = plugin.extensions[0]?.replace(/^\./, '') || 'txt';
  const shortLabel = plugin.name.slice(0, 3).toUpperCase();

  return {
    label: plugin.name,
    shortLabel,
    badgeClass: FALLBACK_META.badgeClass,
    textColorClass: FALLBACK_META.textColorClass,
    extensions: [extension],
    monacoLanguage: plugin.monacoLanguage ?? 'plaintext',
    defaultCode: plugin.defaultCode ?? '',
    executionMode: 'run',
  };
}

export function languageForExtension(extension: string): Language | undefined {
  return BUILT_IN_LANGUAGE_BY_EXTENSION.get(normalizeExtension(extension));
}

export function languageLabel(language: Language): string {
  return getLanguageMeta(language).label;
}

export function languageShortLabel(language: Language): string {
  return getLanguageMeta(language).shortLabel;
}

export function languageBadgeClass(language: Language): string {
  return getLanguageMeta(language).badgeClass;
}

export function languageTextColorClass(language: Language): string {
  return getLanguageMeta(language).textColorClass;
}

export function extensionForLanguage(language: Language): string {
  return getLanguageMeta(language).extensions[0] ?? FALLBACK_EXTENSION;
}

export function monacoLanguageFor(language: Language): string {
  return getLanguageMeta(language).monacoLanguage;
}

export function defaultCodeForLanguage(language: Language): string {
  return getLanguageMeta(language).defaultCode;
}

export function executionModeForLanguage(language: Language): 'run' | 'validate' | 'view' {
  return getLanguageMeta(language).executionMode;
}

export function languageSupportsFileName(language: Language, fileName: string): boolean {
  const normalized = fileName.toLowerCase();
  const fileNames = getLanguageMeta(language).fileNames ?? [];

  return fileNames.some((candidate) => candidate.toLowerCase() === normalized);
}
