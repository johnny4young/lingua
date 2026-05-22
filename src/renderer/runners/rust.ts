import type {
  LanguageRunner,
  ExecutionContext,
  ExecutionResult,
  ConsoleOutput,
} from '../types';
import { parseRustExecutionError } from '../utils/executionDiagnostics';
import { resolveNativeRunnerMessages, resolveUserEnvForRunner } from './env';
import { enrichConsoleOutputLine } from './originSplitter';

export class RustRunner implements LanguageRunner {
  id = 'rust';
  name = 'Rust';
  language = 'rust' as const;
  extensions = ['.rs'];

  private ready = false;
  private rustInstalled = false;

  async init(): Promise<void> {
    const result = await window.lingua.rust.detect(resolveUserEnvForRunner());
    this.rustInstalled = result.installed;
    this.ready = true;

    if (!result.installed) {
      throw new Error(result.error ?? 'Rust is not installed.');
    }
  }

  isReady(): boolean {
    return this.ready;
  }

  async execute(code: string, context?: ExecutionContext): Promise<ExecutionResult> {
    if (!this.rustInstalled) {
      return {
        stdout: [],
        stderr: [],
        result: undefined,
        executionTime: 0,
        error: {
          message:
            'Rust is not installed on this system. Install it from https://rustup.rs and restart Lingua.',
        },
      };
    }

    // RL-011 Slice D — same resolver Go uses. processEnv stays empty
    // in the renderer; the RL-079 host allowlist merge happens in main
    // so host secrets never cross the preload boundary.
    const userEnv = resolveUserEnvForRunner();
    const runResult = await window.lingua.rust.run(
      code,
      userEnv,
      resolveNativeRunnerMessages()
    );

    const sourceMappingEnabled = context?.outputSourceMappingEnabled !== false;

    // RL-044 Sub-slice G — best-effort `file.rs:N` splitter enriches
    // `ConsoleOutput.line` so the renderer's `<OutputLineBadge>`
    // surfaces a chip on panic / debug rows that mention a source.
    const stdout: ConsoleOutput[] = runResult.stdout
      .split('\n')
      .filter((line, i, arr) => i < arr.length - 1 || line.trim() !== '')
      .map((line) => ({
        type: 'log' as const,
        args: [line],
        line: sourceMappingEnabled
          ? enrichConsoleOutputLine('rust', undefined, [line])
          : undefined,
      }));

    const stderr: ConsoleOutput[] = runResult.stderr
      .split('\n')
      .filter((line, i, arr) => i < arr.length - 1 || line.trim() !== '')
      .map((line) => ({
        type: 'error' as const,
        args: [line],
        line: sourceMappingEnabled
          ? enrichConsoleOutputLine('rust', undefined, [line])
          : undefined,
      }));

    return {
      stdout,
      stderr,
      result: undefined,
      executionTime: runResult.executionTime,
      error: runResult.error
        ? parseRustExecutionError(runResult.stderr, runResult.error)
        : undefined,
    };
  }

  /** Rust processes are managed entirely in the main process; stop is a no-op */
  stop(): void {}
}
