/**
 * RL-043 Slice A fold F — Minimal "Export as JS" helper.
 *
 * Joins code cells with "// --- cell <id> ---" separators + markdown
 * cells as block comments (closing marker escaped as "* /"). The
 * format is forward-compatible with Slice D's full export (which can detect
 * the separators and round-trip back to a notebook).
 *
 * Slice A scope: pure helper. The component layer wraps the result
 * in a `Blob` + uses `URL.createObjectURL` to surface a download
 * link. No clipboard / no IPC / no rich-format conversion.
 */

import {
  isNotebookCodeCell,
  isNotebookMarkdownCell,
  type NotebookV1,
} from '../../../shared/notebook';

export interface NotebookExportResult {
  readonly source: string;
  /** Suggested file name (kebab-cased title + `.js` suffix). */
  readonly suggestedFileName: string;
}

export function exportNotebookAsJs(notebook: NotebookV1): NotebookExportResult {
  const lines: string[] = [];
  lines.push(`// Exported from Lingua notebook ${notebook.id}`);
  if (notebook.createdAt !== undefined) {
    lines.push(`// Created: ${notebook.createdAt}`);
  }
  lines.push('');
  for (const cell of notebook.cells) {
    if (isNotebookMarkdownCell(cell)) {
      lines.push(`/* --- markdown ${cell.id} --- ${escapeForBlockComment(cell.source)} */`);
      lines.push('');
      continue;
    }
    if (isNotebookCodeCell(cell)) {
      lines.push(`// --- cell ${cell.id} (${cell.language}) ---`);
      lines.push(cell.source);
      lines.push('');
    }
  }
  const source = lines.join('\n');
  return {
    source,
    suggestedFileName: `${toKebabCase(notebook.title || 'notebook')}.js`,
  };
}

function escapeForBlockComment(text: string): string {
  // Prevent the markdown cell's content from containing `*/` which
  // would close the block comment prematurely. Replace with the
  // visually-equivalent `* /` (no-op semantically — block comments
  // ignore content).
  return text.replace(/\*\//g, '* /');
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
