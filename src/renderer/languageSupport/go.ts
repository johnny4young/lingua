import type { LanguageSupportDescriptor } from './types';
// Already in the startup graph through the LSP lifecycle hook.
import { getGoLspAdapter, isGoLspAvailable } from '../languageIntelligence/goAdapterSingleton';

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
    const { createLspNavigationProviders } = await import(
      '../components/Editor/completionProviders/lspNavigationProvider'
    );
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
