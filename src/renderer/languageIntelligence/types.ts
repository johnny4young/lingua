export type LanguageIntelligenceSeverity = 'error' | 'warning' | 'info';

export interface LanguageIntelligenceDiagnostic {
  line: number;
  column: number;
  endLine?: number;
  endColumn?: number;
  message: string;
  severity: LanguageIntelligenceSeverity;
  source: 'language-intelligence';
}

export type LanguageIntelligenceCompletionKind =
  | 'keyword'
  | 'snippet'
  | 'function'
  | 'class'
  | 'module'
  | 'variable';

export interface LanguageIntelligenceCompletion {
  label: string;
  detail: string;
  documentation?: string;
  insertText?: string;
  kind: LanguageIntelligenceCompletionKind;
}

export interface LanguageIntelligenceResult {
  diagnostics: LanguageIntelligenceDiagnostic[];
  completions: LanguageIntelligenceCompletion[];
}

export type LanguageIntelligenceSymbolKind = 'function' | 'class' | 'module' | 'variable';

export interface LanguageIntelligenceHover {
  symbol: string;
  kind: LanguageIntelligenceSymbolKind;
  /** 1-based line where the symbol was defined in the active file. */
  definedAtLine: number;
  /** Optional secondary text (parameter list, import source, etc.). */
  secondary?: string;
}

export interface LanguageIntelligenceSignatureParameter {
  label: string;
}

export interface LanguageIntelligenceSignatureHelp {
  symbol: string;
  parameters: LanguageIntelligenceSignatureParameter[];
  /** 0-based index of the active parameter under the cursor. */
  activeParameter: number;
}

export interface LanguageIntelligenceAdapter {
  language: string;
  analyze(content: string): LanguageIntelligenceResult;
  /**
   * Optional. Resolve the symbol under (line, column) — both 1-based,
   * matching Monaco's editor coordinate system — to a hover payload.
   */
  provideHover?(content: string, line: number, column: number): LanguageIntelligenceHover | null;
  /**
   * Optional. Resolve the innermost open call expression at (line, column)
   * — both 1-based — to a signature payload. Returns null when the cursor
   * is not inside a call, when the call target is not a known local
   * symbol, or when the cursor is inside a string or comment.
   */
  provideSignatureHelp?(
    content: string,
    line: number,
    column: number
  ): LanguageIntelligenceSignatureHelp | null;
}
