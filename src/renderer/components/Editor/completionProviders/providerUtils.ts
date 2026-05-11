import type { Monaco } from '@monaco-editor/react';

export interface CompletionDefinition {
  label: string;
  detail: string;
  documentation?: string;
  insertText?: string;
  kind?: 'keyword' | 'snippet' | 'function' | 'class' | 'module' | 'variable';
}

interface CompletionProviderOptions {
  triggerCharacters?: readonly string[];
  getDynamicDefinitions?: (
    model: CompletionModel,
    position: CompletionPosition
  ) => readonly CompletionDefinition[];
}

type CompletionProvider = Parameters<
  Monaco['languages']['registerCompletionItemProvider']
>[1];
type ProvideCompletionItems = NonNullable<
  CompletionProvider['provideCompletionItems']
>;
type CompletionModel = Parameters<ProvideCompletionItems>[0];
type CompletionPosition = Parameters<ProvideCompletionItems>[1];

function mapCompletionKind(
  monaco: Monaco,
  kind: CompletionDefinition['kind']
): Monaco['languages']['CompletionItemKind'][keyof Monaco['languages']['CompletionItemKind']] {
  switch (kind) {
    case 'snippet':
      return monaco.languages.CompletionItemKind.Snippet;
    case 'function':
      return monaco.languages.CompletionItemKind.Function;
    case 'class':
      return monaco.languages.CompletionItemKind.Class;
    case 'module':
      return monaco.languages.CompletionItemKind.Module;
    case 'variable':
      return monaco.languages.CompletionItemKind.Variable;
    case 'keyword':
    default:
      return monaco.languages.CompletionItemKind.Keyword;
  }
}

function mergeDefinitions(
  baseDefinitions: readonly CompletionDefinition[],
  dynamicDefinitions: readonly CompletionDefinition[]
): CompletionDefinition[] {
  const seen = new Set<string>();
  const merged: CompletionDefinition[] = [];

  for (const definition of [...dynamicDefinitions, ...baseDefinitions]) {
    if (seen.has(definition.label)) continue;
    seen.add(definition.label);
    merged.push(definition);
  }

  return merged;
}

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
      const dynamicDefinitions = options.getDynamicDefinitions?.(model, position) ?? [];
      const mergedDefinitions = mergeDefinitions(definitions, dynamicDefinitions);

      return {
        suggestions: mergedDefinitions.map((definition) => {
          const isSnippet = definition.kind === 'snippet';

          return {
            label: definition.label,
            kind: mapCompletionKind(monaco, definition.kind),
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
