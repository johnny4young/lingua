/**
 * RL-100 Slice 2 — Jupyter `.ipynb` → `NotebookV1` importer adapter.
 *
 * Closes the bridge "bring your Jupyter notebook into Lingua". The
 * adapter walks nbformat v4 cells, maps each one to a
 * `NotebookCellV1` (`markdown` / `code`), drops unsupported cell
 * kinds (`raw`) and rich outputs with a closed-enum warning code,
 * and enforces RL-043 Slice A caps at the preview boundary so the
 * resulting notebook always passes `parseNotebook` on commit.
 *
 * Design boundaries (per the 2026-05-27 plan):
 *
 *   - Pure parser. Runs entirely in the renderer + shared layer; NO
 *     IPC, NO network, NO sandboxed eval.
 *   - Closed-enum outcome (`ImporterPreviewOutcome<IpynbImporterPreview>`)
 *     with `IPYNB_REJECT_REASONS` carried in the `detail` slot so the
 *     UI can render an ipynb-specific localized hint without widening
 *     the generic `IMPORTER_REJECT_REASONS` taxonomy.
 *   - Output preservation is lossy by design: only the `text/plain`
 *     MIME variant of each output survives as a
 *     `NotebookCellOutputV1`; `image/png`, `text/html`, `application/json`
 *     etc. are dropped with a `'ipynb-rich-output-dropped'` warning.
 *     RL-043 Slice B's rich-outputs wire-up closes this gap.
 *   - Cell language defaults to `'javascript'` when
 *     `metadata.kernelspec.language` is missing / unsupported (warning
 *     `'ipynb-unknown-language'` surfaces). Python + TypeScript pass
 *     through unchanged.
 *
 * The adapter contract (`ImporterAdapter<IpynbImporterPreview,
 * IpynbImporterResult>`) is the same as the cURL adapter — `detect`
 * + `preview` + `import`. Folds B (detection by extension + content
 * sniff) lives in `detect`; folds D (cell-count + language summary
 * chip) lives in the preview shape.
 */

import {
  createBlankNotebook,
  isNotebookCodeCell,
  MAX_CELL_SOURCE_LENGTH,
  MAX_CELLS_PER_NOTEBOOK,
  MAX_NOTEBOOK_BYTES,
  MAX_OUTPUT_TEXT_LENGTH,
  MAX_OUTPUTS_PER_CELL,
  NOTEBOOK_CELL_LANGUAGES,
  utf8ByteLength,
  type NotebookCellLanguage,
  type NotebookCellOutputV1,
  type NotebookCellV1,
  type NotebookCodeCellV1,
  type NotebookMarkdownCellV1,
  type NotebookV1,
} from '../notebook';
import type {
  ImporterAdapter,
  ImporterLossyWarning,
  ImporterPreviewOutcome,
  IpynbRejectReason,
  NotebookWarningKind,
} from './types';

// ---------------------------------------------------------------------------
// Public shapes
// ---------------------------------------------------------------------------

/**
 * Per-cell preview snippet — small DTO the UI uses to render the
 * "first N cells" band without loading the full notebook into the
 * DOM. Keeps the preview band's rendering cost bounded.
 */
export interface IpynbCellSnippet {
  readonly kind: 'markdown' | 'code';
  readonly language?: NotebookCellLanguage;
  /** Trimmed source preview (first 200 chars). */
  readonly preview: string;
  /** Number of outputs (code cells only). */
  readonly outputCount?: number;
}

/**
 * Preview shape returned by `adapter.preview(source)`. Holds the
 * already-mapped `NotebookV1` so `import(preview)` is a constant-time
 * round-trip. Fold D: `cellCounts` + `dominantLanguage` drive the
 * summary chip in `<ImportPreviewBody>`.
 */
