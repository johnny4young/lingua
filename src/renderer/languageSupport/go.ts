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
    const [
      { createGoCompletionProvider },
      { createGoHoverProvider },
      { createGoSignatureProvider },
    ] = await Promise.all([
      import('../components/Editor/completionProviders/goCompletions'),
      import('../components/Editor/completionProviders/goHoverProvider'),
      import('../components/Editor/completionProviders/goSignatureProvider'),
    ]);
    const [{ createLspNavigationProviders }, { getGoLspAdapter, isGoLspAvailable }] =
      await Promise.all([
        import('../components/Editor/completionProviders/lspNavigationProvider'),
        import('../languageIntelligence/goAdapterSingleton'),
      ]);
    return {
      createDefinitionProvider: monaco =>
        createLspNavigationProviders(monaco, 'go', isGoLspAvailable, getGoLspAdapter).definition,
      createReferenceProvider: monaco =>
        createLspNavigationProviders(monaco, 'go', isGoLspAvailable, getGoLspAdapter).references,
      createCompletionProvider: createGoCompletionProvider,
      createHoverProvider: createGoHoverProvider,
      createSignatureHelpProvider: createGoSignatureProvider,
    };
  },
} satisfies LanguageSupportDescriptor;
