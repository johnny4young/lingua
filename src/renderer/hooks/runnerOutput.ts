import type { ConsoleEntry, ExecutionResult, Language } from '../types';

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

  return {
    type: 'error',
    content: `${result.error.message}${location}`,
  };
}

export function toConsoleEntries(result: ExecutionResult): ConsoleEntryInput[] {
  const entries: ConsoleEntryInput[] = [];

  for (const output of result.stdout) {
    entries.push({
      type: output.type,
      content: output.args.join(' '),
      line: output.line,
    });
  }

  for (const output of result.stderr) {
    entries.push({
      type: output.type,
      content: output.args.join(' '),
      line: output.line,
    });
  }

  if (result.result !== undefined) {
    entries.push({
      type: 'result',
      content: String(result.result),
    });
  }

  const executionError = formatExecutionError(result);
  if (executionError) {
    entries.push(executionError);
  }

  entries.push({
    type: 'info',
    content: `Completed in ${formatExecTime(result.executionTime)}`,
    executionTime: result.executionTime,
  });

  return entries;
}
