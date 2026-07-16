import i18next from 'i18next';
import {
  createMagicCommentCompletionProvider,
  createMagicCommentHoverProvider,
  getMagicCommentContext,
} from '@/components/Editor/completionProviders/magicCommentProviders';

const monacoStub = {
  languages: {
    CompletionItemKind: { Snippet: 'snippet' },
    CompletionItemInsertTextRule: { InsertAsSnippet: 'insert-as-snippet' },
  },
} as const;

function modelFor(line: string) {
  return {
    getLineContent() {
      return line;
    },
  };
}

function suggestionsFor(line: string, language: 'javascript' | 'typescript' | 'python') {
  const provider = createMagicCommentCompletionProvider(monacoStub as never, language);
  const result = provider.provideCompletionItems(
    modelFor(line) as never,
    { lineNumber: 1, column: line.length + 1 } as never,
    undefined as never,
    undefined as never
  );
  if (!result || !('suggestions' in result)) return [];
  return result.suggestions;
}

describe('magic comment editor providers', () => {
  afterEach(async () => {
    await i18next.changeLanguage('en');
  });

  it('offers directive snippets after a JavaScript comment marker', () => {
    const suggestions = suggestionsFor('// @', 'javascript');

    expect(suggestions.map(item => item.label)).toEqual(
      expect.arrayContaining([
        '@watch',
        '@timeout',
        '@origin off',
        '@git-ignore-status',
        '@git-watch-head off',
      ])
    );
    expect(suggestions.find(item => item.label === '@watch')).toMatchObject({
      insertText: '@watch ${1:expression}',
      insertTextRules: 'insert-as-snippet',
      range: {
        startLineNumber: 1,
        startColumn: 4,
        endLineNumber: 1,
        endColumn: 5,
      },
    });
  });

  it('offers arrow presentation directives in Python comments', () => {
    const suggestions = suggestionsFor('total #=> ', 'python');

    expect(suggestions.map(item => item.label)).toEqual(
      expect.arrayContaining(['=> table', '=> chart', '=> image', '=> html'])
    );
  });

  it('returns no suggestions outside comments or inside quoted marker text', () => {
    expect(suggestionsFor('const value = @', 'javascript')).toEqual([]);
    expect(suggestionsFor('const url = "https://example.com"', 'javascript')).toEqual([]);
    expect(suggestionsFor('value = "# @watch total"', 'python')).toEqual([]);
  });

  it('exposes a reusable context filter for JS, TS, and Python comments', () => {
    expect(getMagicCommentContext('typescript', 'value // @ti', 3, 13)).toMatchObject({
      commentStart: 6,
      typed: '@ti',
    });
    expect(getMagicCommentContext('python', 'value = 2 # @ti', 4, 16)).toMatchObject({
      commentStart: 10,
      typed: '@ti',
    });
    expect(getMagicCommentContext('python', 'value = "# @ti"', 4, 15)).toBeNull();
  });

  it('describes a real timeout directive on hover in Spanish', async () => {
    await i18next.changeLanguage('es');
    const line = '// @timeout 5s';
    const hover = createMagicCommentHoverProvider('javascript').provideHover(
      modelFor(line) as never,
      { lineNumber: 1, column: line.length } as never,
      undefined as never
    );

    expect(hover).toMatchObject({
      range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1 },
    });
    expect(hover?.contents.map(content => content.value).join('\n')).toContain(
      'Ajusta el tiempo límite'
    );
    expect(hover?.contents.map(content => content.value).join('\n')).toContain(
      'Ejemplo: // @timeout 5s'
    );
  });

  it('ignores quoted marker text before the real hovered directive', () => {
    const line = 'console.log("// @watch secret"); // @timeout 5s';
    const hover = createMagicCommentHoverProvider('javascript').provideHover(
      modelFor(line) as never,
      { lineNumber: 1, column: line.length } as never,
      undefined as never
    );

    expect(hover?.contents.map(content => content.value).join('\n')).toContain('**@timeout**');
    expect(hover?.contents.map(content => content.value).join('\n')).not.toContain('**@watch**');
  });
});
