import * as esbuild from 'esbuild-wasm';
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

const DEFAULT_TIMEOUT = 30_000;

let esbuildInitialized = false;

const t: TranslateFn = (key, options) =>
  i18next.t(key, options ?? {}) as string;

export class TypeScriptRunner implements LanguageRunner {
  id = 'typescript';
  name = 'TypeScript';
  language = 'typescript' as const;
  extensions = ['.ts', '.tsx'];

  private worker: Worker | null = null;
  private ready = false;
  /** RL-078 — see JavaScriptRunner.currentRunId. */
  private currentRunId: string | null = null;
  /** RL-078 — see JavaScriptRunner.cancelInFlight. */
  private cancelInFlight: (() => void) | null = null;
  /**
   * TypeScript has an async transpile phase before the worker starts.
   * This token invalidates stale transpiles when Run/Stop is pressed
   * while esbuild is still resolving.
   */
  private executionGeneration = 0;

  async init(): Promise<void> {
    if (!esbuildInitialized) {
      await esbuild.initialize({
        wasmURL: new URL('esbuild-wasm/esbuild.wasm', import.meta.url).href,
      });
      esbuildInitialized = true;
    }
    this.ready = true;
  }

  isReady(): boolean {
    return this.ready;
  }

  /** Transpile TypeScript to JavaScript using esbuild-wasm */
  private async transpile(code: string): Promise<{ js: string; error?: ExecutionError }> {
    try {
      const result = await esbuild.transform(code, {
        loader: 'tsx',
        target: 'es2022',
        format: 'esm',
        sourcemap: false,
      });

      if (result.warnings.length > 0) {
        // Warnings are not fatal; just log them
        for (const w of result.warnings) {
          console.warn(`[esbuild] ${w.text}`);
        }
      }

      return { js: result.code };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);

      // Try to parse esbuild error for line/column info
      const lineMatch = message.match(/(\d+):(\d+)/);
      const lineValue = lineMatch?.[1];
      const columnValue = lineMatch?.[2];
      return {
        js: '',
        error: {
          message: `TypeScript transpilation error: ${message}`,
          line: lineValue ? parseInt(lineValue, 10) : undefined,
          column: columnValue ? parseInt(columnValue, 10) : undefined,
        },
      };
    }
  }

  async execute(code: string, context?: ExecutionContext): Promise<ExecutionResult> {
    const timeout = context?.timeout ?? DEFAULT_TIMEOUT;

    // Step 1: Apply loop protection if enabled
    const { loopProtection, maxLoopIterations } = useSettingsStore.getState();
    const processedCode = loopProtection ? injectJSLoopProtection(code, maxLoopIterations) : code;

    // Step 1b: Transform magic comments before transpilation
    // (esbuild would strip the //=> comments during transpilation)
    const hasMagic = detectJSMagicComments(processedCode).length > 0;
    const codeForTranspile = hasMagic ? transformJSMagicComments(processedCode) : processedCode;

    this.stop();
    const executionGeneration = ++this.executionGeneration;

    // Step 2: Transpile TS -> JS. Transpile happens BEFORE the parent
    // kill timer arms; an esbuild parse error reports immediately and
    // never spawns a worker.
    const { js, error: transpileError } = await this.transpile(codeForTranspile);

    if (executionGeneration !== this.executionGeneration) {
      return runnerStoppedResult(t, { stdout: [], stderr: [] });
    }

    if (transpileError) {
      return {
        stdout: [],
        stderr: [],
        result: undefined,
        executionTime: 0,
        error: transpileError,
      };
    }

    // Step 3: Execute the transpiled JS using the same JS worker
    const stdout: ConsoleOutput[] = [];
    const stderr: ConsoleOutput[] = [];
    const magicResults: MagicCommentResult[] = [];
    let result: unknown;
    let error: ExecutionError | undefined;
    // Independent caps per stream — see JavaScriptRunner.
    let droppedStdout = 0;
    let droppedStderr = 0;
    let stderrByteTruncated = false;

    const runId = crypto.randomUUID();
    this.currentRunId = runId;

    return new Promise<ExecutionResult>((resolve) => {
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
          error: { message: event.message || 'Worker error' },
        });
        worker.terminate();
        if (this.worker === worker) this.worker = null;
      });

      // RL-078 — parent-owned kill timer.
      timeoutHandle = setTimeout(() => {
        worker.terminate();
        if (this.worker === worker) this.worker = null;
        finish(runnerTimeoutResult(timeout, t, { stdout, stderr }));
      }, timeout);

      worker.postMessage({
        type: 'execute',
        runId,
        code: js,
        timeout,
        resultTruncationMarker: t('runner.truncated.result'),
      });
    });
  }

  stop(): void {
    this.executionGeneration += 1;
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
