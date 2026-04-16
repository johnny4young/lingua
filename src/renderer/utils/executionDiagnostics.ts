import type { EditorDiagnostic, ExecutionError, Language } from '../types';

function firstNonEmptyLine(input?: string | null): string | null {
  if (!input) {
    return null;
  }

  const line = input
    .split('\n')
    .map((entry) => entry.trim())
    .find((entry) => entry.length > 0);

  return line ?? null;
}

function normalizeErrorMessage(input?: string | null, fallback = 'Execution failed.'): string {
  return firstNonEmptyLine(input) ?? fallback;
}

function parseInteger(value?: string): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function parseGoExecutionError(errorMsg?: string): ExecutionError | undefined {
  if (!errorMsg) {
    return undefined;
  }

  const match = errorMsg.match(/(?:^|\n)(?:\.\/)?main\.go:(\d+):(\d+):\s*(.+)/);
  if (!match) {
    return { message: normalizeErrorMessage(errorMsg, 'Go compilation failed.') };
  }

  return {
    message: normalizeErrorMessage(match[3], 'Go compilation failed.'),
    line: parseInteger(match[1]),
    column: parseInteger(match[2]),
  };
}

function parseRustUnderline(
  stderr: string,
  line: number,
  column: number
): Pick<ExecutionError, 'endColumn'> {
  const lines = stderr.split('\n');
  const sourceLinePattern = new RegExp(`^\\s*${line}\\s*\\|`);
  const sourceLineIndex = lines.findIndex((entry) => sourceLinePattern.test(entry));
  if (sourceLineIndex === -1) {
    return {};
  }

  const underlineLine = lines[sourceLineIndex + 1];
  if (!underlineLine) {
    return {};
  }

  const underlineMatch = underlineLine.match(/^\s*\|\s*(\s*)(\^+)/);
  if (!underlineMatch) {
    return {};
  }

  const underline = underlineMatch[2] ?? '';
  return underline.length > 1 ? { endColumn: column + underline.length - 1 } : {};
}

export function parseRustExecutionError(
  stderr: string,
  fallbackMessage?: string
): ExecutionError | undefined {
  const compileMatch = stderr.match(/(?:^|\n)\s*-->\s+(?:\.\/)?main\.rs:(\d+):(\d+)/);
  if (compileMatch) {
    const line = parseInteger(compileMatch[1]);
    const column = parseInteger(compileMatch[2]);
    const primaryLine = stderr
      .split('\n')
      .map((entry) => entry.trim())
      .find((entry) => entry.startsWith('error'));

    return {
      message: normalizeErrorMessage(
        primaryLine ?? fallbackMessage ?? stderr,
        'Rust compilation failed.'
      ),
      line,
      column,
      ...(line && column ? parseRustUnderline(stderr, line, column) : {}),
    };
  }

  const panicMatch = stderr.match(
    /panicked at .*?,\s+(?:\.\/)?(?:src\/)?main\.rs:(\d+):(\d+)/
  );
  if (panicMatch) {
    return {
      message: normalizeErrorMessage(fallbackMessage ?? stderr, 'Rust runtime panic.'),
      line: parseInteger(panicMatch[1]),
      column: parseInteger(panicMatch[2]),
    };
  }

  if (!stderr && !fallbackMessage) {
    return undefined;
  }

  return {
    message: normalizeErrorMessage(fallbackMessage ?? stderr, 'Rust execution failed.'),
  };
}

export function toExecutionDiagnostics(
  language: Language,
  error: ExecutionError | null
): EditorDiagnostic[] {
  if (!error?.line) {
    return [];
  }

  return [
    {
      message: error.message,
      line: error.line,
      column: error.column,
      endLine: error.endLine,
      endColumn: error.endColumn,
      severity: 'error',
      source: language,
    },
  ];
}
