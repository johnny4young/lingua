import type { LanguageSupportDescriptor } from './types';
// Already in the startup graph through the LSP lifecycle hook.
import { getRustLspAdapter, isRustLspAvailable } from '../languageIntelligence/rustAdapterSingleton';

export const rustLanguageSupport = {
  id: 'rust',
  monaco: {
    id: 'rust',
    extensions: ['.rs'],
    aliases: ['Rust'],
    basicLanguage: 'rust',
  },
  loadEditorProviders: async () => {
    const [
      { createRustCompletionProvider },
      { createRustHoverProvider },
      { createRustSignatureProvider },
    ] = await Promise.all([
      import('../components/Editor/completionProviders/rustCompletions'),
      import('../components/Editor/completionProviders/rustHoverProvider'),
      import('../components/Editor/completionProviders/rustSignatureProvider'),
    ]);
    const { createLspNavigationProviders } = await import(
      '../components/Editor/completionProviders/lspNavigationProvider'
    );
    return {
      createDefinitionProvider: monaco =>
        createLspNavigationProviders(monaco, 'rust', isRustLspAvailable, getRustLspAdapter)
          .definition,
      createReferenceProvider: monaco =>
        createLspNavigationProviders(monaco, 'rust', isRustLspAvailable, getRustLspAdapter)
          .references,
      createCompletionProvider: createRustCompletionProvider,
      createHoverProvider: createRustHoverProvider,
      createSignatureHelpProvider: createRustSignatureProvider,
    };
  },
} satisfies LanguageSupportDescriptor;
