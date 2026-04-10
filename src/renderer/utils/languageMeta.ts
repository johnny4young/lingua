import type { BuiltInLanguage, Language } from '../types';
import { pluginRegistry } from '../plugins';

type LanguageMeta = {
  label: string;
  shortLabel: string;
  badgeClass: string;
  textColorClass: string;
  extension: string;
  monacoLanguage: string;
  defaultCode: string;
};

const BUILT_IN_LANGUAGE_META: Record<BuiltInLanguage, LanguageMeta> = {
  javascript: {
    label: 'JavaScript',
    shortLabel: 'JS',
    badgeClass: 'bg-yellow-500/20 text-yellow-400',
    textColorClass: 'text-yellow-400',
    extension: 'js',
    monacoLanguage: 'javascript',
    defaultCode: '// Welcome to RunLang\nconsole.log("Hello, World!");\n',
  },
  typescript: {
    label: 'TypeScript',
    shortLabel: 'TS',
    badgeClass: 'bg-blue-500/20 text-blue-400',
    textColorClass: 'text-blue-400',
    extension: 'ts',
    monacoLanguage: 'typescript',
    defaultCode:
      '// Welcome to RunLang\nconst greeting: string = "Hello, World!";\nconsole.log(greeting);\n',
  },
  go: {
    label: 'Go',
    shortLabel: 'Go',
    badgeClass: 'bg-cyan-500/20 text-cyan-400',
    textColorClass: 'text-cyan-400',
    extension: 'go',
    monacoLanguage: 'go',
    defaultCode:
      '// Welcome to RunLang\npackage main\n\nimport "fmt"\n\nfunc main() {\n\tfmt.Println("Hello, World!")\n}\n',
  },
  python: {
    label: 'Python',
    shortLabel: 'Py',
    badgeClass: 'bg-green-500/20 text-green-400',
    textColorClass: 'text-green-400',
    extension: 'py',
    monacoLanguage: 'python',
    defaultCode: '# Welcome to RunLang\nprint("Hello, World!")\n',
  },
  rust: {
    label: 'Rust',
    shortLabel: 'Rs',
    badgeClass: 'bg-orange-500/20 text-orange-400',
    textColorClass: 'text-orange-400',
    extension: 'rs',
    monacoLanguage: 'rust',
    defaultCode:
      '// Welcome to RunLang\nfn main() {\n    println!("Hello, World!");\n}\n',
  },
};

const FALLBACK_META: LanguageMeta = {
  label: 'Text',
  shortLabel: 'TXT',
  badgeClass: 'bg-surface-strong text-muted-strong',
  textColorClass: 'text-muted',
  extension: 'txt',
  monacoLanguage: 'plaintext',
  defaultCode: '',
};

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
    extension,
    monacoLanguage: plugin.monacoLanguage ?? 'plaintext',
    defaultCode: plugin.defaultCode ?? '',
  };
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
  return getLanguageMeta(language).extension;
}

export function monacoLanguageFor(language: Language): string {
  return getLanguageMeta(language).monacoLanguage;
}

export function defaultCodeForLanguage(language: Language): string {
  return getLanguageMeta(language).defaultCode;
}
