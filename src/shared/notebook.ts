import type { NotebookDocumentV1 } from './notebookDocument';
/**
 * `NotebookV1` schema.
 *
 * The versioned schema for `.linguanb` notebooks. The first release shipped the
 * schema + parser + serializer + closed-enum reject reasons; later
 * implementations add disk persistence , reactive dataflow,
 * and full export to script / markdown / HTML .
 *
 * Design notes (from the 2026-05-20 research triage):
 *
 *   - Notebooks live as a distinct tab kind in `editorStore`. They
 *     are NOT overloaded onto plain file tabs — the per-tab `kind`
 *     discriminator on `FileTab` decides whether the renderer mounts
 *     Monaco (regular file) or `<NotebookView>` (notebook).
 *   - Execution flows through runner-owned sessions, NOT raw
 *     `globalThis.eval()`. The runtime session lifetime is bound to
 *     the tab lifetime so `removeTab` always disposes the session.
 *   - Cell language is per-cell, not per-tab. The notebook is
 *     multi-language by design even though the runner originally only
 *     wires JavaScript + TypeScript.
 *
 * Privacy posture:
 *
 *   - Notebooks live ONLY on the device (the store persists via
 *     `notebookStore`'s isolated localStorage key; future work adds
 *     opt-in disk persistence to `.linguanb` files).
 *   - Telemetry (`notebook.cell_executed`) carries only closed-enum
 *     `language` + `status`. NO cell source, NO output bytes reach
 *     the wire.
 */

// ---------------------------------------------------------------------------
// Closed enums
// ---------------------------------------------------------------------------

/**
 * Closed-enum reject reasons returned by `parseNotebook`. Adding a
 * reason is additive; renaming/removing breaks the localized hint
 * map in `src/renderer/components/Notebook/NotebookView.tsx`.
 */
export const NOTEBOOK_REJECT_REASONS = [
  'malformed-json',
  'wrong-version',
  'invalid-shape',
  'unknown-language',
  'oversized',
  'too-many-cells',
] as const;
type NotebookRejectReason = (typeof NOTEBOOK_REJECT_REASONS)[number];

/**
 * Closed enum of code-cell languages. Markdown cells are NOT in this
 * set — they're a separate cell kind. JavaScript + TypeScript share the
 * JS worker pipeline (cross-cell state); Python  runs
 * through the Python runner independently per cell (no cross-cell state
 * yet); SQL  runs through the shared DuckDB-WASM engine and renders
 * its result set as a table output. All four are accepted by the
 * `notebookSession` runner.
 *
 * This enum — NOT the global `LanguagePackId` registry — is the authority
 * for what a notebook code cell may carry. `'sql'` is intentionally a
 * notebook-only cell language: it is NOT a first-class editor file
 * language, so it does not appear in the main editor's language menu.
 */
export const NOTEBOOK_CELL_LANGUAGES = ['javascript', 'typescript', 'python', 'sql'] as const;
export type NotebookCellLanguage = (typeof NOTEBOOK_CELL_LANGUAGES)[number];

/**
 * Closed enum of cell kinds. The two-arm discriminated union below
 * (`NotebookCellV1`) keeps the type-level surface honest: a markdown
 * cell never carries `outputs`, a code cell always carries a
 * `language` field.
 */
export const NOTEBOOK_CELL_KINDS = ['markdown', 'code'] as const;
export type NotebookCellKind = (typeof NOTEBOOK_CELL_KINDS)[number];

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

/**
 * Per-cell output: text-only outputs from
 * `console.log` + the cell's terminal expression (if any). future work
 * extends with rich payloads via a discriminated union; the
 * current shape is forward-compatible because `kind: 'text'` is the
 * default arm and unknown future kinds are rejected by the parser.
 */
export type NotebookCellOutputV1 = {
  readonly kind: 'text';
  /** Pre-escaped UTF-8 text. The runner caps each output to
   * `MAX_CELL_SOURCE_LENGTH` chars to bound storage growth. */
  readonly text: string;
  /** `'stdout'` for regular `console.log`; `'stderr'` for `console.error`
   * + thrown errors. Mirrors the run capsule's bucketed source identity. */
  readonly stream: 'stdout' | 'stderr';
};

