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
 * implementation — renderer-side adapter for gopls.
 *
 * Mirrors `rust.ts`: transport-layer glue between Monaco and the
 * main-process LSP bridge (`window.lingua.lsp.go`). Per-document
 * state is intentionally minimal — gopls is the source of truth for
 * the indexed view, so the adapter only tracks an open-document
 * version counter (to detect stale responses if a user types faster
 * than gopls can answer) and the most recent content (so didChange
 * sends the full document — incremental sync would require us to map
 * Monaco edits to LSP ranges, which adds complexity without a clear
 * win for files under 10k LOC).
 *
 * Diagnostics arrive via push (`textDocument/publishDiagnostics`)
 * keyed by URI. The renderer subscribes through `subscribeDiagnostics`
 * and routes each publish through `setModelMarkers` under the shared
 * `lingua-language-intelligence` owner so Rust and Go markers cohabit
 * on the same model without overwriting each other.
 */

export interface GoAdapterTransport extends LspRequestTransport {
  /**
   * Request/response leg over the main-process LSP bridge. The bridge
   * returns an explicit ok/error union so Monaco providers can degrade to
   * empty completions or no hover instead of throwing into the editor.
   */
  /** Fire-and-forget JSON-RPC notifications such as didOpen/didChange. */
  notify: (method: string, params: unknown) => void;
  /** Subscribe to LSP server pushes, primarily publishDiagnostics. */
  onNotification: (callback: (notification: LspNotification) => void) => () => void;
}

interface OpenDocument {
  uri: string;
  /** Monotonic local version used for full-document sync with gopls. */
  version: number;
  /** Last text sent to gopls; duplicate Monaco notifications are ignored. */
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

export class GoLanguageIntelligenceAdapter implements LspLanguageIntelligenceAdapter {
  readonly language = 'go';
  private readonly transport: GoAdapterTransport;
  /** URI -> latest full-sync state for every Monaco model opened in gopls. */
  private readonly documents = new Map<string, OpenDocument>();
  /** Renderer marker owners subscribe here instead of polling gopls. */
  private readonly diagnosticsListeners = new Set<
    (uri: string, diagnostics: readonly LanguageIntelligenceDiagnostic[]) => void
  >();
  private readonly unsubscribeNotifications: () => void;

  constructor(transport: GoAdapterTransport) {
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
      // Monaco can re-register a model that gopls already knows. Treat
      // that as a content refresh instead of sending an invalid duplicate
      // didOpen.
      this.changeDocument(uri, content);
      return;
    }
    this.documents.set(uri, { uri, version: 1, latestContent: content });
    this.transport.notify('textDocument/didOpen', {
      textDocument: { uri, languageId: 'go', version: 1, text: content },
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
    // Full-sync keeps this adapter stateless with respect to Monaco edits.
    // Incremental sync would require converting each editor delta into LSP
    // ranges, which is not worth the added race surface for Lingua-sized files.
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
    // Fan out the normalized diagnostics; marker ownership stays outside this
    // adapter so Go and Rust can share the same Monaco model cleanly.
    for (const listener of this.diagnosticsListeners) {
      listener(params.uri, diagnostics);
    }
  }
}

function lspPositionFromOneBased(
  line: number,
  column: number
): { line: number; character: number } {
  // Monaco-facing callers use 1-based positions; LSP wire positions are
  // 0-based. Clamp here so every provider uses the same boundary behavior.
  return { line: Math.max(0, line - 1), character: Math.max(0, column - 1) };
}

function parseCompletions(raw: unknown): readonly LanguageIntelligenceCompletion[] {
  if (!raw) return [];
  // gopls may answer with either CompletionItem[] or CompletionList. Normalize
  // both to the renderer's language-agnostic completion contract.
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
  // LSP `CompletionItemKind` numeric enum (same as rust.ts):
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
    case 8:
    case 13:
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
    // Treat malformed server payloads as absent diagnostics. A single bad
    // entry should not drop the rest of the publishDiagnostics batch.
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
  // gopls hover is markdown-rich with the signature inside a fenced
  // `go` block. Skip the fence lines and pick the first signal-bearing
  // entry as the headline. Same shape as the rust adapter.
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

function extractHoverText(contents: LspHover['contents']): string | null {
  if (!contents) return null;
  if (typeof contents === 'string') return contents;
  if (Array.isArray(contents)) {
    // LSP MarkedString arrays are ordered prose/code fragments. Joining with
    // newlines preserves enough structure for the headline extractor below.
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

function isCodeFenceLine(line: string): boolean {
  return /^```/.test(line);
}

function inferHoverKind(headline: string): LanguageIntelligenceHover['kind'] {
  if (/^func\b/.test(headline)) return 'function';
  if (/^(?:type)\b/.test(headline)) return 'class';
  if (/^package\b/.test(headline)) return 'module';
  return 'variable';
}

function parseSignatureHelp(raw: unknown): LanguageIntelligenceSignatureHelp | null {
  if (!raw || typeof raw !== 'object') return null;
  const help = raw as LspSignatureHelp;
  if (!Array.isArray(help.signatures) || help.signatures.length === 0) return null;
  const activeSignatureIndex = clampIndex(help.activeSignature, help.signatures.length);
  const signature = help.signatures[activeSignatureIndex];
  if (!signature) return null;
  // LSP allows parameter labels to be literal strings or [start, end] slices
  // into the signature label. Convert both before the shared UI sees them.
  const parameters: LanguageIntelligenceSignatureParameter[] = (signature.parameters ?? [])
    .map(
      (
        parameter: { label: string | [number, number] } | undefined
      ): LanguageIntelligenceSignatureParameter | null => {
        if (!parameter || typeof parameter.label === 'undefined') return null;
        if (typeof parameter.label === 'string') return { label: parameter.label };
        if (Array.isArray(parameter.label) && typeof parameter.label[0] === 'number') {
          const [startIdx, endIdx] = parameter.label;
          return { label: signature.label.slice(startIdx, endIdx) };
        }
        return null;
      }
    )
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
  // gopls can omit active indexes or return stale indexes after edits. Clamp
  // defensively so the renderer never indexes outside the selected signature.
  if (typeof value !== 'number' || Number.isNaN(value)) return 0;
  if (value < 0) return 0;
  if (value >= length) return Math.max(0, length - 1);
  return value;
}
