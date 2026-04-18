import type * as monaco from 'monaco-editor';

export const dotenvLanguage: monaco.languages.IMonarchLanguage = {
  tokenizer: {
    root: [
      [/^\s*#.*$/, 'comment'],
      [/^\s*export\b/, 'keyword'],
      [/[A-Za-z_][A-Za-z0-9_]*(?=\s*=)/, 'key'],
      [/=/, 'delimiter'],
      [/".*?"/, 'string'],
      [/'.*?'/, 'string'],
      [/\$\{?[A-Za-z_][A-Za-z0-9_]*\}?/, 'variable'],
      [/[^\s#]+/, 'string'],
    ],
  },
};

export const dotenvConfiguration: monaco.languages.LanguageConfiguration = {
  comments: {
    lineComment: '#',
  },
};

export const tomlLanguage: monaco.languages.IMonarchLanguage = {
  tokenizer: {
    root: [
      [/^\s*#.*$/, 'comment'],
      [/\[[^\]]+\]/, 'keyword'],
      [/[A-Za-z0-9_.-]+(?=\s*=)/, 'key'],
      [/=/, 'delimiter'],
      [/"(?:[^"\\]|\\.)*"/, 'string'],
      [/'(?:[^'\\]|\\.)*'/, 'string'],
      [/\b(true|false)\b/, 'keyword'],
      [/\b\d+(\.\d+)?\b/, 'number'],
      [/[{},]/, 'delimiter'],
    ],
  },
};

export const tomlConfiguration: monaco.languages.LanguageConfiguration = {
  comments: {
    lineComment: '#',
  },
  brackets: [
    ['[', ']'],
    ['{', '}'],
  ],
};

export const csvLanguage: monaco.languages.IMonarchLanguage = {
  tokenizer: {
    root: [
      [/"([^"]|"")*"/, 'string'],
      [/[^,\r\n]+/, 'identifier'],
      [/,/, 'delimiter'],
    ],
  },
};

export const csvConfiguration: monaco.languages.LanguageConfiguration = {};

export const makefileLanguage: monaco.languages.IMonarchLanguage = {
  tokenizer: {
    root: [
      [/^\s*#.*$/, 'comment'],
      [
        /^\s*(include|-include|sinclude|ifeq|ifneq|ifdef|ifndef|else|endif|define|endef|override|export|unexport|private)\b/,
        'keyword',
      ],
      [/^\t.*$/, 'string'],
      [/[A-Za-z_][A-Za-z0-9_]*(?=\s*[:+?]?=)/, 'key'],
      [/\$\([^)]+\)|\$\{[^}]+\}/, 'variable'],
      [/^[^:=#\s][^:=#]*(?=\s*:)/, 'type.identifier'],
      [/[:+?]?=/, 'delimiter'],
      [/:/, 'delimiter'],
    ],
  },
};

export const makefileConfiguration: monaco.languages.LanguageConfiguration = {
  comments: {
    lineComment: '#',
  },
};
