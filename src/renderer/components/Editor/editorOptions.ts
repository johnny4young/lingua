interface EditorOptionInput {
  fontSize: number;
  fontFamily: string;
  fontLigatures: boolean;
  showLineNumbers: boolean;
  wordWrap: boolean;
  minimap: boolean;
}

export function getEditorOptions({
  fontSize,
  fontFamily,
  fontLigatures,
  showLineNumbers,
  wordWrap,
  minimap,
}: EditorOptionInput) {
  return {
    fontSize,
    fontFamily,
    fontLigatures,
    glyphMargin: true,
    lineNumbers: showLineNumbers ? 'on' : 'off',
    wordWrap: wordWrap ? 'on' : 'off',
    minimap: { enabled: minimap },
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
    wordBasedSuggestions: 'currentDocument' as const,
    tabSize: 2,
  } as const;
}
