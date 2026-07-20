import type { Monaco } from '@monaco-editor/react';
import {
  getGoLspAdapter,
  isGoLspAvailable,
} from '../../../languageIntelligence/goAdapterSingleton';
import { createCompletionProvider, type CompletionDefinition } from './providerUtils';

const GO_COMPLETIONS = [
  { label: 'package', detail: 'Go keyword' },
  { label: 'import', detail: 'Go keyword' },
  { label: 'var', detail: 'Go keyword' },
  { label: 'const', detail: 'Go keyword' },
  { label: 'type', detail: 'Go keyword' },
  { label: 'struct', detail: 'Go keyword' },
  { label: 'interface', detail: 'Go keyword' },
  { label: 'defer', detail: 'Go keyword' },
  { label: 'go', detail: 'Go keyword' },
  { label: 'select', detail: 'Go keyword' },
  { label: 'switch', detail: 'Go keyword' },
  { label: 'case', detail: 'Go keyword' },
  { label: 'return', detail: 'Go keyword' },
  { label: 'fmt.Println', detail: 'Write a line to stdout' },
  { label: 'fmt.Sprintf', detail: 'Build a formatted string' },
  { label: 'make', detail: 'Create slices, maps, and channels' },
  { label: 'len', detail: 'Return collection length' },
  { label: 'append', detail: 'Append items to a slice' },
  {
    label: 'func',
    kind: 'snippet',
    detail: 'Go function declaration',
    insertText: ['func ${1:name}(${2:args}) {', '\t${0}', '}'].join('\n'),
  },
  {
    label: 'if err != nil',
    kind: 'snippet',
    detail: 'Go error guard',
    insertText: ['if err != nil {', '\treturn ${0:err}', '}'].join('\n'),
  },
  {
    label: 'for range',
    kind: 'snippet',
    detail: 'Go range loop',
    insertText: [
      'for ${1:index}, ${2:value} := range ${3:collection} {',
      '\t${0}',
      '}',
    ].join('\n'),
  },
] as const;

/**
 * implementation — Monaco completion provider for Go.
 *
 * Layered strategy mirroring `rustCompletions.ts`:
 *  - Static `GO_COMPLETIONS` keep keyword + snippet suggestions
 *    available even when gopls hasn't booted yet (or is indexing).
 *  - When the LSP is up and the document is registered, the provider
 *    also returns gopls's semantic completions (methods, fields,
 *    imported packages). Monaco merges both lists; duplicates by
 *    label collapse.
 */
type GoProvider = Parameters<Monaco['languages']['registerCompletionItemProvider']>[1];
type GoProvideCompletionItems = NonNullable<GoProvider['provideCompletionItems']>;
type GoCompletionModel = Parameters<GoProvideCompletionItems>[0];
type GoCompletionPosition = Parameters<GoProvideCompletionItems>[1];
type GoCompletionContext = Parameters<GoProvideCompletionItems>[2];
type GoCompletionToken = Parameters<GoProvideCompletionItems>[3];

export function createGoCompletionProvider(monaco: Monaco): GoProvider {
  const baseProvider = createCompletionProvider(monaco, GO_COMPLETIONS, {
    triggerCharacters: ['.', '(', ':'],
  });

  return {
    ...baseProvider,
    async provideCompletionItems(
      model: GoCompletionModel,
      position: GoCompletionPosition,
      context: GoCompletionContext,
      token: GoCompletionToken
    ) {
      const baseResult =
        baseProvider.provideCompletionItems?.(model, position, context, token) ?? {
          suggestions: [],
        };
      const baseAwaited = await Promise.resolve(baseResult);
      if (!baseAwaited) {
        return { suggestions: [] };
      }

      if (!isGoLspAvailable()) return baseAwaited;
      const adapter = getGoLspAdapter();
      if (!adapter) return baseAwaited;

      const uri = model.uri.toString();
      adapter.openDocument(uri, model.getValue());

      let lspCompletions: CompletionDefinition[];
      try {
        const items = await adapter.provideCompletions(
          uri,
          position.lineNumber,
          position.column
        );
        lspCompletions = items.map((item) => ({
          label: item.label,
          detail: item.detail,
          documentation: item.documentation,
          insertText: item.insertText ?? item.label,
          kind: item.kind,
        }));
      } catch {
        return baseAwaited;
      }

      if (lspCompletions.length === 0) return baseAwaited;

      const word = model.getWordUntilPosition(position);
      const range = {
        startLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endLineNumber: position.lineNumber,
        endColumn: word.endColumn,
      };

      const seen = new Set<string>(
        baseAwaited.suggestions.map(
          (suggestion: { label: string | { label: string } }) =>
            typeof suggestion.label === 'string' ? suggestion.label : suggestion.label.label
        )
      );
      const merged = [...baseAwaited.suggestions];
      for (const item of lspCompletions) {
        if (typeof item.label !== 'string' || seen.has(item.label)) continue;
        seen.add(item.label);
        const kind = mapKind(monaco, item.kind);
        merged.push({
          label: item.label,
          kind,
          detail: item.detail,
          documentation: item.documentation,
          insertText: item.insertText ?? item.label,
          range,
        });
      }
      return { suggestions: merged };
    },
  };
}

function mapKind(
  monaco: Monaco,
  kind: CompletionDefinition['kind']
): Monaco['languages']['CompletionItemKind'][keyof Monaco['languages']['CompletionItemKind']] {
  switch (kind) {
    case 'function':
      return monaco.languages.CompletionItemKind.Function;
    case 'class':
      return monaco.languages.CompletionItemKind.Class;
    case 'module':
      return monaco.languages.CompletionItemKind.Module;
    case 'variable':
      return monaco.languages.CompletionItemKind.Variable;
    case 'snippet':
      return monaco.languages.CompletionItemKind.Snippet;
    default:
      return monaco.languages.CompletionItemKind.Keyword;
  }
}
