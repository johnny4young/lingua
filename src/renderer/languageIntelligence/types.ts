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

/**
 * Async streaming contract for adapters that delegate to a long-running
 * out-of-process server (implementation — rust-analyzer). The contract is
 * intentionally separate from the sync adapter so renderer-only adapters
 * (Python) do not have to opt in. The same Monaco provider can route to
 * either flavor based on the language id.
 *
 * Documents are referenced by an opaque `uri` (the renderer owns the
 * mapping from tab to uri). Diagnostics are pushed via
 * `subscribeDiagnostics` because LSP servers publish them after
 * `textDocument/didChange` rather than answering a sync query. Completions,
 * hover, and signature help are request/response so the Monaco providers
 * can `await` them.
 */
export interface LspLanguageIntelligenceAdapter {
  language: string;
  /**
   * Ensure the document is registered with the language server. Safe to
   * call repeatedly with the same uri (the adapter dedupes internally).
   */
  openDocument(uri: string, content: string): void;
  /**
   * Tell the server about a content edit. The adapter is responsible for
   * debouncing or queuing if the underlying transport is slow.
   */
  changeDocument(uri: string, content: string): void;
  /**
   * Mirror Monaco's tab close so the server can release per-document state.
   */
  closeDocument(uri: string): void;
  /**
   * Push diagnostics from the server to the caller. Returns an unsubscribe
   * function. The same diagnostic uri is replaced (not appended) on each
   * publish to mirror Monaco's marker-owner contract.
   */
  subscribeDiagnostics(
    listener: (uri: string, diagnostics: readonly LanguageIntelligenceDiagnostic[]) => void
  ): () => void;
  provideCompletions(
    uri: string,
    line: number,
    column: number
  ): Promise<readonly LanguageIntelligenceCompletion[]>;
  provideHover(
    uri: string,
    line: number,
    column: number
  ): Promise<LanguageIntelligenceHover | null>;
  provideSignatureHelp(
    uri: string,
    line: number,
    column: number
  ): Promise<LanguageIntelligenceSignatureHelp | null>;
}
