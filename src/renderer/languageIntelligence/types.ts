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

export interface LanguageIntelligenceAdapter {
  language: string;
  analyze(content: string): LanguageIntelligenceResult;
}
