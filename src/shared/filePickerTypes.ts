const OPENABLE_FILE_EXTENSIONS = [
  'js',
  'jsx',
  'mjs',
  'cjs',
  'ts',
  'tsx',
  'go',
  'py',
  'rs',
  'lua',
  'txt',
  'md',
  'json',
  'css',
  'scss',
  'html',
  'htm',
  'xml',
  'yaml',
  'yml',
  'toml',
  'sh',
] as const;

const OPENABLE_FILE_SUFFIXES = OPENABLE_FILE_EXTENSIONS.map((extension) => `.${extension}`);

export const OPEN_FILE_FILTERS = [
  {
    name: 'Code and text files',
    extensions: [...OPENABLE_FILE_EXTENSIONS],
  },
] as const;

export const OPEN_FILE_PICKER_TYPES = [
  {
    description: 'Code and text files',
    accept: {
      'text/plain': OPENABLE_FILE_SUFFIXES,
    },
  },
] as const;
