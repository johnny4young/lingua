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
import { transformJSMagicComments, detectJSMagicComments } from '../utils/magicComments';
import { injectJSLoopProtection } from '../utils/loopProtection';
import { useSettingsStore } from '../stores/settingsStore';
import {
  appendCappedConsole,
  capStderrIfOverflowing,
  runnerStoppedResult,
  runnerTimeoutResult,
  type TranslateFn,
} from './limits';

const DEFAULT_TIMEOUT = 30_000; // 30 seconds

const t: TranslateFn = (key, options) =>
  i18next.t(key, options ?? {}) as string;

export class JavaScriptRunner implements LanguageRunner {
  id = 'javascript';
  name = 'JavaScript';
  language = 'javascript' as const;
  extensions = ['.js', '.mjs'];

  private worker: Worker | null = null;
  private ready = false;
  /**
   * RL-078 — opaque token of the currently-running execute() call.
   * Worker replies whose `runId` does not match are dropped, so a
   * stale `done` arriving after `terminate()` cannot poison the
   * next run.
   */
  private currentRunId: string | null = null;
  /**
   * RL-078 — `stop()` ends an in-flight run by terminating the
   * worker. The closure that owns the resolve / cleanup pair lives
   * inside `execute()`; we expose it here so the stop button (or a
   * follow-up `execute()` call) can shut the promise down cleanly
   * instead of leaving the renderer waiting on a dead worker.
   */
  private cancelInFlight: (() => void) | null = null;

  async init(): Promise<void> {
    this.ready = true;
  }

  isReady(): boolean {
    return this.ready;
  }

  async execute(code: string, context?: ExecutionContext): Promise<ExecutionResult> {
    const timeout = context?.timeout ?? DEFAULT_TIMEOUT;
    const stdout: ConsoleOutput[] = [];
    const stderr: ConsoleOutput[] = [];
    const magicResults: MagicCommentResult[] = [];
    let result: unknown;
    let error: ExecutionError | undefined;
    // Independent caps per stream — stdout overflowing should not
    // mute the truncation notice on stderr (and vice versa).
    let droppedStdout = 0;
    let droppedStderr = 0;
    let stderrByteTruncated = false;

    // Apply loop protection if enabled
    const { loopProtection, maxLoopIterations } = useSettingsStore.getState();
    const processedCode = loopProtection ? injectJSLoopProtection(code, maxLoopIterations) : code;

    // Transform magic comments before execution
    const hasMagic = detectJSMagicComments(processedCode).length > 0;
    const transformedCode = hasMagic ? transformJSMagicComments(processedCode) : processedCode;

    // Terminate any previous worker. `stop()` also bumps `currentRunId`
    // to null so any in-flight messages from the old worker are dropped.
    this.stop();

    const runId = crypto.randomUUID();
    this.currentRunId = runId;

    return new Promise<ExecutionResult>((resolve) => {
      // Create a new worker for each execution (clean state)
      this.worker = new Worker(
        new URL('../workers/js-worker.ts', import.meta.url),
        { type: 'module' }
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
        // Drop the runId so any latent worker reply is rejected.
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

      worker.addEventListener('message', (event: MessageEvent<WorkerResponse>) => {
        const msg = event.data;
        // RL-078 — runId guard. Drop stale messages from terminated workers.
        if (!('runId' in msg) || msg.runId !== runId) return;
        if (this.currentRunId !== runId) return;

        switch (msg.type) {
          case 'console': {
            const output: ConsoleOutput = {
              type: msg.method,
              args: msg.args,
              line: msg.line,
            };
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
            magicResults.push({ line: msg.line, value: msg.value });
            break;
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
            });
            // Worker is single-shot for JS; terminate so we don't leak.
            worker.terminate();
            if (this.worker === worker) this.worker = null;
            break;
        }
      });

      worker.addEventListener('error', (event) => {
        finish({
          stdout,
          stderr,
          result: undefined,
          executionTime: 0,
          error: {
            message: event.message || 'Worker error',
          },
        });
        worker.terminate();
        if (this.worker === worker) this.worker = null;
      });

      // RL-078 — parent-owned kill timer. If user code never yields,
      // the in-worker handlers above never fire; this timer is the
      // only thing that can recover the UI. Terminating the worker
      // also drops any future postMessage it may have queued.
      timeoutHandle = setTimeout(() => {
        worker.terminate();
        if (this.worker === worker) this.worker = null;
        finish(
          runnerTimeoutResult(timeout, t, { stdout, stderr })
        );
      }, timeout);

      // Send execution request
      worker.postMessage({
        type: 'execute',
        runId,
        code: transformedCode,
        timeout,
        resultTruncationMarker: t('runner.truncated.result'),
      });
    });
  }

  stop(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    this.currentRunId = null;
    // Resolve any in-flight execute() promise so the renderer is
    // not left waiting on a worker we just killed.
    if (this.cancelInFlight) {
      const cancel = this.cancelInFlight;
      this.cancelInFlight = null;
      cancel();
    }
  }
}
