import type {
  LanguageRunner,
  ExecutionContext,
  ExecutionResult,
  ConsoleOutput,
  ExecutionError,
} from '../types';
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

// RL-020 Slice 7 — the literal DEFAULT_TIMEOUT is gone; the runner
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

  private worker: Worker | null = null;
  private ready = false;
  private goInstalled = false;
  private currentRunId: string | null = null;
  private cancelInFlight: (() => void) | null = null;

  async init(): Promise<void> {
    // Check if Go is installed via IPC
    const result = await window.lingua.go.detect(resolveUserEnvForRunner());
    this.goInstalled = result.installed;
    this.ready = true;

    if (!result.installed) {
      throw new Error(result.error ?? 'Go is not installed.');
    }
  }

  isReady(): boolean {
    return this.ready;
  }

  async execute(code: string, context?: ExecutionContext): Promise<ExecutionResult> {
    // RL-020 Slice 7 — resolve deadline from the per-language preset.
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
      return {
        stdout: [],
        stderr: [],
        result: undefined,
        executionTime: 0,
        error: {
          message:
            'Go is not installed on this system. Install Go from https://go.dev/dl/ and restart Lingua.',
        },
        // RL-020 Slice 7 — host-not-installed counts as `'error'`.
        kind: 'error',
      };
    }

    // Step 1: Compile Go to WASM via IPC (main process).
    // RL-011 Slice D — resolve the user-space env (global + project +
    // tab) and hand it to main so `go build` sees it. processEnv stays
    // `{}` on the renderer side: the RL-079 host allowlist merge happens
    // in main so host secrets never cross the preload boundary.
    const userEnv = resolveUserEnvForRunner();
    const compileResult = await window.lingua.go.compile(
      code,
      userEnv,
      resolveNativeRunnerMessages()
    );

    if (!compileResult.success || !compileResult.wasmBytes || !compileResult.wasmExecJs) {
      return {
        stdout: [],
        stderr: [],
        result: undefined,
        executionTime: 0,
        error:
          parseGoExecutionError(compileResult.error) ?? {
            message: 'Go compilation failed.',
          },
        // RL-020 Slice 7 — compile failures count as `'error'`.
        kind: 'error',
      };
    }

    // Step 2: Execute the WASM in a Web Worker
    const stdout: ConsoleOutput[] = [];
    const stderr: ConsoleOutput[] = [];
    let error: ExecutionError | undefined;
    let droppedStdout = 0;
    let droppedStderr = 0;
    let stderrByteTruncated = false;

    this.stop();
    const runId = crypto.randomUUID();
    this.currentRunId = runId;

    return new Promise<ExecutionResult>((resolve) => {
      this.worker = new Worker(
        new URL('../workers/go-worker.ts', import.meta.url),
        { type: 'classic' }
      );
      const worker = this.worker;
      let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
      let resolved = false;

      const finish = (value: ExecutionResult) => {
        if (resolved) return;
        resolved = true;
        if (timeoutHandle !== null) {
          clearTimeout(timeoutHandle);
          timeoutHandle = null;
        }
        if (this.currentRunId === runId) {
          this.currentRunId = null;
        }
        if (this.cancelInFlight === cancelInFlight) {
          this.cancelInFlight = null;
        }
        resolve(value);
      };

      const cancelInFlight = () => {
        finish(runnerStoppedResult(t, { stdout, stderr }));
      };
      this.cancelInFlight = cancelInFlight;

      this.worker.addEventListener('message', (event: MessageEvent<GoWorkerResponse>) => {
        const msg = event.data;
        if (msg.runId !== runId) return;
        if (this.currentRunId !== runId) return;

        switch (msg.type) {
          case 'console': {
            // RL-044 Sub-slice G — enrich the line field from a Go
            // panic-style `file.go:N` reference in the args text when
            // the worker didn't already provide a line.
            const enrichedLine = context?.outputSourceMappingEnabled === false
              ? undefined
              : enrichConsoleOutputLine('go', msg.line, msg.args);
            const output: ConsoleOutput = { type: msg.method, args: msg.args, line: enrichedLine };
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
            worker.terminate();
            if (this.worker === worker) this.worker = null;
            break;
        }
      });

      this.worker.addEventListener('error', (event) => {
        finish({
          stdout,
          stderr,
          result: undefined,
          executionTime: 0,
          error: { message: event.message || 'Go worker error' },
          kind: 'error',
          timeoutPreset,
          timeoutMs: timeout,
        });
        worker.terminate();
        if (this.worker === worker) this.worker = null;
      });

      timeoutHandle = setTimeout(() => {
        worker.terminate();
        if (this.worker === worker) this.worker = null;
        finish(runnerTimeoutResult(timeout, t, { stdout, stderr }, timeoutPreset));
      }, timeout);

      this.worker.postMessage({
        type: 'execute',
        runId,
        wasmBytes: compileResult.wasmBytes,
        wasmExecJs: compileResult.wasmExecJs,
        timeout,
      });
    });
  }

  stop(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    this.currentRunId = null;
    if (this.cancelInFlight) {
      const cancel = this.cancelInFlight;
      this.cancelInFlight = null;
      cancel();
    }
  }
}
