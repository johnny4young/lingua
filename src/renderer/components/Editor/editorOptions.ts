interface EditorOptionInput {
  fontSize: number;
  fontFamily: string;
  showLineNumbers: boolean;
  wordWrap: boolean;
  minimap: boolean;
}

export function getEditorOptions({
  fontSize,
  fontFamily,
  showLineNumbers,
  wordWrap,
  minimap,
}: EditorOptionInput) {
  return {
    fontSize,
    fontFamily,
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
    tabSize: 2,
  } as const;
}
