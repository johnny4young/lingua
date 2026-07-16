import type { LanguageSupportDescriptor } from './types';

export const javascriptLanguageSupport = {
  id: 'javascript',
  monaco: {
    id: 'javascript',
    extensions: ['.js', '.jsx', '.mjs', '.cjs'],
    aliases: ['JavaScript', 'javascript'],
    loader: () => import('monaco-editor/esm/vs/basic-languages/javascript/javascript.js'),
  },
  loadEditorProviders: async () => {
    const { createMagicCommentCompletionProvider, createMagicCommentHoverProvider } =
      await import('../components/Editor/completionProviders/magicCommentProviders');
    return {
      createCompletionProvider: monaco =>
        createMagicCommentCompletionProvider(monaco, 'javascript'),
      createHoverProvider: () => createMagicCommentHoverProvider('javascript'),
    };
  },
} satisfies LanguageSupportDescriptor;