export const NOTEBOOK_LINE_ANSWER_KINDS = ['value', 'output', 'error', 'table', 'result'] as const;
export type NotebookLineAnswerKind = (typeof NOTEBOOK_LINE_ANSWER_KINDS)[number];

/**
 * What the kernel answered on one line of a code cell: an expression or
 * assignment value, a printed line, the error, a table a SQL cell made
 * (`text` is its name) or a query's result set. Both SQL kinds carry
 * `rows` × `columns` when known.
 */
export interface NotebookLineAnswerV1 {
  /** 1-based line in the cell source. */
  readonly line: number;
  readonly kind: NotebookLineAnswerKind;
  readonly text: string;
  /** Runtime type name, when the kernel reports one (`list`, `number`…). */
  readonly type?: string;
  /** Length of a collection value. */
  readonly size?: number;
  readonly rows?: number;
  readonly columns?: number;
}

export interface NotebookCodeCellV1 {
  readonly kind: 'code';
  readonly id: string;
  readonly language: NotebookCellLanguage;
  readonly source: string;
  readonly outputs: ReadonlyArray<NotebookCellOutputV1>;
  /** Per-line answers of the last run. Optional so older notebooks load unchanged. */
  readonly answers?: ReadonlyArray<NotebookLineAnswerV1>;
}

export interface NotebookMarkdownCellV1 {
  readonly kind: 'markdown';
  readonly id: string;
  readonly source: string;
}

export type NotebookCellV1 = NotebookCodeCellV1 | NotebookMarkdownCellV1;

/**
 * Top-level notebook document. `version: 1` literal pins the schema;
 * future work flips to `version: 2` for fields like cell metadata,
 * reactive deps, and pinned outputs. The parser rejects unknown
 * versions so a downgrade can't silently load future data.
 */
export interface NotebookV1 {
  readonly version: 1;
  /** Stable id used for session keying + telemetry-internal correlation. */
  readonly id: string;
  /** User-visible title. Tab name reflects this. */
  readonly title: string;
  /** Optional creation timestamp (ISO 8601). The parser rejects malformed dates. */
  readonly createdAt?: string;
  /** Cells in display order. `MAX_CELLS_PER_NOTEBOOK` enforced by parser. */
  readonly cells: ReadonlyArray<NotebookCellV1>;
}

// ---------------------------------------------------------------------------
// Caps
// ---------------------------------------------------------------------------

/** Total notebook serialized size cap. ~10 small cells comfortably fit. */
export const MAX_NOTEBOOK_BYTES = 256 * 1024;
/** Hard cell-count cap so `Run all` stays bounded + the panel never
 * tries to mount thousands of cells. */
export const MAX_CELLS_PER_NOTEBOOK = 200;
/** Cap per cell source. 32 KiB comfortably accommodates the largest
 * realistic cell. future work can promote to Monaco with virtualization
 * which can handle larger inputs. */
export const MAX_CELL_SOURCE_LENGTH = 32 * 1024;
/** Cap per cell output count. Prevents a `for (i=0;i<1e6;i++) console.log(i)`
 * loop from blowing past localStorage quota. */
export const MAX_OUTPUTS_PER_CELL = 50;
/** Cap per single output text length. */
export const MAX_OUTPUT_TEXT_LENGTH = 16 * 1024;
/** Answers kept per cell; one per line is the common case. */
export const MAX_ANSWERS_PER_CELL = 50;
/** An answer is a one-line summary; the full value stays in the outputs. */
export const MAX_ANSWER_TEXT_LENGTH = 240;

export function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

export type NotebookParseOutcome =
  | { readonly ok: true; readonly notebook: NotebookV1 }
  | { readonly ok: false; readonly reason: NotebookRejectReason };

/**
 * Parse a raw JSON string OR an in-memory object into a typed
 * `NotebookV1`. Always settles to a discriminated outcome — never
 * throws. Used by:
 *
 *   - `notebookStore`'s sanitize-on-rehydrate path.
 *   - future work's `.linguanb` file open flow.
 *   - The future `.ipynb` importer adapter (Jupyter compat).
 */
