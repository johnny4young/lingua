import type {
  LanguageRunner,
  ExecutionContext,
  ExecutionResult,
  ConsoleOutput,
} from '../types';
import { parseRustExecutionError } from '../utils/executionDiagnostics';
import { resolveNativeRunnerMessages, resolveUserEnvForRunner } from './go';

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

  async execute(code: string, _context?: ExecutionContext): Promise<ExecutionResult> {
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
        ? parseRustExecutionError(runResult.stderr, runResult.error)
        : undefined,
    };
  }

  /** Rust processes are managed entirely in the main process; stop is a no-op */
  stop(): void {}
}
