import { describe, expect, it } from 'vitest';
import { getEditorOptions } from '@/components/Editor/editorOptions';

describe('getEditorOptions', () => {
  it('maps renderer settings into stable Monaco editor options', () => {
    expect(
      getEditorOptions({
        fontSize: 16,
        fontFamily: 'JetBrains Mono',
        // Slice 2 — `fontLigatures` is now derived from the font stack
        // (see CodeEditor `effectiveFontLigatures`); kept as an input
        // here so the helper signature stays explicit.
        fontLigatures: true,
        wordWrap: true,
        minimap: false,
      })
    ).toEqual({
      fontSize: 16,
      fontFamily: 'JetBrains Mono',
      fontLigatures: true,
      glyphMargin: true,
      // Slice 2 — line numbers are baseline editor primitive; always on.
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
});
