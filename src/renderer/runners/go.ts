import type {
  LanguageRunner,
  ExecutionContext,
  ExecutionResult,
  ConsoleOutput,
  ExecutionError,
} from '../types/execution';
import i18next from 'i18next';
import { parseGoExecutionError } from '../utils/executionDiagnostics';
import { enrichConsoleOutputLine } from './originSplitter';
import { useSettingsStore } from '../stores/settingsStore';
import {
  resolveTimeoutMs,
  type RuntimeTimeoutPreset,
} from '../../shared/runtimeTimeoutPresets';
import {
  appendCappedConsole,
  capStderrIfOverflowing,
  runnerStoppedResult,
  runnerTimeoutResult,
  type TranslateFn,
} from './limits';
import {
  resolveNativeRunnerMessages,
  resolveUserEnvForRunner,
} from './env';
import { pushMissingNativeToolchainNotice } from './nativeToolchainGuidance';

// implementation — the literal DEFAULT_TIMEOUT is gone; the runner
// resolves the deadline from the per-language Settings preset on
// every call to `execute()`.
const t: TranslateFn = (key, options) =>
  i18next.t(key, options ?? {}) as string;

type GoWorkerResponse =
  | {
      type: 'console';
      runId: string;
      method: ConsoleOutput['type'];
      args: string[];
      line?: number;
    }
  | { type: 'error'; runId: string; error: ExecutionError }
  | { type: 'done'; runId: string; executionTime: number };

export class GoRunner implements LanguageRunner {
  id = 'go';
  name = 'Go';
  language = 'go' as const;
  extensions = ['.go'];

  private ready = false;
  private goInstalled = false;
  private detectFailure = false;
  private cancelInFlight: (() => void) | null = null;

  async init(): Promise<void> {
    // Check if Go is installed via IPC
    const result = await window.lingua.go.detect(resolveUserEnvForRunner());
    this.goInstalled = result.installed;
    this.detectFailure = result.reason === 'check-failed';
    // A failed check is not an answer: the next run detects again.
    this.ready = !this.detectFailure;

    if (!result.installed) {
      if (!this.detectFailure) this.pushMissingToolchainNotice();
      throw new Error(t(
        this.detectFailure ? 'nativeToolchain.error.checkFailed' : 'nativeToolchain.error.missing',
        { toolchain: 'Go' }
      ));
    }
  }

  private pushMissingToolchainNotice(): void {
    pushMissingNativeToolchainNotice('go', async () => {
      const result = await window.lingua.go.detect(resolveUserEnvForRunner());
      this.goInstalled = result.installed;
      this.detectFailure = result.reason === 'check-failed';
      return result.reason === 'check-failed' ? 'check-failed' : result.installed;
    });
  }

  isReady(): boolean {
    return this.ready;
  }

