import type { LineResult } from '../stores/resultStore';
import type { EditorDiagnostic, ExecutionError } from '../types';
import { formatPayloadInlineSummary } from '../../shared/richOutput';

export interface InlineDecorationEntry {
  line: number;
  content: string;
}

export interface ExecutionMarkerEntry {
  startLineNumber: number;
  endLineNumber: number;
  startColumn: number;
  endColumn: number;
  message: string;
  severity?: 'error' | 'warning' | 'info';
}

function toInlineContent(result: LineResult): string {
  if (result.payload) {
    // RL-044 Slice 1A — reuse the shared formatter so the editor-
    // decoration path and the overlay-widget path can never diverge.
    const summary = formatPayloadInlineSummary(result.payload);
    if (summary !== null) {
      const prefix = result.type === 'magic' || result.type === 'result' ? '// => ' : '// ';
      return `${prefix}${summary.display}`;
    }
  }
  switch (result.type) {
    case 'magic':
    case 'result':
      return `// => ${result.value}`;
    default:
      return `// ${result.value}`;
  }
}

export function buildInlineDecorationEntries(
  lineResults: LineResult[]
): InlineDecorationEntry[] {
  const groupedLineResults = new Map<number, string[]>();

  for (const lineResult of lineResults) {
    const existing = groupedLineResults.get(lineResult.line) ?? [];
    existing.push(toInlineContent(lineResult));
    groupedLineResults.set(lineResult.line, existing);
  }

  return Array.from(groupedLineResults.entries()).map(([line, contents]) => ({
    line,
    content: `  ${contents.join('  ')}`,
  }));
}

export function buildExecutionMarkerEntry(
  error: ExecutionError | null,
  lineCount: number,
  getLineMaxColumn: (lineNumber: number) => number
): ExecutionMarkerEntry | null {
  if (!error || error.line === undefined) {
    return null;
  }

  const startLineNumber = Math.min(Math.max(error.line, 1), lineCount);
  const maxColumn = Math.max(getLineMaxColumn(startLineNumber), 1);
  const startColumn = Math.min(Math.max(error.column ?? 1, 1), maxColumn);
  const endColumn = error.column !== undefined ? Math.min(startColumn + 1, maxColumn) : maxColumn;

  return {
    startLineNumber,
    endLineNumber: startLineNumber,
    startColumn,
    endColumn,
    message: error.message,
    severity: 'error',
  };
}

export function buildDiagnosticMarkerEntries(
  diagnostics: EditorDiagnostic[],
  lineCount: number,
  getLineMaxColumn: (lineNumber: number) => number
): ExecutionMarkerEntry[] {
  return diagnostics.map((diagnostic) => {
    const startLineNumber = Math.min(Math.max(diagnostic.line, 1), lineCount);
    const maxColumn = Math.max(getLineMaxColumn(startLineNumber), 1);
    const startColumn = Math.min(Math.max(diagnostic.column ?? 1, 1), maxColumn);
    const endLineNumber = Math.min(
      Math.max(diagnostic.endLine ?? startLineNumber, startLineNumber),
      lineCount
    );
    const endColumn = diagnostic.endColumn
      ? Math.min(Math.max(diagnostic.endColumn, startColumn), getLineMaxColumn(endLineNumber))
      : Math.min(startColumn + 1, maxColumn);

    return {
      startLineNumber,
      endLineNumber,
      startColumn,
      endColumn,
      message: diagnostic.message,
      severity: diagnostic.severity,
    };
  });
}

export function getExecutionErrorKey(error: ExecutionError | null): string | null {
  if (!error || error.line === undefined) {
    return null;
  }

  return `${error.message}:${error.line}:${error.column ?? 1}`;
}

export function getDiagnosticKey(diagnostics: EditorDiagnostic[]): string | null {
  const primary = diagnostics[0];
  if (!primary) {
    return null;
  }

  return `${primary.message}:${primary.line}:${primary.column ?? 1}:${primary.severity}`;
}
