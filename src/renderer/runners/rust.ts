import type {
  LanguageRunner,
  ExecutionContext,
  ExecutionResult,
  ConsoleOutput,
} from '../types';

export class RustRunner implements LanguageRunner {
  id = 'rust';
  name = 'Rust';
  language = 'rust' as const;
  extensions = ['.rs'];

  private ready = false;
  private rustInstalled = false;

  async init(): Promise<void> {
    const result = await window.runlang.rust.detect();
    this.rustInstalled = result.installed;
    this.ready = true;

    if (!result.installed) {
      throw new Error(result.error ?? 'Rust is not installed.');
    }
  }

  isReady(): boolean {
    return this.ready;
  }

  async execute(code: string, _context?: ExecutionContext): Promise<ExecutionResult> {
    if (!this.rustInstalled) {
      return {
        stdout: [],
        stderr: [],
        result: undefined,
        executionTime: 0,
        error: {
          message:
            'Rust is not installed on this system. Install it from https://rustup.rs and restart RunLang.',
        },
      };
    }

    const runResult = await window.runlang.rust.run(code);

    const stdout: ConsoleOutput[] = runResult.stdout
      .split('\n')
      .filter((line, i, arr) => i < arr.length - 1 || line.trim() !== '')
      .map((line) => ({ type: 'log' as const, args: [line] }));

    const stderr: ConsoleOutput[] = runResult.stderr
      .split('\n')
      .filter((line, i, arr) => i < arr.length - 1 || line.trim() !== '')
      .map((line) => ({ type: 'error' as const, args: [line] }));

    return {
      stdout,
      stderr,
      result: undefined,
      executionTime: runResult.executionTime,
      error: runResult.error
        ? { message: runResult.error, ...parseRustError(runResult.stderr) }
        : undefined,
    };
  }

  /** Rust processes are managed entirely in the main process; stop is a no-op */
  stop(): void {}
}

/** Extract line/column from rustc error output */
function parseRustError(stderr: string): { line?: number; column?: number } {
  if (!stderr) return {};

  // rustc errors:   " --> main.rs:LINE:COL"
  const compileMatch = stderr.match(/-->\s+\S+:(\d+):(\d+)/);
  if (compileMatch) {
    return {
      line: parseInt(compileMatch[1], 10),
      column: parseInt(compileMatch[2], 10),
    };
  }

  // Runtime panics: "panicked at '...', src/main.rs:LINE:COL"
  const panicMatch = stderr.match(/,\s+\S+:(\d+):(\d+)/);
  if (panicMatch) {
    return {
      line: parseInt(panicMatch[1], 10),
      column: parseInt(panicMatch[2], 10),
    };
  }

  return {};
}
