import { createRubyCompletionProvider } from '../components/Editor/completionProviders/rubyCompletions';
import { createRubyHoverProvider } from '../components/Editor/completionProviders/rubyHoverProvider';
import { createRubySignatureProvider } from '../components/Editor/completionProviders/rubySignatureProvider';
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
  createCompletionProvider: createRubyCompletionProvider,
  createHoverProvider: createRubyHoverProvider,
  createSignatureHelpProvider: createRubySignatureProvider,
  createLanguageIntelligenceAdapter: createRubyLanguageIntelligenceAdapter,
} satisfies LanguageSupportDescriptor;