export interface IpynbImporterPreview {
  /** Discriminator so `<ImportPreviewBody>` branches per importer. */
  readonly kind: 'ipynb-notebook';
  /** The mapped `NotebookV1` ready for `notebookStore.createNotebookForTab`. */
  readonly notebook: NotebookV1;
  /** Snippets of the first up-to-3 cells for the preview band. */
  readonly cellSnippets: ReadonlyArray<IpynbCellSnippet>;
  /** Cell counts (fold D summary chip). */
  readonly cellCounts: {
    readonly total: number;
    readonly code: number;
    readonly markdown: number;
    readonly droppedRaw: number;
  };
  /**
   * Dominant code-cell language. `null` when there are no code cells
   * or the languages tie. Fold F uses this to auto-flip the
   * FloatingActionPill language chip after confirm.
   */
  readonly dominantLanguage: NotebookCellLanguage | null;
  /** Title derived from `metadata.title` or the filename guess. */
  readonly title: string;
  /** Closed-enum warning occurrences emitted during the mapping pass. */
  readonly warnings: ReadonlyArray<ImporterLossyWarning>;
}

/**
 * Commit shape — what `import(preview)` returns to the caller.
 * Pure data; the caller (the `useImportPreview` hook) is responsible
 * for writing the notebook into `useNotebookStore` and minting a new
 * tab via `editorStore.addNotebookTab`.
 */
export interface IpynbImporterResult {
  readonly notebook: NotebookV1;
  readonly title: string;
  /**
   * The dominant code-cell language (`null` when none). Caller may
   * use this to auto-flip the FloatingActionPill language chip
   * (fold F).
   */
  readonly dominantLanguage: NotebookCellLanguage | null;
}

// ---------------------------------------------------------------------------
// Closed-enum mapping helpers
// ---------------------------------------------------------------------------

/**
 * Map `kernelspec.language` (lowercase) to Lingua's closed
 * `NOTEBOOK_CELL_LANGUAGES`. Unknown languages return `null` (caller
 * falls back to `'javascript'` with a warning).
 */
function mapKernelLanguage(
  raw: unknown
): NotebookCellLanguage | null {
  if (typeof raw !== 'string') return null;
  const lower = raw.trim().toLowerCase();
  // Direct hits.
  if ((NOTEBOOK_CELL_LANGUAGES as readonly string[]).includes(lower)) {
    return lower as NotebookCellLanguage;
  }
  // Common Jupyter aliases.
  if (lower === 'js' || lower === 'node' || lower === 'nodejs') return 'javascript';
  if (lower === 'ts') return 'typescript';
  if (lower === 'python3' || lower === 'py' || lower === 'py3') return 'python';
  return null;
}

/**
 * Map a closed-enum `IMPORTER_LOSSY_WARNINGS` ipynb code to the
 * `NOTEBOOK_WARNING_KINDS` telemetry bucket (fold E).
 */
