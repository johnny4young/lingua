import { describe, expect, it } from 'vitest';
import { getEditorOptions, getSatelliteEditorOptions } from '@/components/Editor/editorOptions';

describe('getEditorOptions', () => {
  it('maps renderer settings into stable Monaco editor options', () => {
    expect(
      getEditorOptions({
        fontSize: 16,
        fontFamily: 'JetBrains Mono',
        // `fontLigatures` is now derived from the font stack
        // (see CodeEditor `effectiveFontLigatures`); kept as an input
        // here so the helper signature stays explicit.
        fontLigatures: true,
        wordWrap: true,
        minimap: false,
      })
    ).toEqual({
      fontSize: 16,
      fontFamily: 'JetBrains Mono',
      fontVariations: false,
      fontLigatures: true,
      glyphMargin: true,
      folding: true,
      lightbulb: { enabled: 'onCode' },
      lineNumbersMinChars: 5,
      lineDecorationsWidth: 32,
      // Line numbers are baseline editor primitive; always on.
      lineNumbers: 'on',
      wordWrap: 'on',
      minimap: { enabled: false },
      scrollBeyondLastLine: true,
      padding: { top: 12, bottom: 12 },
      smoothScrolling: true,
      cursorBlinking: 'smooth',
      cursorSmoothCaretAnimation: 'on',
      renderLineHighlight: 'line',
      bracketPairColorization: { enabled: true },
      colorDecorators: true,
      autoClosingBrackets: 'always',
      autoClosingQuotes: 'always',
      formatOnPaste: true,
      quickSuggestions: {
        other: true,
        comments: false,
        strings: true,
      },
      quickSuggestionsDelay: 0,
      snippetSuggestions: 'inline',
      suggestOnTriggerCharacters: true,
      tabCompletion: 'on',
      wordBasedSuggestions: 'currentDocument',
      tabSize: 2,
    });
  });

  it('drops the inline colour swatches while answers draw colour chips', () => {
    const base = { fontSize: 14, fontFamily: 'JetBrains Mono', fontLigatures: false, wordWrap: false, minimap: false };
    expect(getEditorOptions({ ...base, answersShowColors: true }).colorDecorators).toBe(false);
    expect(getEditorOptions(base).colorDecorators).toBe(true);
  });

  it('drops the glyph margin and folding in a compact gutter but keeps the run rail', () => {
    const base = { fontSize: 14, fontFamily: 'JetBrains Mono', fontLigatures: false, wordWrap: false, minimap: false };
    const compact = getEditorOptions({ ...base, compactGutter: true });
    expect(compact).toMatchObject({
      glyphMargin: false,
      folding: false,
      lightbulb: { enabled: 'off' },
      lineNumbersMinChars: 3,
      lineDecorationsWidth: 32,
    });
    expect(getEditorOptions(base)).toMatchObject({ glyphMargin: true, folding: true, lineNumbersMinChars: 5 });
  });

  it('turns on the MONO axis when the stack leads with Recursive', () => {
    const recursive = "'Recursive', 'JetBrains Mono', ui-monospace, monospace";
    expect(
      getEditorOptions({ fontSize: 14, fontFamily: recursive, fontLigatures: false, wordWrap: false, minimap: false })
        .fontVariations
    ).toBe("'MONO' 1");
    expect(
      getSatelliteEditorOptions({ fontSize: 14, fontFamily: recursive, ariaLabel: 'cell' }).fontVariations
    ).toBe("'MONO' 1");
    expect(
      getSatelliteEditorOptions({ fontSize: 14, fontFamily: 'Menlo, monospace', ariaLabel: 'cell' }).fontVariations
    ).toBe(false);
  });
});
