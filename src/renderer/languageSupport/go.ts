import type { LanguageSupportDescriptor } from './types';

export const goLanguageSupport = {
  id: 'go',
  monaco: {
    id: 'go',
    extensions: ['.go'],
    aliases: ['Go'],
    basicLanguage: 'go',
  },
  loadEditorProviders: async () => {
    const [{ createGoCompletionProvider }, { createGoHoverProvider }, { createGoSignatureProvider }] =
      await Promise.all([
        import('../components/Editor/completionProviders/goCompletions'),
        import('../components/Editor/completionProviders/goHoverProvider'),
        import('../components/Editor/completionProviders/goSignatureProvider'),
      ]);
    return {
      createCompletionProvider: createGoCompletionProvider,
      createHoverProvider: createGoHoverProvider,
      createSignatureHelpProvider: createGoSignatureProvider,
    };
  },
} satisfies LanguageSupportDescriptor;
