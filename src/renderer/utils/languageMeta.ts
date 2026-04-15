import type { BuiltInLanguage, Language } from '../types';
import { pluginRegistry } from '../plugins';

type LanguageMeta = {
  label: string;
  shortLabel: string;
  badgeClass: string;
  textColorClass: string;
  extensions: readonly string[];
  monacoLanguage: string;
  defaultCode: string;
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
  },
  python: {
    label: 'Python',
    shortLabel: 'Py',
    badgeClass: 'bg-green-500/20 text-green-400',
    textColorClass: 'text-green-400',
    extensions: ['py'],
    monacoLanguage: 'python',
    defaultCode: '# Welcome to Lingua\nprint("Hello, World!")\n',
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
