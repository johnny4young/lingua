import { describe, expect, it } from 'vitest';
import { getEditorOptions } from '@/components/Editor/editorOptions';

describe('getEditorOptions', () => {
  it('maps renderer settings into stable Monaco editor options', () => {
    expect(
      getEditorOptions({
        fontSize: 16,
        fontFamily: 'JetBrains Mono',
        showLineNumbers: false,
        wordWrap: true,
        minimap: false,
      })
    ).toEqual({
      fontSize: 16,
      fontFamily: 'JetBrains Mono',
      glyphMargin: true,
      lineNumbers: 'off',
      wordWrap: 'on',
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
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
