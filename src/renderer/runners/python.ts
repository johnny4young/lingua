import i18next from 'i18next';
import type {
  LanguageRunner,
  ExecutionContext,
  ExecutionResult,
  ConsoleOutput,
  ExecutionError,
  MagicCommentResult,
  WorkerResponse,
} from '../types';
import {
  transformPythonMagicComments,
  detectPythonMagicComments,
  type MagicCommentKind,
} from '../utils/magicComments';
import { injectPythonLoopProtection } from '../utils/loopProtection';
import { useSettingsStore } from '../stores/settingsStore';
import { resolveUserEnvForRunner } from './go';
import {
  appendCappedConsole,
  capStderrIfOverflowing,
  runnerStoppedResult,
  runnerTimeoutResult,
  type TranslateFn,
} from './limits';

const DEFAULT_TIMEOUT = 60_000; // Python needs more time for initial load
const PYODIDE_LOAD_TIMEOUT = 90_000;
const PYODIDE_LOAD_CANCELLED = '__LINGUA_PYODIDE_LOAD_CANCELLED__';

const t: TranslateFn = (key, options) =>
  i18next.t(key, options ?? {}) as string;

function workerLoadErrorMessage(event: Event): string {
  const maybeMessage = (event as { message?: unknown }).message;
  return typeof maybeMessage === 'string' && maybeMessage.length > 0
    ? maybeMessage
    : 'Python worker failed to load';
}

export class PythonRunner implements LanguageRunner {
  id = 'python';
  name = 'Python (Pyodide)';
  language = 'python' as const;
  extensions = ['.py'];

  private worker: Worker | null = null;
  private ready = false;
  private pyodideLoaded = false;
  private loadingPromise: Promise<void> | null = null;
  private loadingCancel: (() => void) | null = null;
  /**
   * RL-078 — opaque token of the currently-running execute() call.
   * Parent message handler drops worker replies whose `runId` does
   * not match. The Pyodide worker is persistent across runs, so the
   * runId guard is the only way to disambiguate buffered output
   * from a previous run that was killed by the parent timer.
   */
  private currentRunId: string | null = null;
  /** RL-078 — see JavaScriptRunner.cancelInFlight. */
  private cancelInFlight: (() => void) | null = null;

  async init(): Promise<void> {
    this.ready = true;
    // Pyodide is loaded lazily on first execution
  }

  isReady(): boolean {
    return this.ready;
  }

  /** Ensure Pyodide is loaded in the worker */
  private async ensurePyodide(): Promise<Worker> {
    if (this.worker && this.pyodideLoaded) {
      return this.worker;
    }

    // Create a persistent worker for Python (Pyodide takes time to load)
    if (!this.worker) {
      this.worker = new Worker(
        new URL('../workers/python-worker.ts', import.meta.url),
        { type: 'module' }
      );
    }
    const worker = this.worker;

    let loadingPromise = this.loadingPromise;
    if (!loadingPromise) {
      loadingPromise = new Promise<void>((resolve, reject) => {
        let timeoutId: ReturnType<typeof globalThis.setTimeout> | null =
          globalThis.setTimeout(() => {
            cleanup();
            worker.terminate();
            if (this.worker === worker) {
              this.worker = null;
            }
            this.pyodideLoaded = false;
            this.loadingPromise = null;
            reject(new Error(`Timed out loading Pyodide after ${PYODIDE_LOAD_TIMEOUT / 1000}s`));
          }, PYODIDE_LOAD_TIMEOUT);

        const cleanup = () => {
          worker.removeEventListener('message', handler);
          worker.removeEventListener('error', errorHandler);
          if (timeoutId !== null) {
            globalThis.clearTimeout(timeoutId);
            timeoutId = null;
          }
          if (this.loadingCancel === cancelLoading) {
            this.loadingCancel = null;
          }
        };

        const cancelLoading = () => {
          cleanup();
          worker.terminate();
          if (this.worker === worker) {
            this.worker = null;
          }
          this.pyodideLoaded = false;
          this.loadingPromise = null;
          reject(new Error(PYODIDE_LOAD_CANCELLED));
        };

        const handler = (event: MessageEvent) => {
          const msg = event.data;
          if (msg.type === 'ready') {
            this.pyodideLoaded = true;
            cleanup();
            resolve();
          } else if (msg.type === 'error') {
            cleanup();
            worker.terminate();
            if (this.worker === worker) {
              this.worker = null;
            }
            this.pyodideLoaded = false;
            this.loadingPromise = null;
            reject(new Error(msg.error?.message ?? 'Failed to load Pyodide'));
          }
        };

        const errorHandler = (event: Event) => {
          cleanup();
          worker.terminate();
          if (this.worker === worker) {
            this.worker = null;
          }
          this.pyodideLoaded = false;
          this.loadingPromise = null;
          reject(new Error(workerLoadErrorMessage(event)));
        };

        this.loadingCancel = cancelLoading;
        worker.addEventListener('message', handler);
        worker.addEventListener('error', errorHandler);
      });
      this.loadingPromise = loadingPromise;
      worker.postMessage({ type: 'init' });
    }

    await loadingPromise;
    if (!this.worker) {
      throw new Error('Python worker failed to load');
    }
    return this.worker;
  }