export function parseNotebook(input: unknown): NotebookParseOutcome {
  // 1. Decode + size cap.
  let raw: unknown = input;
  if (typeof input === 'string') {
    if (utf8ByteLength(input) > MAX_NOTEBOOK_BYTES) {
      return { ok: false, reason: 'oversized' };
    }
    try {
      raw = JSON.parse(input);
    } catch {
      return { ok: false, reason: 'malformed-json' };
    }
  }

  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, reason: 'invalid-shape' };
  }
  const obj = raw as Record<string, unknown>;

  // 2. Version pin.
  if (obj.version !== 1) {
    return { ok: false, reason: 'wrong-version' };
  }

  // 3. Required scalar fields.
  if (typeof obj.id !== 'string' || obj.id.length === 0) {
    return { ok: false, reason: 'invalid-shape' };
  }
  if (typeof obj.title !== 'string') {
    return { ok: false, reason: 'invalid-shape' };
  }
  if (obj.createdAt !== undefined) {
    if (typeof obj.createdAt !== 'string') {
      return { ok: false, reason: 'invalid-shape' };
    }
    if (!Number.isFinite(Date.parse(obj.createdAt))) {
      return { ok: false, reason: 'invalid-shape' };
    }
  }

  // 4. Cells array + cap.
  if (!Array.isArray(obj.cells)) {
    return { ok: false, reason: 'invalid-shape' };
  }
  if (obj.cells.length > MAX_CELLS_PER_NOTEBOOK) {
    return { ok: false, reason: 'too-many-cells' };
  }
  const cells: NotebookCellV1[] = [];
  const seenCellIds = new Set<string>();
  for (const rawCell of obj.cells) {
    const parsed = parseCell(rawCell);
    if (parsed === null) {
      return { ok: false, reason: 'invalid-shape' };
    }
    if (parsed === 'unknown-language') {
      return { ok: false, reason: 'unknown-language' };
    }
    if (parsed === 'oversized') {
      return { ok: false, reason: 'oversized' };
    }
    if (seenCellIds.has(parsed.id)) {
      return { ok: false, reason: 'invalid-shape' };
    }
    seenCellIds.add(parsed.id);
    cells.push(parsed);
  }

  const notebook: NotebookV1 = {
    version: 1,
    id: obj.id,
    title: obj.title,
    ...(typeof obj.createdAt === 'string' ? { createdAt: obj.createdAt } : {}),
    cells,
  };
  return { ok: true, notebook };
}

type CellParseReject = 'unknown-language' | 'oversized';

function parseCell(raw: unknown): NotebookCellV1 | null | CellParseReject {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  if (typeof obj.kind !== 'string') return null;
  if (!(NOTEBOOK_CELL_KINDS as readonly string[]).includes(obj.kind)) {
    return null;
  }
  if (typeof obj.id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(obj.id)) {
    return null;
  }
  if (typeof obj.source !== 'string') return null;
  if (obj.source.length > MAX_CELL_SOURCE_LENGTH) return 'oversized';

  if (obj.kind === 'markdown') {
    return { kind: 'markdown', id: obj.id, source: obj.source };
  }

  // Code cell — language + outputs. `NOTEBOOK_CELL_LANGUAGES` is the
  // authority for the closed set of runnable cell languages (it is NOT
  // tied to the global editor `LanguagePackId` registry — `'sql'` is a
  // notebook-only cell language).
  if (typeof obj.language !== 'string') return null;
  if (!(NOTEBOOK_CELL_LANGUAGES as readonly string[]).includes(obj.language)) {
    return 'unknown-language';
  }
  if (obj.outputs !== undefined && !Array.isArray(obj.outputs)) return null;
  const outputs: NotebookCellOutputV1[] = [];
  if (Array.isArray(obj.outputs)) {
    if (obj.outputs.length > MAX_OUTPUTS_PER_CELL) return 'oversized';
    for (const rawOutput of obj.outputs) {
      const parsedOutput = parseOutput(rawOutput);
      if (parsedOutput === null) return null;
      outputs.push(parsedOutput);
    }
  }
  const answers = parseAnswers(obj.answers, obj.source);
  return {
    kind: 'code',
    id: obj.id,
    language: obj.language as NotebookCellLanguage,
    source: obj.source,
    outputs,
    ...(answers ? { answers } : {}),
  };
}

