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

  const entry: ConsoleEntryInput = {
    type: 'error',
    content: `${result.error.message}${location}`,
  };

  // RL-044 Slice 2b-α — Sub-slice F end-to-end completion. When the
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

export function toConsoleEntries(
  result: ExecutionResult,
  language?: Language
): ConsoleEntryInput[] {
  const entries: ConsoleEntryInput[] = [];

  for (const output of result.stdout) {
    // RL-044 Slice 1B — forward the optional rich payload alongside
    // the legacy text content so the console renderer can dispatch.
    entries.push(
      output.payload
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
          }
    );
  }

  for (const output of result.stderr) {
    entries.push(
      output.payload
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
          }
    );
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
