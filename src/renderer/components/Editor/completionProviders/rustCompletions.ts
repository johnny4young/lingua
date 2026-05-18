import type { Monaco } from '@monaco-editor/react';
import {
  getRustLspAdapter,
  isRustLspAvailable,
} from '../../../languageIntelligence/rustAdapterSingleton';
import { createCompletionProvider, type CompletionDefinition } from './providerUtils';

const RUST_COMPLETIONS = [
  { label: 'let', detail: 'Rust keyword' },
  { label: 'mut', detail: 'Rust keyword' },
  { label: 'struct', detail: 'Rust keyword' },
  { label: 'enum', detail: 'Rust keyword' },
  { label: 'trait', detail: 'Rust keyword' },
  { label: 'impl', detail: 'Rust keyword' },
  { label: 'use', detail: 'Rust keyword' },
  { label: 'pub', detail: 'Rust keyword' },
  { label: 'mod', detail: 'Rust keyword' },
  { label: 'crate', detail: 'Rust keyword' },
  { label: 'match', detail: 'Rust keyword' },
  { label: 'async', detail: 'Rust keyword' },
  { label: 'await', detail: 'Rust keyword' },
  { label: 'return', detail: 'Rust keyword' },
  { label: 'vec!', detail: 'Create a vector literal' },
  { label: 'assert_eq!', detail: 'Compare two values in tests' },
  { label: 'dbg!', detail: 'Debug-print a value' },
  {
    label: 'println!',
    kind: 'snippet',
    detail: 'Print a formatted line',
    insertText: 'println!("${1:{}}", ${2:value});',
  },
  {
    label: 'fn main',
    kind: 'snippet',
    detail: 'Rust program entrypoint',
    insertText: ['fn main() {', '    ${0}', '}'].join('\n'),
  },
  {
    // Distinct label from the plain `match` keyword above so Monaco does not
    // surface two entries that share the exact same display text.
    label: 'match expression',
    kind: 'snippet',
    detail: 'Rust match expression',
    insertText: [
      'match ${1:value} {',
      '    ${2:pattern} => ${0:todo!()},',
      '}',
    ].join('\n'),
  },
  {
    label: 'impl',
    kind: 'snippet',
    detail: 'Rust impl block',
    insertText: [
      'impl ${1:Type} {',
      '    fn ${2:new}(${3:args}) -> Self {',
      '        ${0:todo!()}',
      '    }',
      '}',
    ].join('\n'),
  },
  {
    label: 'use std::',
    kind: 'snippet',
    detail: 'Import from the Rust standard library',
    insertText: 'use std::${1:io};',
  },
] as const;

/**
 * RL-026 Slice 3 — Monaco completion provider for Rust.
 *
 * Layered strategy:
 *  - Static `RUST_COMPLETIONS` keep keyword + snippet suggestions
 *    available even when rust-analyzer hasn't booted yet (or is
 *    indexing). Senior-dev expectation: keyword suggestions never
 *    disappear.
 *  - When the LSP is up and the document is registered, the provider
 *    also returns rust-analyzer's semantic completions (methods,
 *    fields, imported types). Monaco merges both lists; duplicates by
 *    label collapse via `mergeDefinitions` in providerUtils.
 */
type RustProvider = Parameters<Monaco['languages']['registerCompletionItemProvider']>[1];
type RustProvideCompletionItems = NonNullable<RustProvider['provideCompletionItems']>;
type RustCompletionModel = Parameters<RustProvideCompletionItems>[0];
type RustCompletionPosition = Parameters<RustProvideCompletionItems>[1];
type RustCompletionContext = Parameters<RustProvideCompletionItems>[2];
type RustCompletionToken = Parameters<RustProvideCompletionItems>[3];

export function createRustCompletionProvider(monaco: Monaco): RustProvider {
  const baseProvider = createCompletionProvider(monaco, RUST_COMPLETIONS, {
    triggerCharacters: ['!', ':', '.', '('],
  });

  return {
    ...baseProvider,
    async provideCompletionItems(
      model: RustCompletionModel,
      position: RustCompletionPosition,
      context: RustCompletionContext,
      token: RustCompletionToken
    ) {
      const baseResult =
        baseProvider.provideCompletionItems?.(model, position, context, token) ?? {
          suggestions: [],
        };
      const baseAwaited = await Promise.resolve(baseResult);
      if (!baseAwaited) {
        return { suggestions: [] };
      }

      if (!isRustLspAvailable()) return baseAwaited;
      const adapter = getRustLspAdapter();
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
        // Server hiccups should never break the keyword path.
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
