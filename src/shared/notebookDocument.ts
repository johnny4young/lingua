/**
 * RL-043 Slice E — `.linguanb` native notebook document.
 *
 * The lossless, Lingua-native counterpart to the lossy `.ipynb`
 * export/import (Slice D, `notebookExportToIpynb.ts` +
 * `ipynbImporter.ts`). Where `.ipynb` is a single-kernel interchange
 * format that flattens per-cell language and drops detail, a
 * `.linguanb` document round-trips a `NotebookV1` with NOTHING lost:
 * cell ids, per-cell language (incl. TypeScript), markdown, outputs,
 * title, and createdAt all survive, plus the per-cell Jupyter-style
 * `[N]` execution-order stamps the in-app store tracks transiently
 * (fold B).
 *
 * The document is an ENVELOPE around `NotebookV1` (not the bare
 * notebook) for two reasons:
 *   - `format: 'linguanb'` is an explicit discriminator so the importer
 *     `detect()` claims it unambiguously and never collides with
 *     `.ipynb` (`nbformat`) or Postman (`info` + `item`).
 *   - `executionOrder` is transient store state, NOT part of
 *     `NotebookV1` (the in-app model), so it rides on the envelope
 *     rather than polluting the notebook schema.
 *
 * Pure module — no IPC, no clipboard. The renderer wraps the JSON in a
 * Blob for download (web) or hands it to the capability IPC for a disk
 * save (desktop, fold A); the importer adapter parses it back.
 */

import {
  parseNotebook,
  utf8ByteLength,
  type NotebookV1,
} from './notebook';

/** Current `.linguanb` envelope schema version. */
export const LINGUANB_DOCUMENT_VERSION = 1;

/** File extension + the recommended MIME hint for downloads. */
export const LINGUANB_FILE_EXTENSION = '.linguanb';

/**
 * Defensive byte cap on the raw `.linguanb` source before `JSON.parse`.
 * This envelope cap is the effective byte bound on the inner notebook:
 * `parseNotebookDocument` hands `parseNotebook` the already-decoded
 * notebook OBJECT, so `parseNotebook`'s own `MAX_NOTEBOOK_BYTES`
 * (256 KiB) string cap never runs on this path — only its per-cell,
 * per-output, and cell-count caps do. 512 KiB is 2x the inner-notebook
 * string cap, comfortable headroom for the same notebook pretty-printed
 * (2-space indent) plus the envelope + `executionOrder` map, while
 * still guarding against a pathological multi-megabyte paste stalling
 * the parser.
 */
export const MAX_LINGUANB_BYTES = 512 * 1024;

/**
 * Closed-enum reject reasons returned by `parseNotebookDocument`.
 * Mirrors the `IPYNB_REJECT_REASONS` / `POSTMAN_REJECT_REASONS`
 * taxonomy so the importer adapter can surface a localized hint via
 * `importPreview.reject.linguanb.<code>` keys. Adding a reason is
 * additive; renaming/removing breaks the i18n hint map.
 *
 *   - `malformed-json`: the source is not parseable JSON.
 *   - `wrong-version`: the envelope `documentVersion` is not 1 (a
 *     future format we refuse to silently down-convert).
 *   - `invalid-shape`: missing/incorrect envelope fields, OR the inner
 *     notebook fails `parseNotebook` for any non-version reason.
 *   - `oversized`: the raw source exceeds `MAX_LINGUANB_BYTES`.
 */
export const LINGUANB_REJECT_REASONS = [
  'malformed-json',
  'wrong-version',
  'invalid-shape',
  'oversized',
] as const;
export type LinguanbRejectReason = (typeof LINGUANB_REJECT_REASONS)[number];

/**
 * The `.linguanb` document envelope. `notebook` is the lossless
 * payload; `executionOrder` (fold B) is the per-cell `[N]` stamp map
 * (`cellId -> positive integer`) captured from the runtime store at
 * export time, restored on import so a round-trip is faithful down to
 * the execution counters. Cells absent from the map were never run.
 */
export interface NotebookDocumentV1 {
  readonly format: 'linguanb';
  readonly documentVersion: typeof LINGUANB_DOCUMENT_VERSION;
  readonly notebook: NotebookV1;
  readonly executionOrder?: Readonly<Record<string, number>>;
}

