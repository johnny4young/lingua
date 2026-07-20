interface EditorOptionInput {
  fontSize: number;
  fontFamily: string;
  /**
   * implementation — kept as a derived input from `effectiveFontLigatures`
   * (font-stack-dependent). Settings no longer exposes a ligatures
   * toggle; if the active font supports them, they render.
   */
  fontLigatures: boolean;
  wordWrap: boolean;
  minimap: boolean;
}

/**
 * implementation Slice (Monaco cells) implementation note — shared option builder for the
 * "satellite" Monaco surfaces that are NOT the main code editor: the SQL
 * workspace editor and the notebook cell editor. These surfaces want a
 * leaner config than the full `getEditorOptions` (no glyph margin, no
 * smooth-caret animation, no overview ruler) but must stay font/tab
 * consistent with it. Centralizing the shape here stops the SQL and
 * notebook editors from drifting apart option-by-option over time.
 *
 * `ariaLabel` is required (each satellite owns its own accessible name).
 * Returned `as const` so the Monaco-option literal types survive the
 * function boundary (mirrors `getEditorOptions`); a caller that needs a
 * per-surface tweak spreads it into an inline `options={{ ...base, ... }}`
 * literal, which the editor prop contextually re-types.
 */
export interface SatelliteEditorOptionInput {
  fontSize: number;
  fontFamily: string;
  ariaLabel: string;
}

export function getSatelliteEditorOptions({
  fontSize,
  fontFamily,
  ariaLabel,
}: SatelliteEditorOptionInput) {
  return {
    ariaLabel,
    fontSize,
    fontFamily,
    lineNumbers: 'on',
    minimap: { enabled: false },
    wordWrap: 'off',
    scrollBeyondLastLine: false,
    tabSize: 2,
    insertSpaces: true,
    padding: { top: 8, bottom: 8 },
    automaticLayout: true,
    renderLineHighlight: 'line',
    overviewRulerLanes: 0,
  } as const;
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
    // implementation — line numbers are baseline editor primitive; always on.
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