  async execute(code: string, context?: ExecutionContext): Promise<ExecutionResult> {
    this.stop();
    // implementation — resolve deadline from the per-language preset.
    const settingsSnapshot = useSettingsStore.getState();
    const callerOverrode = typeof context?.timeout === 'number';
    const presetForLanguage: RuntimeTimeoutPreset | undefined =
      settingsSnapshot.runtimeTimeoutPresetByLanguage?.['go'];
    const timeout = callerOverrode
      ? (context!.timeout as number)
      : resolveTimeoutMs('go', presetForLanguage);
    const timeoutPreset: RuntimeTimeoutPreset | 'override' = callerOverrode
      ? 'override'
      : presetForLanguage ?? 'normal';

    if (!this.goInstalled) {
      if (!this.detectFailure) this.pushMissingToolchainNotice();
      return {
        stdout: [],
        stderr: [],
        result: undefined,
        executionTime: 0,
        error: {
          message: t(
            this.detectFailure ? 'nativeToolchain.error.checkFailed' : 'nativeToolchain.error.missing',
            { toolchain: 'Go' }
          ),
        },
        // implementation — host-not-installed counts as `'error'`.
        kind: 'error',
      };
    }

    const runId = crypto.randomUUID();
    const stdout: ConsoleOutput[] = [];
    const stderr: ConsoleOutput[] = [];
    let nextCaptureOrder = 0;
    let error: ExecutionError | undefined;
    let droppedStdout = 0;
    let droppedStderr = 0;
    let stderrByteTruncated = false;

    return new Promise<ExecutionResult>(resolve => {
      let worker: Worker | null = null;
      let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
      let resolved = false;
      const finish = (value: ExecutionResult) => {
        if (resolved) return;
        resolved = true;
        if (timeoutHandle !== null) clearTimeout(timeoutHandle);
        worker?.terminate();
        if (this.cancelInFlight === cancel) this.cancelInFlight = null;
        resolve(value);
      };
      const cancel = () => {
        void window.lingua.go.stop(runId).catch(() => {});
        finish(runnerStoppedResult(t, { stdout, stderr }));
      };
      // Claim before compile IPC. Only this closure can finalize its resources.
      this.cancelInFlight = cancel;
      void window.lingua.go.compile(code, resolveUserEnvForRunner(), resolveNativeRunnerMessages(), runId)
        .then(compiled => {
          if (resolved) return;
          if (compiled.kind === 'stopped') {
            finish(runnerStoppedResult(t, { stdout, stderr }));
            return;
          }
          if (compiled.kind === 'timeout') {
            finish(runnerTimeoutResult(compiled.timeoutMs ?? 30_000, t, { stdout, stderr }, 'override'));
            return;
          }
          if (!compiled.success || !compiled.wasmBytes || !compiled.wasmExecJs) {
            finish({ stdout, stderr, result: undefined, executionTime: 0, kind: 'error',
              error: parseGoExecutionError(compiled.error) ?? { message: 'Go compilation failed.' } });
            return;
          }
          worker = new Worker(new URL('../workers/go-worker.ts', import.meta.url), { type: 'classic' });
          worker.addEventListener('message', (event: MessageEvent<GoWorkerResponse>) => {
            const msg = event.data;
            if (resolved || msg.runId !== runId) return;
            switch (msg.type) {
              case 'console': {
                // implementation — enrich the line field from a Go
                // panic-style `file.go:N` reference in the args text when
                // the worker didn't already provide a line.
                const enrichedLine = enrichConsoleOutputLine('go', msg.line, msg.args);
                const output: ConsoleOutput = { type: msg.method, args: msg.args, line: enrichedLine };
                output.captureOrder = nextCaptureOrder++;
                if (msg.method === 'error') {
                  if (!stderrByteTruncated) {
                    droppedStderr = appendCappedConsole(
                      stderr,
                      output,
                      droppedStderr,
                      t
                    );
                    stderrByteTruncated = capStderrIfOverflowing(stderr, t);
                  }
                } else {
                  droppedStdout = appendCappedConsole(
                    stdout,
                    output,
                    droppedStdout,
                    t
                  );
                }
                break;
              }
              case 'error':
                error = msg.error;
                break;
              case 'done':
                finish({
                  stdout,
                  stderr,
                  result: undefined,
                  executionTime: msg.executionTime,
                  error,
                  kind: error ? 'error' : 'success',
                  timeoutPreset,
                  timeoutMs: timeout,
                });
                break;
            }
          });

          worker.addEventListener('error', event => {
            finish({ stdout, stderr, result: undefined, executionTime: 0,
              error: { message: event.message || 'Go worker error' }, kind: 'error',
              timeoutPreset, timeoutMs: timeout });
          });
          timeoutHandle = setTimeout(() => {
            finish(runnerTimeoutResult(timeout, t, { stdout, stderr }, timeoutPreset));
          }, timeout);
          // The worker owns the typed buffer after this zero-copy transfer.
          worker.postMessage({ type: 'execute', runId, wasmBytes: compiled.wasmBytes,
            wasmExecJs: compiled.wasmExecJs, timeout }, [compiled.wasmBytes.buffer]);
        })
        .catch(error => finish({ stdout, stderr, result: undefined, executionTime: 0,
          kind: 'error', error: { message: error instanceof Error ? error.message : String(error) } }));
    });
  }

  stop(): void { this.cancelInFlight?.(); }
}
