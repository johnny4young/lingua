import type { LanguageSupportDescriptor } from './types';

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
    return {
      createCompletionProvider: createRustCompletionProvider,
      createHoverProvider: createRustHoverProvider,
      createSignatureHelpProvider: createRustSignatureProvider,
    };
  },
} satisfies LanguageSupportDescriptor;
