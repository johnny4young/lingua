import i18next from 'i18next';
import { runnerStoppedResult, runnerTimeoutResult, type TranslateFn } from './limits';
import type {
  LanguageRunner,
  ExecutionContext,
  ExecutionResult,
  ConsoleOutput,
} from '../types/execution';
import { parseRustExecutionError } from '../utils/executionDiagnostics';
import { resolveNativeRunnerMessages, resolveUserEnvForRunner } from './env';
import { enrichConsoleOutputLine } from './originSplitter';
import { useNativeToolchainStore } from '../stores/nativeToolchainStore';

const t: TranslateFn = (key, options) => i18next.t(key, options ?? {}) as string;

export class RustRunner implements LanguageRunner {
  id = 'rust';
  name = 'Rust';
  language = 'rust' as const;
  extensions = ['.rs'];

  private ready = false;
  private cancelInFlight: (() => void) | null = null;
  private rustInstalled = false;
  private detectFailure = false;

  async init(): Promise<void> {
    const result = await window.lingua.rust.detect(resolveUserEnvForRunner());
    this.applyDetection(result);
    if (!result.installed) {
      throw new Error(t(
        this.detectFailure ? 'nativeToolchain.error.checkFailed' : 'nativeToolchain.error.missing',
        { toolchain: 'Rust' }
      ));
    }
  }

  /** The Dock empty state and Run read the same answer the runner acts on. */
  private applyDetection(result: { installed: boolean; reason?: 'missing' | 'check-failed'; searched?: string[] }): void {
    this.rustInstalled = result.installed;
    this.detectFailure = result.reason === 'check-failed';
    // A failed check is not an answer: the next run detects again.
    this.ready = !this.detectFailure;
    useNativeToolchainStore.getState().report('rust', result);
  }

  isReady(): boolean {
    return this.ready;
  }

  async execute(code: string, _context?: ExecutionContext): Promise<ExecutionResult> {
    this.stop();
    // Choose binary or a fresh install may have fixed it since the last check.
    if (!this.rustInstalled) this.applyDetection(await window.lingua.rust.detect(resolveUserEnvForRunner()));
    if (!this.rustInstalled) {
      return {
        stdout: [],
        stderr: [],
        result: undefined,
        executionTime: 0,
        error: {
          message: t(
            this.detectFailure ? 'nativeToolchain.error.checkFailed' : 'nativeToolchain.error.missing',
            { toolchain: 'Rust' }
          ),
        },
      };
    }

    return new Promise<ExecutionResult>(resolve => {
      const runId = crypto.randomUUID();
      let resolved = false;
      const finish = (result: ExecutionResult) => {
        if (resolved) return;
        resolved = true;
        if (this.cancelInFlight === cancel) this.cancelInFlight = null;
        resolve(result);
      };
      const cancel = () => {
        void window.lingua.rust.stop(runId).catch(() => {});
        finish(runnerStoppedResult(t, { stdout: [], stderr: [] }));
      };
      this.cancelInFlight = cancel;
      void window.lingua.rust.run(code, resolveUserEnvForRunner(), resolveNativeRunnerMessages(), runId)
        .then(runResult => {
          if (resolved) return;
          if (runResult.kind === 'stopped') {
            finish(runnerStoppedResult(t, { stdout: [], stderr: [] }));
            return;
          }
          // best-effort `file.rs:N` splitter enriches
          // `ConsoleOutput.line` so the renderer's `<OutputLineBadge>`
          // surfaces a chip on panic / debug rows that mention a source.
          const stdout: ConsoleOutput[] = runResult.stdout
            .split('\n')
            .filter((line, i, arr) => i < arr.length - 1 || line.trim() !== '')
            .map((line) => ({
              type: 'log' as const,
              args: [line],
              line: enrichConsoleOutputLine('rust', undefined, [line]),
            }));

          const stderr: ConsoleOutput[] = runResult.stderr
            .split('\n')
            .filter((line, i, arr) => i < arr.length - 1 || line.trim() !== '')
            .map((line) => ({
              type: 'error' as const,
              args: [line],
              line: enrichConsoleOutputLine('rust', undefined, [line]),
            }));

          if (runResult.kind === 'timeout') {
            finish(runnerTimeoutResult(runResult.timeoutMs ?? 30_000, t, { stdout, stderr }, 'override'));
            return;
          }
          finish({
            kind: runResult.success ? 'success' : 'error',
            stdout,
            stderr,
            result: undefined,
            executionTime: runResult.executionTime,
            error: runResult.error
              ? parseRustExecutionError(runResult.stderr, runResult.error)
              : undefined,
          });
        })
        .catch(error => finish({ stdout: [], stderr: [], result: undefined, executionTime: 0,
          kind: 'error', error: { message: error instanceof Error ? error.message : String(error) } }));
    });
  }

  stop(): void { this.cancelInFlight?.(); }
}