const ANSWER_TYPE_RE = /^[A-Za-z_][\w.]{0,31}$/;

function isCount(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

/**
 * Answers are derived from a run, so a malformed list is dropped instead of
 * rejecting the notebook, and an answer past the last source line is skipped.
 */
function parseAnswers(raw: unknown, source: string): NotebookLineAnswerV1[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_ANSWERS_PER_CELL) return undefined;
  const lineCount = source.split('\n').length;
  const answers: NotebookLineAnswerV1[] = [];
  for (const entry of raw) {
    const answer = parseAnswer(entry);
    if (answer === null) return undefined;
    if (answer.line <= lineCount) answers.push(answer);
  }
  return answers.length > 0 ? answers : undefined;
}

function parseAnswer(raw: unknown): NotebookLineAnswerV1 | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  if (!Number.isSafeInteger(obj.line) || (obj.line as number) < 1) return null;
  if (!(NOTEBOOK_LINE_ANSWER_KINDS as readonly unknown[]).includes(obj.kind)) return null;
  if (typeof obj.text !== 'string' || obj.text.length > MAX_ANSWER_TEXT_LENGTH) return null;
  if (obj.type !== undefined && (typeof obj.type !== 'string' || !ANSWER_TYPE_RE.test(obj.type))) return null;
  for (const key of ['size', 'rows', 'columns'] as const) {
    if (obj[key] !== undefined && !isCount(obj[key])) return null;
  }
  return {
    line: obj.line as number,
    kind: obj.kind as NotebookLineAnswerKind,
    text: obj.text,
    ...(typeof obj.type === 'string' ? { type: obj.type } : {}),
    ...(isCount(obj.size) ? { size: obj.size } : {}),
    ...(isCount(obj.rows) ? { rows: obj.rows } : {}),
    ...(isCount(obj.columns) ? { columns: obj.columns } : {}),
  };
}

/**
 * The cell with a new run's outputs and answers. No answers removes the
 * field, so a cell that never answered serializes exactly as before.
 */
export function withCellRunResults(
  cell: NotebookCodeCellV1,
  outputs: ReadonlyArray<NotebookCellOutputV1>,
  answers: ReadonlyArray<NotebookLineAnswerV1> = []
): NotebookCodeCellV1 {
  const { answers: _previous, ...rest } = cell;
  const kept = answers.slice(0, MAX_ANSWERS_PER_CELL);
  const capped = outputs.length > MAX_OUTPUTS_PER_CELL ? outputs.slice(0, MAX_OUTPUTS_PER_CELL) : outputs;
  return kept.length > 0 ? { ...rest, outputs: capped, answers: kept } : { ...rest, outputs: capped };
}

function parseOutput(raw: unknown): NotebookCellOutputV1 | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  if (obj.kind !== 'text') return null;
  if (typeof obj.text !== 'string') return null;
  if (obj.text.length > MAX_OUTPUT_TEXT_LENGTH) return null;
  if (obj.stream !== 'stdout' && obj.stream !== 'stderr') return null;
  return { kind: 'text', text: obj.text, stream: obj.stream };
}

// ---------------------------------------------------------------------------
// Serializer
// ---------------------------------------------------------------------------

/**
 * Serialize a `NotebookV1` document to a JSON string suitable for
 * disk persistence (future work) and the in-memory localStorage blob.
 * Pretty-printed with 2-space indent so a `.linguanb` opened in any
 * text editor is human-readable. Returns `null` when the document
 * exceeds the byte cap (defensive — the runtime store enforces caps
 * on every write, so this is a belt-and-suspenders guard).
 */
export function serializeNotebook(notebook: NotebookV1): string | null {
  let serialized: string;
  try {
    serialized = JSON.stringify(notebook, null, 2);
  } catch {
    return null;
  }
  if (utf8ByteLength(serialized) > MAX_NOTEBOOK_BYTES) return null;
  return serialized;
}

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

