import { createGoCompletionProvider } from '../components/Editor/completionProviders/goCompletions';
import { createGoHoverProvider } from '../components/Editor/completionProviders/goHoverProvider';
import { createGoSignatureProvider } from '../components/Editor/completionProviders/goSignatureProvider';
import type { LanguageSupportDescriptor } from './types';

export const goLanguageSupport = {
  id: 'go',
  monaco: {
    id: 'go',
    extensions: ['.go'],
    aliases: ['Go'],
    loader: () => import('monaco-editor/esm/vs/basic-languages/go/go.js'),
  },
  createCompletionProvider: createGoCompletionProvider,
  createHoverProvider: createGoHoverProvider,
  createSignatureHelpProvider: createGoSignatureProvider,
} satisfies LanguageSupportDescriptor;
