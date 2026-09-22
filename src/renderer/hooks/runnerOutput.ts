import i18next from 'i18next';
import { capturedExecutionErrors, executionKind } from '../utils/executionOutcome';
import type { ConsoleEntry } from '../types/console';
import type { Language } from '../types/language';
import type { ConsoleOutput, ExecutionResult } from '../types/execution';

type ConsoleEntryInput = Omit<ConsoleEntry, 'id' | 'timestamp'>;

const INITIALIZATION_MESSAGES: Partial<Record<Language, string>> = {
  go: 'Detecting Go installation...',
  python: 'Loading Python runtime (Pyodide)...',
  rust: 'Detecting Rust installation...',
};

export function formatExecTime(ms: number): string {
  if (ms < 1000) return `${ms.toFixed(1)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

export function formatExecutionSummary(result: ExecutionResult): string {
  return i18next.t(`runner.summary.${executionKind(result)}`, {
    duration: formatExecTime(result.executionTime),
  });
}

export function getInitializationMessage(language: Language): string {
  return INITIALIZATION_MESSAGES[language] ?? `Initializing ${language} runner...`;
}

export function getCompilationMessage(language: Language): ConsoleEntryInput | null {
  switch (language) {
    case 'go':
      return { type: 'info', content: 'Compiling Go to WebAssembly...' };
    case 'rust':
      return { type: 'info', content: 'Compiling Rust binary...' };
    default:
      return null;
  }
}

export function getCompilationLoadingMessage(language: Language): string | null {
  switch (language) {
    case 'go':
      return 'Compiling Go to WASM...';
    case 'rust':
      return 'Compiling Rust...';
    default:
      return null;
  }
}

export function formatExecutionError(result: ExecutionResult): ConsoleEntryInput | null {
  if (!result.error) {
    return null;
  }

  const location =
    result.error.line !== undefined
      ? ` (line ${result.error.line}${result.error.column !== undefined ? `:${result.error.column}` : ''})`
      : '';

  const entry: ConsoleEntryInput = {
    type: 'error',
    content: `${result.error.message}${location}`,
  };

  // implementation — implementation end-to-end completion. When the
  // worker reports structured frames, attach a `kind: 'error'`
  // payload so the renderer paints the clickable-stack surface.
  // Absent frames falls through to the legacy text path (no chip).
  if (result.error.frames && result.error.frames.length > 0) {
    entry.payload = [
      {
        kind: 'error',
        message: result.error.message,
        stack: result.error.frames,
      },
    ];
  }

  return entry;
}

/**
 * One runner console output as a console entry. implementation — forward the
 * optional rich payload alongside the legacy text content so the console
 * renderer can dispatch on every path: streamed, cancelled and completed runs.
 */
export function toConsoleEntry(output: ConsoleOutput, language?: Language): ConsoleEntryInput {
  return output.payload
    ? {
        type: output.type,
        content: output.args.join(' '),
        line: output.line,
        ...(language ? { language } : {}),
        payload: output.payload,
      }
    : {
        type: output.type,
        content: output.args.join(' '),
        line: output.line,
        ...(language ? { language } : {}),
      };
}

export function toConsoleEntries(
  result: ExecutionResult,
  language?: Language
): ConsoleEntryInput[] {
  const entries: ConsoleEntryInput[] = [];

  for (const output of result.stdout) {
    entries.push(toConsoleEntry(output, language));
  }

  for (const output of result.stderr) {
    entries.push(toConsoleEntry(output, language));
  }

  if (result.result !== undefined) {
    entries.push({
      type: 'result',
      content: String(result.result),
    });
  }

  for (const error of capturedExecutionErrors(result)) {
    entries.push({
      type: 'error',
      content: error.message,
      line: error.line,
      ...(language ? { language } : {}),
      ...(error.frames?.length ? {
        payload: [{ kind: 'error' as const, message: error.message, stack: error.frames }],
      } : {}),
    });
  }

  const executionError = formatExecutionError(result);
  if (executionError) {
    entries.push(executionError);
  }

  entries.push({
    type: 'info',
    content: formatExecutionSummary(result),
    executionTime: result.executionTime,
  });

  return entries;
}