/**
 * Build a fresh empty notebook scaffold. It seeds two cells —
 * one markdown welcome + one runnable code cell — so the user lands on
 * a canvas that matches their default notebook-cell language. future work
 * can promote this to a richer starter template once the notebook editor
 * matures.
 */
export function createBlankNotebook(opts: {
  id: string;
  title: string;
  now?: string;
  initialCodeCellLanguage?: NotebookCellLanguage;
}): NotebookV1 {
  const createdAt = opts.now ?? new Date().toISOString();
  const initialCodeCellLanguage =
    opts.initialCodeCellLanguage === 'typescript' ? 'typescript' : 'javascript';
  return {
    version: 1,
    id: opts.id,
    title: opts.title,
    createdAt,
    cells: [
      {
        kind: 'markdown',
        id: 'cell-welcome',
        source:
          '# Welcome to Lingua notebooks\n\nRun this code cell, then add your own cells with the toolbar above.',
      },
      {
        kind: 'code',
        id: 'cell-first',
        language: initialCodeCellLanguage,
        source: 'const x = 21;\nconsole.log(x * 2);',
        outputs: [],
      },
    ],
  };
}

/**
 * Convenience guard for store callers + UI gating. The runner executes
 * all four code-cell languages — `'javascript' | 'typescript'` (JS
 * worker, cross-cell state), `'python'` (independent per
 * cell), and `'sql'` (shared DuckDB engine, table output). See
 * `notebookSession.ts`.
 */
export function isNotebookCodeCell(cell: NotebookCellV1): cell is NotebookCodeCellV1 {
  return cell.kind === 'code';
}

export function isNotebookMarkdownCell(cell: NotebookCellV1): cell is NotebookMarkdownCellV1 {
  return cell.kind === 'markdown';
}

/** Canonical v1 document envelope serializer; no execution evidence graph. */
export const LINGUANB_DOCUMENT_VERSION = 1;
export const LINGUANB_FILE_EXTENSION = '.linguanb';
export const MAX_LINGUANB_BYTES = 512 * 1024;

export function serializeNotebookDocument(
  notebook: NotebookV1,
  opts: { executionOrder?: Readonly<Record<string, number>> } = {}
): string {
  const cellIds = new Set(notebook.cells.map(cell => cell.id));
  const order: Record<string, number> = {};
  for (const [cellId, value] of Object.entries(opts.executionOrder ?? {})) {
    if (cellIds.has(cellId) && Number.isInteger(value) && value > 0) {
      order[cellId] = value;
    }
  }
  const document: NotebookDocumentV1 = {
    format: 'linguanb',
    documentVersion: LINGUANB_DOCUMENT_VERSION,
    notebook,
    ...(Object.keys(order).length > 0 ? { executionOrder: order } : {}),
  };
  return `${JSON.stringify(document, null, 2)}\n`;
}

export type NotebookDocumentExportOutcome =
  | { ok: true; json: string }
  | { ok: false; reason: 'oversized'; bytes: number; limit: number };

/** Export path: refuse a document the reader would reject as `oversized`. */
export function serializeNotebookDocumentWithinLimit(
  notebook: NotebookV1,
  opts: { executionOrder?: Readonly<Record<string, number>> } = {}
): NotebookDocumentExportOutcome {
  let json = serializeNotebookDocument(notebook, opts);
  let bytes = utf8ByteLength(json);
  // Answers are derived from a run; a notebook that fits without them still saves.
  if (bytes > MAX_LINGUANB_BYTES && notebook.cells.some((cell) => cell.kind === 'code' && cell.answers)) {
    const cells = notebook.cells.map((cell) => (cell.kind === 'code' ? withCellRunResults(cell, cell.outputs) : cell));
    json = serializeNotebookDocument({ ...notebook, cells }, opts);
    bytes = utf8ByteLength(json);
  }
  return bytes > MAX_LINGUANB_BYTES
    ? { ok: false, reason: 'oversized', bytes, limit: MAX_LINGUANB_BYTES }
    : { ok: true, json };
}