  async execute(code: string, context?: ExecutionContext): Promise<ExecutionResult> {
    const timeout = context?.timeout ?? DEFAULT_TIMEOUT;
    const stdout: ConsoleOutput[] = [];
    const stderr: ConsoleOutput[] = [];
    const magicResults: MagicCommentResult[] = [];
    let result: unknown;
    let error: ExecutionError | undefined;
    // RL-020 Slice 6 fold G — Pyodide worker's stdin consumption
    // summary; mirror of the JS runner shape.
    let stdinConsumed: { count: number; total: number } | undefined;
    // Independent caps per stream — see JavaScriptRunner.
    let droppedStdout = 0;
    let droppedStderr = 0;
    let stderrByteTruncated = false;

    if (this.currentRunId !== null || this.cancelInFlight !== null) {
      this.stop();
    }

    let worker: Worker;
    try {
      worker = await this.ensurePyodide();
    } catch (err) {
      if (err instanceof Error && err.message === PYODIDE_LOAD_CANCELLED) {
        return runnerStoppedResult(t, { stdout, stderr });
      }
      return {
        stdout: [],
        stderr: [],
        result: undefined,
        executionTime: 0,
        error: {
          message: `Failed to load Python runtime: ${err instanceof Error ? err.message : String(err)}`,
        },
      };
    }

    // Apply loop protection if enabled
    const { loopProtection, maxLoopIterations } = useSettingsStore.getState();
    const processedCode = loopProtection ? injectPythonLoopProtection(code, maxLoopIterations) : code;

    // Transform magic comments before execution
    const magicEntries = detectPythonMagicComments(processedCode);
    const hasMagic = magicEntries.length > 0;
    const transformedCode = hasMagic ? transformPythonMagicComments(processedCode) : processedCode;
    // RL-020 Slice 3 — per-line side-table for the watch / arrow
    // distinction; consulted at result-stitching time below. Slice 5
    // widened `MagicCommentKind` to include `'autoLog'`, but the
    // Python detector never emits that kind (auto-log is JS / TS
    // only this slice). The wider type stays in the field so the
    // shared `MagicCommentResult.kind` annotation does not need a
    // per-language narrowing fork.
    const magicKindByLine: Record<number, MagicCommentKind> = {};
    for (const entry of magicEntries) {
      magicKindByLine[entry.line] = entry.kind;
    }

    const runId = crypto.randomUUID();
    this.currentRunId = runId;

    return new Promise<ExecutionResult>((resolve) => {
      let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
      let resolved = false;

      const finish = (value: ExecutionResult) => {
        if (resolved) return;
        resolved = true;
        if (timeoutHandle !== null) {
          clearTimeout(timeoutHandle);
          timeoutHandle = null;
        }
        worker.removeEventListener('message', handler);
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

      const handler = (event: MessageEvent<WorkerResponse>) => {
        const msg = event.data;
        // RL-078 runId guard. Drop buffered output from a previous,
        // killed run; the persistent Pyodide worker can otherwise
        // leak stale stdout / stderr into the next call.
        if (!('runId' in msg) || msg.runId !== runId) return;
        if (this.currentRunId !== runId) return;

        switch (msg.type) {
          case 'console': {
            const output: ConsoleOutput = { type: msg.method, args: msg.args, line: msg.line };
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
          case 'magic-comment':
            magicResults.push({
              line: msg.line,
              value: msg.value,
              kind: magicKindByLine[msg.line] ?? 'arrow',
            });
            break;
          case 'stdin-consumed': {
            const summary = msg as unknown as { count: unknown; total: unknown };
            const count =
              typeof summary.count === 'number' && Number.isInteger(summary.count)
                ? Math.max(0, summary.count)
                : 0;
            const total =
              typeof summary.total === 'number' && Number.isInteger(summary.total)
                ? Math.max(0, summary.total)
                : 0;
            stdinConsumed = { count, total };
            break;
          }
          case 'result':
            result = msg.value;
            break;
          case 'error':
            error = msg.error;
            break;
          case 'done':
            finish({
              stdout,
              stderr,
              result,
              executionTime: msg.executionTime,
              error,
              magicResults: magicResults.length > 0 ? magicResults : undefined,
              stdinConsumed,
            });
            break;
        }
      };

      worker.addEventListener('message', handler);

      // RL-078 — parent-owned kill timer. Pyodide can't yield a
      // CPU-bound `while True: pass` from inside the worker, so the
      // only deterministic recovery is to terminate the worker and
      // recreate it on the next execute(). We clear `pyodideLoaded`
      // and `loadingPromise` so `ensurePyodide()` rebuilds from
      // scratch instead of returning a dead handle.
      timeoutHandle = setTimeout(() => {
        worker.terminate();
        if (this.worker === worker) {
          this.worker = null;
          this.pyodideLoaded = false;
          this.loadingPromise = null;
        }
        finish(runnerTimeoutResult(timeout, t, { stdout, stderr }));
      }, timeout);

      // RL-011 Slice D third increment — pipe the resolved user env
      // into the Pyodide worker so user code's `os.environ` reflects
      // the global / project / tab tiers. Empty record keeps the
      // worker's fast path untouched.
      const userEnv = resolveUserEnvForRunner();
      worker.postMessage({
        type: 'execute',
        runId,
        code: transformedCode,
        timeout,
        resultTruncationMarker: t('runner.truncated.result'),
        userEnv,
        // RL-020 Slice 6 — pre-set stdin buffer forwarded into Pyodide
        // via `pyodide.setStdin`. Empty / undefined leaves the
        // default handler in place, which preserves Pyodide's stock
        // EOFError on bare `input()` calls.
        stdin: context?.stdin,
      });
    });
  }

  stop(): void {
    if (this.loadingCancel) {
      const cancelLoading = this.loadingCancel;
      this.loadingCancel = null;
      cancelLoading();
    }
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
      this.pyodideLoaded = false;
      this.loadingPromise = null;
    }
    this.currentRunId = null;
    if (this.cancelInFlight) {
      const cancel = this.cancelInFlight;
      this.cancelInFlight = null;
      cancel();
    }
  }
}