/** Discriminated outcome of `parseNotebookDocument` — never throws. */
export type NotebookDocumentParseOutcome =
  | { readonly ok: true; readonly document: NotebookDocumentV1 }
  | { readonly ok: false; readonly reason: LinguanbRejectReason };

/**
 * Cheap probe: does this look like a `.linguanb` document? Substring
 * sniff over the first 4 KiB (whitespace-stripped) — must start with
 * `{` and carry the `"format":"linguanb"` marker, which no other
 * importer's payload pairs. File extension is NOT trusted (paste may
 * arrive without one).
 */
export function detectLinguanbDocument(source: string): boolean {
  if (typeof source !== 'string') return false;
  const probe = source.slice(0, 4096).replace(/\s+/g, '');
  if (!probe.startsWith('{')) return false;
  return probe.includes('"format":"linguanb"');
}

/**
 * Serialize a notebook (plus its optional execution-order map) into a
 * pretty-printed `.linguanb` JSON string. 2-space indent keeps a
 * `.linguanb` opened in any text editor human-readable. The
 * `executionOrder` entry is omitted entirely when empty so a notebook
 * that was never run produces a clean document. Stamps are sanitized
 * to the document's own cell ids (a stale stamp for a deleted cell is
 * dropped) and to positive integers.
 */
export function serializeNotebookDocument(
  notebook: NotebookV1,
  opts: { executionOrder?: Readonly<Record<string, number>> } = {}
): string {
  const cellIds = new Set(notebook.cells.map((cell) => cell.id));
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

/**
 * Parse a raw `.linguanb` JSON string into a typed
 * `NotebookDocumentV1`. Always settles to a discriminated outcome —
 * never throws. The inner notebook is validated by the canonical
 * `parseNotebook` so the `.linguanb` open path inherits every cell /
 * cap / language guard for free; a `wrong-version` from the inner
 * notebook is surfaced as the envelope's `wrong-version`, anything
 * else as `invalid-shape`.
 */
export function parseNotebookDocument(
  source: string
): NotebookDocumentParseOutcome {
  if (typeof source !== 'string') {
    return { ok: false, reason: 'invalid-shape' };
  }
  if (utf8ByteLength(source) > MAX_LINGUANB_BYTES) {
    return { ok: false, reason: 'oversized' };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(source);
  } catch {
    return { ok: false, reason: 'malformed-json' };
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, reason: 'invalid-shape' };
  }
  const obj = raw as Record<string, unknown>;
  if (obj.format !== 'linguanb') {
    return { ok: false, reason: 'invalid-shape' };
  }
  if (typeof obj.documentVersion !== 'number') {
    return { ok: false, reason: 'invalid-shape' };
  }
  if (obj.documentVersion !== LINGUANB_DOCUMENT_VERSION) {
    return { ok: false, reason: 'wrong-version' };
  }
  if (obj.notebook === null || typeof obj.notebook !== 'object') {
    return { ok: false, reason: 'invalid-shape' };
  }
  const inner = parseNotebook(obj.notebook);
  if (!inner.ok) {
    // A future notebook schema maps outward to wrong-version so the
    // user gets the version hint, not a generic shape error.
    return {
      ok: false,
      reason: inner.reason === 'wrong-version' ? 'wrong-version' : 'invalid-shape',
    };
  }
  const executionOrder = parseExecutionOrder(obj.executionOrder, inner.notebook);
  return {
    ok: true,
    document: {
      format: 'linguanb',
      documentVersion: LINGUANB_DOCUMENT_VERSION,
      notebook: inner.notebook,
      ...(executionOrder ? { executionOrder } : {}),
    },
  };
}

/**
 * Validate the optional `executionOrder` map: a flat `cellId ->
 * positive integer` record restricted to the document's own cell ids.
 * Unknown keys, non-integer / non-positive values, and a non-object
 * are dropped silently (forward-compat) rather than rejecting the
 * whole document. Returns `undefined` when nothing survives.
 */
function parseExecutionOrder(
  raw: unknown,
  notebook: NotebookV1
): Record<string, number> | undefined {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return undefined;
  }
  const cellIds = new Set(notebook.cells.map((cell) => cell.id));
  const order: Record<string, number> = {};
  for (const [cellId, value] of Object.entries(raw as Record<string, unknown>)) {
    if (cellIds.has(cellId) && typeof value === 'number' && Number.isInteger(value) && value > 0) {
      order[cellId] = value;
    }
  }
  return Object.keys(order).length > 0 ? order : undefined;
}
