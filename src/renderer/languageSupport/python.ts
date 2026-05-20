import { createPythonCompletionProvider } from '../components/Editor/completionProviders/pythonCompletions';
import { createPythonHoverProvider } from '../components/Editor/completionProviders/pythonHoverProvider';
import { createPythonSignatureProvider } from '../components/Editor/completionProviders/pythonSignatureProvider';
import { createPythonLanguageIntelligenceAdapter } from '../languageIntelligence/python';
import type { LanguageSupportDescriptor } from './types';

export const pythonLanguageSupport = {
  id: 'python',
  monaco: {
    id: 'python',
    extensions: ['.py'],
    aliases: ['Python'],
    loader: () => import('monaco-editor/esm/vs/basic-languages/python/python.js'),
  },
  createCompletionProvider: createPythonCompletionProvider,
  createHoverProvider: createPythonHoverProvider,
  createSignatureHelpProvider: createPythonSignatureProvider,
  createLanguageIntelligenceAdapter: createPythonLanguageIntelligenceAdapter,
} satisfies LanguageSupportDescriptor;
