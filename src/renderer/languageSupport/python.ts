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
      { createMagicCommentCompletionProvider, createMagicCommentHoverProvider },
    ] = await Promise.all([
      import('../components/Editor/completionProviders/pythonCompletions'),
      import('../components/Editor/completionProviders/pythonHoverProvider'),
      import('../components/Editor/completionProviders/pythonSignatureProvider'),
      import('../components/Editor/completionProviders/magicCommentProviders'),
    ]);
    return {
      createCompletionProvider: createPythonCompletionProvider,
      createCompletionProviders: [monaco => createMagicCommentCompletionProvider(monaco, 'python')],
      createHoverProvider: createPythonHoverProvider,
      createHoverProviders: [() => createMagicCommentHoverProvider('python')],
      createSignatureHelpProvider: createPythonSignatureProvider,
    };
  },
  createLanguageIntelligenceAdapter: createPythonLanguageIntelligenceAdapter,
} satisfies LanguageSupportDescriptor;