export function mapWarningToTelemetryKind(
  code: ImporterLossyWarning
): NotebookWarningKind | null {
  switch (code) {
    case 'ipynb-raw-cell-dropped':
      return 'raw-cell-dropped';
    case 'ipynb-rich-output-dropped':
      return 'rich-output-dropped';
    case 'ipynb-unknown-language':
      return 'unknown-language';
    case 'ipynb-execute-result-stripped':
      return 'execute-result-stripped';
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Output mapping — Jupyter cell output → NotebookCellOutputV1
// ---------------------------------------------------------------------------

interface RawCellOutput {
  output_type?: unknown;
  data?: Record<string, unknown>;
  text?: unknown;
  ename?: unknown;
  evalue?: unknown;
  traceback?: unknown;
}

/**
 * Flatten one Jupyter output to a `NotebookCellOutputV1` text entry,
 * or `null` when nothing salvageable.
 *
 * Supported `output_type` values per nbformat v4:
 *   - `stream` — `text` field is the stdout/stderr payload.
 *   - `execute_result` / `display_data` — `data['text/plain']` is the
 *     fallback text representation; anything else is dropped (warning
 *     `'ipynb-rich-output-dropped'` surfaced separately by the caller).
 *   - `error` — `ename` + `evalue` + `traceback` join into stderr.
 *
 * Returned `kind: 'text'` matches `NotebookCellOutputV1`'s only
 * arm Slice A ships.
 */
function flattenJupyterOutput(
  raw: RawCellOutput,
  warningSink: ImporterLossyWarning[]
): NotebookCellOutputV1 | null {
  const outputType = typeof raw.output_type === 'string' ? raw.output_type : '';
  if (outputType === 'stream') {
    const text = jupyterTextFieldToString(raw.text);
    if (text.length === 0) return null;
    // Jupyter stream output carries `name: 'stdout' | 'stderr'`; we
    // don't have it on the `RawCellOutput` typing, fall back to stdout.
    const streamName = readStreamName(raw);
    return {
      kind: 'text',
      text: clampOutputText(text),
      stream: streamName,
    };
  }
  if (outputType === 'execute_result' || outputType === 'display_data') {
    const data = raw.data;
    if (data === null || typeof data !== 'object') return null;
    const dataObj = data as Record<string, unknown>;
    // Check for rich-only payload (no text/plain fallback) — surface
    // the lossy-warning even when we return null.
    const hasRich = Object.keys(dataObj).some(
      (mime) => mime !== 'text/plain' && dataObj[mime] !== undefined
    );
    const plain = dataObj['text/plain'];
    if (plain === undefined) {
      if (hasRich) addWarning(warningSink, 'ipynb-rich-output-dropped');
      return null;
    }
    if (hasRich) addWarning(warningSink, 'ipynb-rich-output-dropped');
    const text = jupyterTextFieldToString(plain);
    if (text.length === 0) return null;
    return {
      kind: 'text',
      text: clampOutputText(text),
      stream: 'stdout',
    };
  }
  if (outputType === 'error') {
    const ename = typeof raw.ename === 'string' ? raw.ename : '';
    const evalue = typeof raw.evalue === 'string' ? raw.evalue : '';
    const traceback = Array.isArray(raw.traceback)
      ? raw.traceback
          .filter((entry): entry is string => typeof entry === 'string')
          .join('\n')
      : '';
    const composed = [ename && evalue ? `${ename}: ${evalue}` : ename || evalue, traceback]
      .filter((segment) => segment.length > 0)
      .join('\n');
    if (composed.length === 0) return null;
    return {
      kind: 'text',
      text: clampOutputText(stripAnsi(composed)),
      stream: 'stderr',
    };
  }
  // Unknown output type — drop silently. Jupyter spec keeps the
  // surface small; future additions get a no-op until we wire them.
  return null;
}

function addWarning(
  warningSink: ImporterLossyWarning[],
  warning: ImporterLossyWarning
): void {
  warningSink.push(warning);
}

function readStreamName(raw: RawCellOutput): 'stdout' | 'stderr' {
  const maybeName = (raw as { name?: unknown }).name;
  return typeof maybeName === 'string' && maybeName.toLowerCase() === 'stderr'
    ? 'stderr'
    : 'stdout';
}

function jupyterTextFieldToString(field: unknown): string {
  // nbformat allows both string AND array-of-strings (one entry per line).
  if (typeof field === 'string') return field;
  if (Array.isArray(field)) {
    return field
      .filter((entry): entry is string => typeof entry === 'string')
      .join('');
  }
  return '';
}

function clampOutputText(text: string): string {
  if (text.length <= MAX_OUTPUT_TEXT_LENGTH) return text;
  return `${text.slice(0, MAX_OUTPUT_TEXT_LENGTH - 1)}…`;
}

/**
 * Strip terminal ANSI escape sequences (Jupyter tracebacks include
 * color codes). Conservative regex; covers the SGR sequences that
 * matter for traceback rendering.
 */
function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\[[\d;]*m/g, '');
}

// ---------------------------------------------------------------------------
// Cell mapping — Jupyter cell → NotebookCellV1
// ---------------------------------------------------------------------------

interface RawJupyterCell {
  cell_type?: unknown;
  source?: unknown;
  outputs?: unknown;
  metadata?: unknown;
  execution_count?: unknown;
  id?: unknown;
}

function jupyterSourceToString(source: unknown): string {
  if (typeof source === 'string') return source;
  if (Array.isArray(source)) {
    return source
      .filter((entry): entry is string => typeof entry === 'string')
      .join('');
  }
  return '';
}

function nextCellId(index: number): string {
  return `cell-${index.toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

interface MapCellOptions {
  index: number;
  notebookLanguage: NotebookCellLanguage;
  warningSink: ImporterLossyWarning[];
}

function mapMarkdownCell(
  raw: RawJupyterCell,
  opts: MapCellOptions
): NotebookMarkdownCellV1 {
  const source = clampCellSource(jupyterSourceToString(raw.source));
  return {
    kind: 'markdown',
    id: nextCellId(opts.index),
    source,
  };
}

function mapCodeCell(
  raw: RawJupyterCell,
  opts: MapCellOptions
): NotebookCodeCellV1 {
  const source = clampCellSource(jupyterSourceToString(raw.source));
  const outputs: NotebookCellOutputV1[] = [];
  if (raw.execution_count !== undefined && raw.execution_count !== null) {
    // `execution_count` is cell metadata in nbformat v4. Warn once per
    // executed cell regardless of which output variants are present.
    addWarning(opts.warningSink, 'ipynb-execute-result-stripped');
  }
  if (Array.isArray(raw.outputs)) {
    for (const rawOutput of raw.outputs) {
      if (outputs.length >= MAX_OUTPUTS_PER_CELL) break;
      if (rawOutput === null || typeof rawOutput !== 'object') continue;
      const mapped = flattenJupyterOutput(
        rawOutput as RawCellOutput,
        opts.warningSink
      );
      if (mapped) outputs.push(mapped);
    }
  }
  return {
    kind: 'code',
    id: nextCellId(opts.index),
    language: opts.notebookLanguage,
    source,
    outputs,
  };
}

function clampCellSource(source: string): string {
  if (source.length <= MAX_CELL_SOURCE_LENGTH) return source;
  return source.slice(0, MAX_CELL_SOURCE_LENGTH);
}

// ---------------------------------------------------------------------------
// Detect — fast probe
// ---------------------------------------------------------------------------

/**
 * Probe: does this look like a Jupyter notebook?
 *
 * Fold B — accepts BOTH `.ipynb`-style content sniff (a `{"cells":`
 * substring inside the import cap) AND a relaxed `"nbformat":`
 * match. File extension alone is not trusted; the payload still has
 * to look like notebook JSON before the adapter claims it.
 */
function detectIpynb(source: string): boolean {
  if (typeof source !== 'string') return false;
  // Cheap byte cap so a 10 MB blob doesn't slow detection, while
  // still accepting valid notebooks whose metadata block appears
  // before `cells` / `nbformat`.
  const probe = source.slice(0, MAX_NOTEBOOK_BYTES).replace(/\s+/g, '');
  if (!probe.startsWith('{')) return false;
  // Must mention either `cells` OR `nbformat` near the start to claim
  // the input. Both are required by nbformat v4 so either is a
  // strong signal.
  return probe.includes('"cells":') || probe.includes('"nbformat":');
}

// ---------------------------------------------------------------------------
// Preview — parse + map + cap enforcement
// ---------------------------------------------------------------------------

/**
 * `detail` carries an IPYNB_REJECT_REASONS code on rejection. The
 * outer `reason` stays in `IMPORTER_REJECT_REASONS` (closed UI
 * surface). Mapping:
 *
 *   malformed-json       → outer 'malformed'
 *   invalid-shape        → outer 'malformed'
 *   wrong-version        → outer 'unsupported-feature'
 *   oversized            → outer 'unsupported-feature'
 *   too-many-cells       → outer 'unsupported-feature'
 */
function rejectWith(
  reason: 'malformed' | 'unsupported-feature',
  detail: IpynbRejectReason
): ImporterPreviewOutcome<IpynbImporterPreview> {
  return { ok: false, reason, detail };
}

function previewIpynb(
  source: string
): ImporterPreviewOutcome<IpynbImporterPreview> {
  if (typeof source !== 'string' || source.trim().length === 0) {
    return { ok: false, reason: 'empty-input' };
  }
  // Byte cap BEFORE parse so a giant blob can't OOM the renderer.
  if (utf8ByteLength(source) > MAX_NOTEBOOK_BYTES) {
    return rejectWith('unsupported-feature', 'oversized');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    return rejectWith('malformed', 'malformed-json');
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return rejectWith('malformed', 'invalid-shape');
  }
  const root = parsed as Record<string, unknown>;

  // nbformat version gate. nbformat v4 (any minor) is the only
  // supported family. v3 / v2 / v1 use a sufficiently different
  // schema that mapping them honestly requires its own slice.
  const nbformat = root.nbformat;
  if (nbformat !== 4) {
    return rejectWith('unsupported-feature', 'wrong-version');
  }
  if (!Array.isArray(root.cells)) {
    return rejectWith('malformed', 'invalid-shape');
  }
  const rawCells = root.cells;
  if (rawCells.length > MAX_CELLS_PER_NOTEBOOK) {
    return rejectWith('unsupported-feature', 'too-many-cells');
  }

  // Resolve notebook-level language from `metadata.kernelspec.language`.
  // Every imported code cell inherits this value; future round-trip
  // metadata can add per-cell overrides when the export path exists.
  const metadata =
    root.metadata !== null && typeof root.metadata === 'object'
      ? (root.metadata as Record<string, unknown>)
      : {};
  const kernelspec =
    metadata.kernelspec !== null && typeof metadata.kernelspec === 'object'
      ? (metadata.kernelspec as Record<string, unknown>)
      : {};
  const warningSink: ImporterLossyWarning[] = [];
  const inferredLanguage = mapKernelLanguage(kernelspec.language);
  let notebookLanguage: NotebookCellLanguage;
  if (inferredLanguage === null) {
    notebookLanguage = 'javascript';
    if (kernelspec.language !== undefined && kernelspec.language !== null) {
      addWarning(warningSink, 'ipynb-unknown-language');
    }
  } else {
    notebookLanguage = inferredLanguage;
  }

  // Walk cells.
  const cells: NotebookCellV1[] = [];
  let droppedRawCount = 0;
  for (let idx = 0; idx < rawCells.length; idx += 1) {
    const rawCell = rawCells[idx];
    if (
      rawCell === null ||
      typeof rawCell !== 'object' ||
      Array.isArray(rawCell)
    ) {
      return rejectWith('malformed', 'invalid-shape');
    }
    const cell = rawCell as RawJupyterCell;
    const cellType = typeof cell.cell_type === 'string' ? cell.cell_type : '';
    if (cellType === 'markdown') {
      cells.push(
        mapMarkdownCell(cell, { index: idx, notebookLanguage, warningSink })
      );
      continue;
    }
    if (cellType === 'code') {
      cells.push(
        mapCodeCell(cell, { index: idx, notebookLanguage, warningSink })
      );
      continue;
    }
    if (cellType === 'raw') {
      droppedRawCount += 1;
      addWarning(warningSink, 'ipynb-raw-cell-dropped');
      continue;
    }
    return rejectWith('malformed', 'invalid-shape');
  }

  // Build a NotebookV1 that always passes `parseNotebook` on commit.
  // Empty notebooks get the blank seed so the user lands on a
  // runnable canvas instead of an empty cells panel.
  const title = deriveNotebookTitle(metadata);
  let notebook: NotebookV1;
  if (cells.length === 0) {
    notebook = createBlankNotebook({
      id: `ipynb-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      title,
    });
  } else {
    notebook = {
      version: 1,
      id: `ipynb-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      title,
      createdAt: new Date().toISOString(),
      cells,
    };
  }

  // When the source mapped to zero usable cells the user still lands
  // on the seeded blank notebook (welcome + demo). Base the summary
  // chip, the snippet band, AND the dominant language on the cells the
  // user ACTUALLY gets so the three never contradict each other. Before
  // this, an empty / all-raw `.ipynb` reported `cellCounts.total: 0`
  // while the snippet band + the committed notebook both showed the 2
  // seeded cells — the preview chip read "0 cells" for a notebook the
  // user opened with 2.
  const surfacedCells = cells.length > 0 ? cells : notebook.cells;
  const cellSnippets = buildCellSnippets(surfacedCells);
  const cellCounts = countCells(surfacedCells, droppedRawCount);
  const dominantLanguage = pickDominantLanguage(surfacedCells);

  const preview: IpynbImporterPreview = {
    kind: 'ipynb-notebook',
    notebook,
    cellSnippets,
    cellCounts,
    dominantLanguage,
    title,
    warnings: warningSink,
  };
  return { ok: true, preview, warnings: preview.warnings };
}

function deriveNotebookTitle(metadata: Record<string, unknown>): string {
  const direct = metadata.title;
  if (typeof direct === 'string' && direct.trim().length > 0) {
    return direct.trim().slice(0, 120);
  }
  // `metadata.kernelspec.display_name` is a reasonable fallback
  // (e.g. "Python 3.11").
  const kernelspec = metadata.kernelspec as Record<string, unknown> | undefined;
  const displayName = kernelspec?.display_name;
  if (typeof displayName === 'string' && displayName.trim().length > 0) {
    return `Imported (${displayName.trim().slice(0, 100)})`;
  }
  return 'Imported notebook';
}

const CELL_SNIPPET_PREVIEW_LENGTH = 200;
const CELL_SNIPPET_MAX_COUNT = 3;

function buildCellSnippets(
  cells: ReadonlyArray<NotebookCellV1>
): IpynbCellSnippet[] {
  const snippets: IpynbCellSnippet[] = [];
  for (const cell of cells.slice(0, CELL_SNIPPET_MAX_COUNT)) {
    if (isNotebookCodeCell(cell)) {
      snippets.push({
        kind: 'code',
        language: cell.language,
        preview: cell.source.slice(0, CELL_SNIPPET_PREVIEW_LENGTH),
        outputCount: cell.outputs.length,
      });
    } else {
      snippets.push({
        kind: 'markdown',
        preview: cell.source.slice(0, CELL_SNIPPET_PREVIEW_LENGTH),
      });
    }
  }
  return snippets;
}

function countCells(
  cells: ReadonlyArray<NotebookCellV1>,
  droppedRaw: number
): IpynbImporterPreview['cellCounts'] {
  let code = 0;
  let markdown = 0;
  for (const cell of cells) {
    if (isNotebookCodeCell(cell)) code += 1;
    else markdown += 1;
  }
  return {
    total: cells.length,
    code,
    markdown,
    droppedRaw,
  };
}

function pickDominantLanguage(
  cells: ReadonlyArray<NotebookCellV1>
): NotebookCellLanguage | null {
  const counts: Partial<Record<NotebookCellLanguage, number>> = {};
  let topCount = 0;
  let topLanguage: NotebookCellLanguage | null = null;
  let tie = false;
  for (const cell of cells) {
    if (!isNotebookCodeCell(cell)) continue;
    const next = (counts[cell.language] ?? 0) + 1;
    counts[cell.language] = next;
    if (next > topCount) {
      topCount = next;
      topLanguage = cell.language;
      tie = false;
    } else if (next === topCount && cell.language !== topLanguage) {
      tie = true;
    }
  }
  if (tie || topLanguage === null) return null;
  return topLanguage;
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export const ipynbImporterAdapter: ImporterAdapter<
  IpynbImporterPreview,
  IpynbImporterResult
> = {
  id: 'ipynb-notebook',
  titleKey: 'importPreview.importer.ipynbNotebook.title',
  descriptionKey: 'importPreview.importer.ipynbNotebook.description',
  detect: detectIpynb,
  preview: previewIpynb,
  import: (preview) => ({
    notebook: preview.notebook,
    title: preview.title,
    dominantLanguage: preview.dominantLanguage,
  }),
};
