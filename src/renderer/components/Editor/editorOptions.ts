interface EditorOptionInput {
  fontSize: number;
  fontFamily: string;
  /**
   * Slice 2 — kept as a derived input from `effectiveFontLigatures`
   * (font-stack-dependent). Settings no longer exposes a ligatures
   * toggle; if the active font supports them, they render.
   */
  fontLigatures: boolean;
  wordWrap: boolean;
  minimap: boolean;
}

export function getEditorOptions({
  fontSize,
  fontFamily,
  fontLigatures,
  wordWrap,
  minimap,
}: EditorOptionInput) {
  return {
    fontSize,
    fontFamily,
    fontLigatures,
    glyphMargin: true,
    // Slice 2 — line numbers are baseline editor primitive; always on.
    lineNumbers: 'on',
    wordWrap: wordWrap ? 'on' : 'off',
    minimap: { enabled: minimap },
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
    wordBasedSuggestions: 'currentDocument' as const,
    tabSize: 2,
  } as const;
}
