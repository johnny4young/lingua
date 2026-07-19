import type { LanguageSupportDescriptor } from './types';

export const typescriptLanguageSupport = {
  id: 'typescript',
  monaco: {
    id: 'typescript',
    extensions: ['.ts', '.tsx'],
    aliases: ['TypeScript', 'typescript'],
    basicLanguage: 'typescript',
  },
  loadEditorProviders: async () => {
    const { createMagicCommentCompletionProvider, createMagicCommentHoverProvider } =
      await import('../components/Editor/completionProviders/magicCommentProviders');
    return {
      createCompletionProvider: monaco =>
        createMagicCommentCompletionProvider(monaco, 'typescript'),
      createHoverProvider: () => createMagicCommentHoverProvider('typescript'),
    };
  },
} satisfies LanguageSupportDescriptor;
