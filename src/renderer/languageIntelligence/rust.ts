import type {
  LanguageIntelligenceCompletion,
  LanguageIntelligenceCompletionKind,
  LanguageIntelligenceDiagnostic,
  LanguageIntelligenceHover,
  LanguageIntelligenceSeverity,
  LanguageIntelligenceSignatureHelp,
  LanguageIntelligenceSignatureParameter,
  LspLanguageIntelligenceAdapter,
} from './types';
import { requestLspData, type LspRequestTransport } from './lspRequest';

/**
 * RL-026 Slice 3 — renderer-side adapter for rust-analyzer.
 *
 * The adapter is a thin transport layer between Monaco and the main-
 * process LSP bridge (`window.lingua.lsp.rust`). It does NOT cache
 * results; rust-analyzer's index is the source of truth. Caching here
 * would require invalidation on every keystroke, which is more code
 * than the savings buy.
 *
 * Per-document state is intentionally small:
 *   - `version` — incremented on every `changeDocument`. Sent as the
 *     `textDocument.version` field so rust-analyzer can detect stale
 *     responses if a user types faster than the server can answer.
 *   - `latestContent` — the renderer always sends the FULL document
 *     on `didChange` (LSP's `textDocument.didChange` supports both
 *     incremental and full sync; full is simpler and avoids range-
 *     mapping bugs while staying fast for files < 10k LOC).
 *
 * Diagnostic dispatch:
 *   - rust-analyzer pushes `textDocument/publishDiagnostics` after
 *     every `didChange`. The adapter routes them through
 *     `diagnosticsListeners` keyed by uri. Each publish replaces the
 *     previous diagnostic set for that uri (LSP contract).
 */

export interface RustAdapterTransport extends LspRequestTransport {
  notify: (method: string, params: unknown) => void;
  onNotification: (callback: (notification: LspNotification) => void) => () => void;
}

interface OpenDocument {
  uri: string;
  version: number;
  latestContent: string;
}

interface LspCompletionItem {
  label?: string;
  detail?: string;
  documentation?: string | { value: string };
  kind?: number;
  insertText?: string;
  insertTextFormat?: number;
}

interface LspDiagnostic {
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
  severity?: number;
  message: string;
}

interface LspHover {
  contents?:
    | string
    | { value: string }
    | { kind: string; value: string }
    | ReadonlyArray<string | { value: string }>;
  range?: { start: { line: number }; end: { line: number } };
}

interface LspSignatureHelp {
  signatures: ReadonlyArray<{
    label: string;
    parameters?: ReadonlyArray<{ label: string | [number, number] }>;
  }>;
  activeSignature?: number;
  activeParameter?: number;
}

export class RustLanguageIntelligenceAdapter implements LspLanguageIntelligenceAdapter {
  readonly language = 'rust';
  private readonly transport: RustAdapterTransport;
  private readonly documents = new Map<string, OpenDocument>();
  private readonly diagnosticsListeners = new Set<
    (uri: string, diagnostics: readonly LanguageIntelligenceDiagnostic[]) => void
  >();
  private readonly unsubscribeNotifications: () => void;

  constructor(transport: RustAdapterTransport) {
    this.transport = transport;
    this.unsubscribeNotifications = transport.onNotification((notification) =>
      this.handleNotification(notification)
    );
  }

  dispose(): void {
    this.unsubscribeNotifications();
    for (const document of this.documents.values()) {
      this.transport.notify('textDocument/didClose', {
        textDocument: { uri: document.uri },
      });
    }
    this.documents.clear();
    this.diagnosticsListeners.clear();
  }

  openDocument(uri: string, content: string): void {
    const existing = this.documents.get(uri);
    if (existing) {
      // Already open — treat as didChange so the server stays in sync
      // without emitting a second didOpen.
      this.changeDocument(uri, content);
      return;
    }
    this.documents.set(uri, { uri, version: 1, latestContent: content });
    this.transport.notify('textDocument/didOpen', {
      textDocument: { uri, languageId: 'rust', version: 1, text: content },
    });
  }

  changeDocument(uri: string, content: string): void {
    const document = this.documents.get(uri);
    if (!document) {
      this.openDocument(uri, content);
      return;
    }
    if (document.latestContent === content) return;
    document.version += 1;
    document.latestContent = content;
    this.transport.notify('textDocument/didChange', {
      textDocument: { uri, version: document.version },
      contentChanges: [{ text: content }],
    });
  }

