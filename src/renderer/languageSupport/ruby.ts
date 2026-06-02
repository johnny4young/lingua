import { createRubyLanguageIntelligenceAdapter } from '../languageIntelligence/ruby';
import type { LanguageSupportDescriptor } from './types';

export const rubyLanguageSupport = {
  id: 'ruby',
  monaco: {
    id: 'ruby',
    extensions: ['.rb'],
    aliases: ['Ruby', 'ruby'],
    loader: () => import('monaco-editor/esm/vs/basic-languages/ruby/ruby.js'),
  },
  loadEditorProviders: async () => {
    const [
      { createRubyCompletionProvider },
      { createRubyHoverProvider },
      { createRubySignatureProvider },
    ] = await Promise.all([
      import('../components/Editor/completionProviders/rubyCompletions'),
      import('../components/Editor/completionProviders/rubyHoverProvider'),
      import('../components/Editor/completionProviders/rubySignatureProvider'),
    ]);
    return {
      createCompletionProvider: createRubyCompletionProvider,
      createHoverProvider: createRubyHoverProvider,
      createSignatureHelpProvider: createRubySignatureProvider,
    };
  },
  createLanguageIntelligenceAdapter: createRubyLanguageIntelligenceAdapter,
} satisfies LanguageSupportDescriptor;
