import type { LanguageSupportDescriptor } from './types';

export const javascriptLanguageSupport = {
  id: 'javascript',
  monaco: {
    id: 'javascript',
    extensions: ['.js', '.jsx', '.mjs', '.cjs'],
    aliases: ['JavaScript', 'javascript'],
    loader: () =>
      import('monaco-editor/esm/vs/basic-languages/javascript/javascript.js'),
  },
} satisfies LanguageSupportDescriptor;
