import type { LineResult } from '../stores/resultStore';
import type { ExecutionError } from '../types';

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
}

function toInlineContent(result: LineResult): string {
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
  };
}

export function getExecutionErrorKey(error: ExecutionError | null): string | null {
  if (!error || error.line === undefined) {
    return null;
  }

  return `${error.message}:${error.line}:${error.column ?? 1}`;
}
