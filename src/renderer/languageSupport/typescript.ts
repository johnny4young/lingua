import type { LanguageSupportDescriptor } from './types';

export const typescriptLanguageSupport = {
  id: 'typescript',
  monaco: {
    id: 'typescript',
    extensions: ['.ts', '.tsx'],
    aliases: ['TypeScript', 'typescript'],
    loader: () =>
      import('monaco-editor/esm/vs/basic-languages/typescript/typescript.js'),
  },
} satisfies LanguageSupportDescriptor;
