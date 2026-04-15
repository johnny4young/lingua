import type { Monaco } from '@monaco-editor/react';

export interface CompletionDefinition {
  label: string;
  detail: string;
  documentation?: string;
  insertText?: string;
  kind?: 'keyword' | 'snippet';
}

interface CompletionProviderOptions {
  triggerCharacters?: readonly string[];
}

type CompletionProvider = Parameters<
  Monaco['languages']['registerCompletionItemProvider']
>[1];
type ProvideCompletionItems = NonNullable<
  CompletionProvider['provideCompletionItems']
>;
type CompletionModel = Parameters<ProvideCompletionItems>[0];
type CompletionPosition = Parameters<ProvideCompletionItems>[1];

export function createCompletionProvider(
  monaco: Monaco,
  definitions: readonly CompletionDefinition[],
  options: CompletionProviderOptions = {}
): CompletionProvider {
  return {
    triggerCharacters: options.triggerCharacters
      ? [...options.triggerCharacters]
      : undefined,
    provideCompletionItems(
      model: CompletionModel,
      position: CompletionPosition
    ) {
      const word = model.getWordUntilPosition(position);
      const range = {
        startLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endLineNumber: position.lineNumber,
        endColumn: word.endColumn,
      };

      return {
        suggestions: definitions.map((definition) => {
          const isSnippet = definition.kind === 'snippet';

          return {
            label: definition.label,
            kind: isSnippet
              ? monaco.languages.CompletionItemKind.Snippet
              : monaco.languages.CompletionItemKind.Keyword,
            detail: definition.detail,
            documentation: definition.documentation,
            insertText: definition.insertText ?? definition.label,
            insertTextRules: isSnippet
              ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
              : undefined,
            range,
          };
        }),
      };
    },
  };
}
