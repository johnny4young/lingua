/**
 * implementation — export a Lingua notebook to a Jupyter `.ipynb`
 * (nbformat v4) document, the symmetric counterpart of the internal
 * `.ipynb` importer (`src/shared/importers/ipynbImporter.ts`).
 *
 * Pure helper (mirrors `notebookExportToScript`): the component layer
 * wraps the JSON in a `Blob` + `URL.createObjectURL` for download. No
 * clipboard / no IPC.
 *
 * Fidelity notes:
 *   - nbformat is a SINGLE-kernel format, so `metadata.kernelspec.language`
 *     carries the dominant code-cell language. To keep a Lingua→Lingua
 *     round-trip lossless for MIXED-language notebooks (implementation note), each code
 *     cell ALSO stashes its real language in `metadata.lingua.language`
 *     (Jupyter ignores unknown metadata; the importer reads it back).
 *   - `execution_count` carries Lingua's Jupyter `[N]` stamp when known
 *     (implementation note), else `null`.
 *   - implementation cells only carry text outputs, mapped to nbformat
 *     `stream` outputs (implementation note of the importer's vocabulary).
 */

import {
  isNotebookCodeCell,
  isNotebookMarkdownCell,
  type NotebookCellLanguage,
  type NotebookCellOutputV1,
  type NotebookV1,
} from '../../../shared/notebook';
import { pickNotebookExportLanguage } from './notebookExportToScript';

/** nbformat v4 `stream` output — the only output kind Lingua emits today. */
interface IpynbStreamOutput {
  readonly output_type: 'stream';
  readonly name: 'stdout' | 'stderr';
  readonly text: string[];
}

/**
 * nbformat v4 code cell. `metadata.lingua.language` is a Lingua-private
 * extension (implementation note) that the importer reads back so a mixed-language
 * notebook round-trips losslessly; standard Jupyter ignores it.
 */
interface IpynbCodeCell {
  readonly cell_type: 'code';
  readonly id: string;
  readonly metadata: { readonly lingua: { readonly language: NotebookCellLanguage } };
  readonly execution_count: number | null;
  readonly source: string[];
  readonly outputs: IpynbStreamOutput[];
}

/** nbformat v4 markdown cell. */
interface IpynbMarkdownCell {
  readonly cell_type: 'markdown';
  readonly id: string;
  readonly metadata: Record<string, never>;
  readonly source: string[];
}

type IpynbCell = IpynbCodeCell | IpynbMarkdownCell;

/**
 * nbformat v4 notebook document. `metadata.lingua` marks Lingua-origin
 * files for the round-trip; `kernelspec` + `language_info` (implementation note) make
 * the file open cleanly in real Jupyter / VS Code / Colab.
 */
interface IpynbNotebookV4 {
  readonly cells: IpynbCell[];
  readonly metadata: {
    readonly kernelspec: {
      readonly name: string;
      readonly display_name: string;
      readonly language: NotebookCellLanguage;
    };
    readonly language_info: {
      readonly name: string;
      readonly file_extension: string;
      readonly version: string;
    };
    readonly lingua: { readonly notebookId: string; readonly exportedFrom: 'lingua' };
  };
  readonly nbformat: 4;
  readonly nbformat_minor: number;
}

/** Result of an `.ipynb` export — pretty-printed JSON + a suggested name. */
export interface NotebookIpynbExportResult {
  /** Pretty-printed nbformat v4 JSON, ready for a `Blob`. */
  readonly json: string;
  /** Suggested file name (kebab-cased title + `.ipynb`). */
  readonly suggestedFileName: string;
}

/** Per-language `language_info` block (implementation note) for Jupyter compatibility. */
const LANGUAGE_INFO: Record<
  NotebookCellLanguage,
  { name: string; file_extension: string; version: string }
> = {
  javascript: { name: 'javascript', file_extension: '.js', version: 'ES2022' },
  typescript: { name: 'typescript', file_extension: '.ts', version: '5' },
  python: { name: 'python', file_extension: '.py', version: '3' },
  sql: { name: 'sql', file_extension: '.sql', version: '' },
};

const KERNEL_DISPLAY_NAME: Record<NotebookCellLanguage, string> = {
  javascript: 'JavaScript (Lingua)',
  typescript: 'TypeScript (Lingua)',
  python: 'Python (Lingua)',
  sql: 'SQL (Lingua)',
};

/**
 * Split cell text into nbformat `source` — an array where every line
 * keeps its trailing newline EXCEPT the last (the canonical Jupyter
 * shape; the importer tolerates string OR array). Empty text → `[]`.
 */
function toIpynbSource(text: string): string[] {
  if (text.length === 0) return [];
  const lines = text.split('\n');
  return lines.map((line, idx) => (idx < lines.length - 1 ? `${line}\n` : line));
}

/** Map a Lingua text output to an nbformat `stream` output. */
function toIpynbOutput(output: NotebookCellOutputV1): IpynbStreamOutput {
  return {
    output_type: 'stream',
    name: output.stream,
    text: toIpynbSource(output.text),
  };
}

/**
 * Serialize a Lingua notebook to an nbformat v4 `.ipynb` document.
 *
 * @param notebook the notebook to export.
 * @param opts.executionOrder per-cell Jupyter `[N]` stamps (implementation note); a
 *   cell absent from the map exports `execution_count: null`. The map is
 *   transient store state, so the caller (NotebookView) threads it in.
 */
export function exportNotebookAsIpynb(
  notebook: NotebookV1,
  opts: { executionOrder?: Readonly<Record<string, number>> } = {}
): NotebookIpynbExportResult {
  const executionOrder = opts.executionOrder ?? {};
  // Dominant language drives the single-kernel metadata; mixed / empty
  // notebooks fall back to JavaScript (per-cell language still rides in
  // `metadata.lingua` for a lossless Lingua round-trip).
  const kernelLanguage = pickNotebookExportLanguage(notebook) ?? 'javascript';
  const cells: IpynbCell[] = [];
  for (const cell of notebook.cells) {
    if (isNotebookMarkdownCell(cell)) {
      cells.push({
        cell_type: 'markdown',
        id: cell.id,
        metadata: {},
        source: toIpynbSource(cell.source),
      });
      continue;
    }
    if (isNotebookCodeCell(cell)) {
      const order = executionOrder[cell.id];
      cells.push({
        cell_type: 'code',
        id: cell.id,
        metadata: { lingua: { language: cell.language } },
        execution_count:
          typeof order === 'number' && Number.isFinite(order) ? order : null,
        source: toIpynbSource(cell.source),
        outputs: cell.outputs.map(toIpynbOutput),
      });
    }
  }
  const document: IpynbNotebookV4 = {
    cells,
    metadata: {
      kernelspec: {
        name: `lingua-${kernelLanguage}`,
        display_name: KERNEL_DISPLAY_NAME[kernelLanguage],
        language: kernelLanguage,
      },
      language_info: LANGUAGE_INFO[kernelLanguage],
      lingua: { notebookId: notebook.id, exportedFrom: 'lingua' },
    },
    nbformat: 4,
    nbformat_minor: 5,
  };
  return {
    json: `${JSON.stringify(document, null, 1)}\n`,
    suggestedFileName: `${toKebabCase(notebook.title || 'notebook')}.ipynb`,
  };
}

function toKebabCase(input: string): string {
  return (
    input
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 64) || 'notebook'
  );
}
