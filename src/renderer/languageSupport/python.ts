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
  loadEditorProviders: async () => {
    const [
      { createPythonCompletionProvider },
      { createPythonHoverProvider },
      { createPythonSignatureProvider },
    ] = await Promise.all([
      import('../components/Editor/completionProviders/pythonCompletions'),
      import('../components/Editor/completionProviders/pythonHoverProvider'),
      import('../components/Editor/completionProviders/pythonSignatureProvider'),
    ]);
    return {
      createCompletionProvider: createPythonCompletionProvider,
      createHoverProvider: createPythonHoverProvider,
      createSignatureHelpProvider: createPythonSignatureProvider,
    };
  },
  createLanguageIntelligenceAdapter: createPythonLanguageIntelligenceAdapter,
} satisfies LanguageSupportDescriptor;