  closeDocument(uri: string): void {
    if (!this.documents.delete(uri)) return;
    this.transport.notify('textDocument/didClose', {
      textDocument: { uri },
    });
  }

  subscribeDiagnostics(
    listener: (uri: string, diagnostics: readonly LanguageIntelligenceDiagnostic[]) => void
  ): () => void {
    this.diagnosticsListeners.add(listener);
    return () => {
      this.diagnosticsListeners.delete(listener);
    };
  }

  async provideCompletions(
    uri: string,
    line: number,
    column: number
  ): Promise<readonly LanguageIntelligenceCompletion[]> {
    const response = await requestLspData(this.transport, 'textDocument/completion', {
      textDocument: { uri },
      position: lspPositionFromOneBased(line, column),
    });
    return parseCompletions(response);
  }

  async provideHover(
    uri: string,
    line: number,
    column: number
  ): Promise<LanguageIntelligenceHover | null> {
    const response = await requestLspData(this.transport, 'textDocument/hover', {
      textDocument: { uri },
      position: lspPositionFromOneBased(line, column),
    });
    return parseHover(response);
  }

  async provideSignatureHelp(
    uri: string,
    line: number,
    column: number
  ): Promise<LanguageIntelligenceSignatureHelp | null> {
    const response = await requestLspData(this.transport, 'textDocument/signatureHelp', {
      textDocument: { uri },
      position: lspPositionFromOneBased(line, column),
    });
    return parseSignatureHelp(response);
  }

  private handleNotification(notification: LspNotification): void {
    if (notification.method !== 'textDocument/publishDiagnostics') return;
    const params = notification.params as
      | { uri?: string; diagnostics?: readonly LspDiagnostic[] }
      | undefined;
    if (!params || typeof params.uri !== 'string') return;
    const diagnostics = parseDiagnostics(params.diagnostics ?? []);
    for (const listener of this.diagnosticsListeners) {
      listener(params.uri, diagnostics);
    }
  }
}

/**
 * LSP positions are 0-based; Monaco coordinates are 1-based. The same
 * conversion lives in the Python providers — keeping it inline at every
 * call site (rather than centralized) means a refactor of one
 * language's coordinate handling doesn't accidentally change another's.
 */
function lspPositionFromOneBased(line: number, column: number): {
  line: number;
  character: number;
} {
  return { line: Math.max(0, line - 1), character: Math.max(0, column - 1) };
}

function parseCompletions(raw: unknown): readonly LanguageIntelligenceCompletion[] {
  if (!raw) return [];
  // LSP returns either `CompletionItem[]` or `CompletionList`.
  const items: LspCompletionItem[] = Array.isArray(raw)
    ? (raw as LspCompletionItem[])
    : Array.isArray((raw as { items?: LspCompletionItem[] }).items)
      ? ((raw as { items: LspCompletionItem[] }).items)
      : [];

  const out: LanguageIntelligenceCompletion[] = [];
  for (const item of items) {
    if (!item || typeof item.label !== 'string' || item.label.length === 0) continue;
    out.push({
      label: item.label,
      detail: item.detail ?? '',
      documentation: typeof item.documentation === 'string'
        ? item.documentation
        : typeof item.documentation?.value === 'string'
          ? item.documentation.value
          : undefined,
      insertText: typeof item.insertText === 'string' ? item.insertText : undefined,
      kind: mapLspCompletionKind(item.kind),
    });
  }
  return out;
}

function mapLspCompletionKind(kind: number | undefined): LanguageIntelligenceCompletionKind {
  // LSP `CompletionItemKind` numeric enum:
  //   1 Text, 2 Method, 3 Function, 4 Constructor, 5 Field, 6 Variable,
  //   7 Class, 8 Interface, 9 Module, 10 Property, 11 Unit, 12 Value,
  //   13 Enum, 14 Keyword, 15 Snippet, 16 Color, 17 File, 18 Reference,
  //   19 Folder, 20 EnumMember, 21 Constant, 22 Struct, 23 Event,
  //   24 Operator, 25 TypeParameter.
  switch (kind) {
    case 2:
    case 3:
    case 4:
      return 'function';
    case 5:
    case 6:
    case 10:
    case 21:
      return 'variable';
    case 7:
    case 22:
    case 25:
      return 'class';
    case 9:
      return 'module';
    case 15:
      return 'snippet';
    default:
      return 'keyword';
  }
}

