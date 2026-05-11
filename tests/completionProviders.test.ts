import { describe, expect, it } from 'vitest';
import { createGoCompletionProvider } from '@/components/Editor/completionProviders/goCompletions';
import { createPythonCompletionProvider } from '@/components/Editor/completionProviders/pythonCompletions';
import { createRustCompletionProvider } from '@/components/Editor/completionProviders/rustCompletions';
import { createLuaCompletionProvider } from '@/components/Editor/completionProviders/luaCompletions';

const monacoStub = {
  languages: {
    CompletionItemKind: {
      Class: 'class',
      Function: 'function',
      Keyword: 'keyword',
      Module: 'module',
      Snippet: 'snippet',
      Variable: 'variable',
    },
    CompletionItemInsertTextRule: {
      InsertAsSnippet: 'insert-as-snippet',
    },
  },
} as const;

const modelStub = {
  getWordUntilPosition() {
    return {
      startColumn: 1,
      endColumn: 1,
    };
  },
  getValue() {
    return '';
  },
};

const positionStub = {
  lineNumber: 1,
  column: 1,
};

function getSuggestions(
  provider: ReturnType<typeof createGoCompletionProvider>
) {
  const result = provider.provideCompletionItems(
    modelStub as never,
    positionStub as never
  );
  if (!result) return [];
  return 'suggestions' in result ? result.suggestions : [];
}

async function getSuggestionsAsync(
  provider: ReturnType<typeof createRustCompletionProvider>
) {
  const result = await provider.provideCompletionItems!(
    modelStub as never,
    positionStub as never,
    undefined as never,
    undefined as never
  );
  if (!result) return [];
  return 'suggestions' in result ? result.suggestions : [];
}

describe('language completion providers', () => {
  it('returns Go fmt and snippet completions', () => {
    const provider = createGoCompletionProvider(monacoStub as never);
    const suggestions = getSuggestions(provider);

    expect(suggestions.map((item) => item.label)).toEqual(
      expect.arrayContaining(['fmt.Println', 'fmt.Sprintf', 'if err != nil'])
    );
    expect(
      suggestions.find((item) => item.label === 'for range')
    ).toMatchObject({
      kind: 'snippet',
      insertTextRules: 'insert-as-snippet',
    });
  });

  it('returns Python function and module snippets with an explicit space trigger', () => {
    const provider = createPythonCompletionProvider(monacoStub as never);
    const suggestions = getSuggestions(provider);

    expect(provider.triggerCharacters).toEqual([' ']);
    expect(suggestions.map((item) => item.label)).toEqual(
      expect.arrayContaining(['def', "if __name__ == '__main__'", 'print'])
    );
    expect(suggestions.find((item) => item.label === 'def')).toMatchObject({
      kind: 'snippet',
      insertText: expect.stringContaining('${1:name}'),
    });
  });

  it('returns Python symbols defined in the current model before static suggestions', () => {
    const provider = createPythonCompletionProvider(monacoStub as never);
    const suggestions = provider.provideCompletionItems(
      {
        ...modelStub,
        getValue() {
          return [
            'import pathlib',
            'from math import sqrt as root',
            '',
            'class InvoiceBuilder:',
            '    pass',
            '',
            'def compute_total(amount):',
            '    subtotal = amount',
            '    return subtotal',
          ].join('\n');
        },
      } as never,
      positionStub as never
    ).suggestions;

    expect(suggestions.slice(0, 5).map((item) => item.label)).toEqual([
      'pathlib',
      'root',
      'InvoiceBuilder',
      'compute_total',
      'amount',
    ]);
    expect(suggestions.find((item) => item.label === 'compute_total')).toMatchObject({
      kind: 'function',
    });
    expect(suggestions.find((item) => item.label === 'InvoiceBuilder')).toMatchObject({
      kind: 'class',
    });
  });

  it('returns Rust macro and block snippets with distinct labels', async () => {
    const provider = createRustCompletionProvider(monacoStub as never);
    const suggestions = await getSuggestionsAsync(provider);

    const labels = suggestions.map((item) => item.label);
    expect(labels).toEqual(
      expect.arrayContaining(['println!', 'match', 'match expression', 'use std::'])
    );
    // The plain `match` keyword and the snippet must stay distinct so Monaco
    // does not surface two identically-labeled entries in the popup.
    expect(labels.filter((label) => label === 'match')).toHaveLength(1);
    expect(
      suggestions.find((item) => item.label === 'println!')
    ).toMatchObject({
      kind: 'snippet',
      insertText: 'println!("${1:{}}", ${2:value});',
    });
    expect(
      suggestions.find((item) => item.label === 'match expression')
    ).toMatchObject({
      kind: 'snippet',
      insertText: expect.stringContaining('match ${1:value}'),
    });
  });

  it('returns Lua loop and stdlib completions', () => {
    const provider = createLuaCompletionProvider(monacoStub as never);
    const suggestions = getSuggestions(provider);

    expect(suggestions.map((item) => item.label)).toEqual(
      expect.arrayContaining(['for', 'table.insert', 'string.format'])
    );
    expect(suggestions.find((item) => item.label === 'for')).toMatchObject({
      kind: 'snippet',
      insertText: expect.stringContaining('for ${1:i} = 1, ${2:n} do'),
    });
  });
});
