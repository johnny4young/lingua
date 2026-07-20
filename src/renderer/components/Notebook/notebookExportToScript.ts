/**
 * implementation Slice A implementation note — Minimal language-aware script export helper.
 *
 * Joins code cells with comment separators and markdown cells as line
 * comments. The file extension follows the single code-cell language
 * (JS / TS / Python) and falls back to `.txt` for mixed-language
 * notebooks, which are not executable as a single script.
 *
 * implementation scope: pure helper. The component layer wraps the result
 * in a `Blob` + uses `URL.createObjectURL` to surface a download
 * link. No clipboard / no IPC / no rich-format conversion.
 */

import {
  isNotebookCodeCell,
  isNotebookMarkdownCell,
  type NotebookCellLanguage,
  type NotebookV1,
} from '../../../shared/notebook';

export interface NotebookExportResult {
  readonly source: string;
  /** Suggested file name (kebab-cased title + language-aware suffix). */
  readonly suggestedFileName: string;
  /** Null when the notebook mixes code-cell languages. */
  readonly language: NotebookCellLanguage | null;
}

const SCRIPT_EXTENSION: Record<NotebookCellLanguage, string> = {
  javascript: 'js',
  typescript: 'ts',
  python: 'py',
  sql: 'sql',
};

const SCRIPT_COMMENT_PREFIX: Record<NotebookCellLanguage, string> = {
  javascript: '//',
  typescript: '//',
  python: '#',
  sql: '--',
};

export function pickNotebookExportLanguage(
  notebook: NotebookV1
): NotebookCellLanguage | null {
  let selected: NotebookCellLanguage | null = null;
  for (const cell of notebook.cells) {
    if (!isNotebookCodeCell(cell)) continue;
    if (selected === null) {
      selected = cell.language;
      continue;
    }
    if (cell.language !== selected) return null;
  }
  return selected;
}

export function exportNotebookAsScript(
  notebook: NotebookV1
): NotebookExportResult {
  const language = pickNotebookExportLanguage(notebook);
  const commentPrefix = language ? SCRIPT_COMMENT_PREFIX[language] : '//';
  const extension = language ? SCRIPT_EXTENSION[language] : 'txt';
  const lines: string[] = [];
  lines.push(`${commentPrefix} Exported from Lingua notebook ${notebook.id}`);
  if (notebook.createdAt !== undefined) {
    lines.push(`${commentPrefix} Created: ${notebook.createdAt}`);
  }
  lines.push('');
  for (const cell of notebook.cells) {
    if (isNotebookMarkdownCell(cell)) {
      lines.push(`${commentPrefix} --- markdown ${cell.id} ---`);
      for (const line of cell.source.split(/\r?\n/u)) {
        lines.push(`${commentPrefix} ${line}`);
      }
      lines.push('');
      continue;
    }
    if (isNotebookCodeCell(cell)) {
      lines.push(`${commentPrefix} --- cell ${cell.id} (${cell.language}) ---`);
      lines.push(cell.source);
      lines.push('');
    }
  }
  const source = lines.join('\n');
  return {
    source,
    suggestedFileName: `${toKebabCase(notebook.title || 'notebook')}.${extension}`,
    language,
  };
}

export function exportNotebookAsJs(notebook: NotebookV1): NotebookExportResult {
  return exportNotebookAsScript(notebook);
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