function parseDiagnostics(
  raw: readonly LspDiagnostic[]
): readonly LanguageIntelligenceDiagnostic[] {
  const out: LanguageIntelligenceDiagnostic[] = [];
  for (const diagnostic of raw) {
    if (!diagnostic || typeof diagnostic.message !== 'string') continue;
    const start = diagnostic.range?.start;
    const end = diagnostic.range?.end;
    if (!start || !end) continue;
    out.push({
      line: start.line + 1,
      column: start.character + 1,
      endLine: end.line + 1,
      endColumn: end.character + 1,
      message: diagnostic.message,
      severity: mapLspSeverity(diagnostic.severity),
      source: 'language-intelligence',
    });
  }
  return out;
}

function mapLspSeverity(severity: number | undefined): LanguageIntelligenceSeverity {
  // LSP severity: 1=Error, 2=Warning, 3=Information, 4=Hint.
  switch (severity) {
    case 1:
      return 'error';
    case 2:
      return 'warning';
    default:
      return 'info';
  }
}

function parseHover(raw: unknown): LanguageIntelligenceHover | null {
  if (!raw || typeof raw !== 'object') return null;
  const hover = raw as LspHover;
  const text = extractHoverText(hover.contents);
  if (!text) return null;
  // rust-analyzer's hover is markdown-rich; pick the first signal-
  // bearing line (the signature itself, typically `pub fn foo(...)`)
  // and discard markdown scaffolding like ``` fences. The optional
  // secondary line carries the prose summary that follows the code
  // block. Mirrors Python's hover contract.
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !isCodeFenceLine(line));
  if (lines.length === 0) return null;
  const headline = lines[0] ?? '';
  const secondary = lines.length > 1 ? lines[1] : undefined;
  const definedAtLine = hover.range ? hover.range.start.line + 1 : 1;
  return {
    symbol: headline,
    kind: inferHoverKind(headline),
    definedAtLine,
    secondary: secondary && secondary !== headline ? secondary : undefined,
  };
}

function isCodeFenceLine(line: string): boolean {
  return /^```/.test(line);
}

function extractHoverText(
  contents: LspHover['contents']
): string | null {
  if (!contents) return null;
  if (typeof contents === 'string') return contents;
  if (Array.isArray(contents)) {
    const parts = contents
      .map((entry) => (typeof entry === 'string' ? entry : entry.value))
      .filter((entry): entry is string => typeof entry === 'string');
    return parts.join('\n');
  }
  if (typeof contents === 'object' && 'value' in contents && typeof contents.value === 'string') {
    return contents.value;
  }
  return null;
}

function inferHoverKind(headline: string): LanguageIntelligenceHover['kind'] {
  if (/^(?:pub\s+)?fn\b/.test(headline)) return 'function';
  if (/^(?:pub\s+)?(?:struct|enum|trait|type)\b/.test(headline)) return 'class';
  if (/^(?:pub\s+)?mod\b/.test(headline)) return 'module';
  return 'variable';
}

function parseSignatureHelp(raw: unknown): LanguageIntelligenceSignatureHelp | null {
  if (!raw || typeof raw !== 'object') return null;
  const help = raw as LspSignatureHelp;
  if (!Array.isArray(help.signatures) || help.signatures.length === 0) return null;
  const activeSignatureIndex = clampIndex(help.activeSignature, help.signatures.length);
  const signature = help.signatures[activeSignatureIndex];
  if (!signature) return null;
  const parameters: LanguageIntelligenceSignatureParameter[] = (signature.parameters ?? [])
    .map((parameter: { label: string | [number, number] } | undefined): LanguageIntelligenceSignatureParameter | null => {
      if (!parameter || typeof parameter.label === 'undefined') return null;
      if (typeof parameter.label === 'string') return { label: parameter.label };
      if (Array.isArray(parameter.label) && typeof parameter.label[0] === 'number') {
        const [startIdx, endIdx] = parameter.label;
        return { label: signature.label.slice(startIdx, endIdx) };
      }
      return null;
    })
    .filter(
      (entry: LanguageIntelligenceSignatureParameter | null): entry is LanguageIntelligenceSignatureParameter =>
        entry !== null
    );

  const activeParameter = clampIndex(help.activeParameter, Math.max(parameters.length, 1));
  return {
    symbol: signature.label,
    parameters,
    activeParameter,
  };
}

function clampIndex(value: number | undefined, length: number): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return 0;
  if (value < 0) return 0;
  if (value >= length) return Math.max(0, length - 1);
  return value;
}
