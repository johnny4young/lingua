import { editorFontVariations } from '../../utils/editorFontVariations';
import type { editor } from 'monaco-editor';
import { PULSE_RAIL_WIDTH } from '../../utils/pulseRail';

interface EditorOptionInput {
  fontSize: number;
  fontFamily: string;
  /**
   * Kept as a derived input from `effectiveFontLigatures`
   * (font-stack-dependent). Settings no longer exposes a ligatures
   * toggle; if the active font supports them, they render.
   */
  fontLigatures: boolean;
  wordWrap: boolean;
  minimap: boolean;
  /** Narrow editors drop the glyph margin and folding so the code keeps the width; the run rail stays. */
  compactGutter?: boolean;
  /** Answers draw colour chips, so Monaco's inline swatches would show each colour twice. */
  answersShowColors?: boolean;
}

/** Editor width, in px, under which the gutter goes compact. */
export const COMPACT_GUTTER_MAX_WIDTH = 480;

/**
 * Shared option builder for the
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
  /** Narrow editors drop folding and pad fewer line-number digits, as the code editor does. */
  compactGutter?: boolean;
}

export function getSatelliteEditorOptions({
  fontSize,
  fontFamily,
  ariaLabel,
  compactGutter = false,
}: SatelliteEditorOptionInput) {
  return {
    ariaLabel,
    folding: !compactGutter,
    lineNumbersMinChars: compactGutter ? 3 : 5,
    fontSize,
    fontFamily,
    fontVariations: editorFontVariations(fontFamily),
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
  compactGutter = false,
  answersShowColors = false,
}: EditorOptionInput) {
  return {
    fontSize,
    fontFamily,
    fontVariations: editorFontVariations(fontFamily),
    fontLigatures,
    glyphMargin: !compactGutter,
    folding: !compactGutter,
    // Without the glyph margin the lightbulb would sit on the code.
    lightbulb: { enabled: (compactGutter ? 'off' : 'onCode') as editor.ShowLightbulbIconMode },
    // Monaco's default is 5.
    lineNumbersMinChars: compactGutter ? 3 : 5,
    // Monaco's default 10 px, plus the run rail beside the code.
    lineDecorationsWidth: 10 + PULSE_RAIL_WIDTH,
    // Line numbers are baseline editor primitive; always on.
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
    colorDecorators: !answersShowColors,
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
