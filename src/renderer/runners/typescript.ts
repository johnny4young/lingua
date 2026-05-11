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
import { useDebuggerStore } from '../stores/debuggerStore';
import { instrumentForDebugger } from '../runtime/debuggerInstrument';
import { setActiveDebugWorker } from '../runtime/debuggerWorkerBridge';
import { trackEvent } from '../utils/telemetry';
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
  private debugSessionActive = false;
  /** RL-078 — see JavaScriptRunner.cancelInFlight. */
  private cancelInFlight: (() => void) | null = null;
  /**
   * TypeScript has an async transpile phase before the worker starts.
   * This token invalidates stale transpiles when Run/Stop is pressed
   * while esbuild is still resolving.
   */
  private executionGeneration = 0;

  private clearDebuggerSession(
    reasonBucket:
      | 'run-complete'
      | 'crash'
      | 'stop'
      | 'user-detach' = 'run-complete'
  ): void {
    if (!this.debugSessionActive) return;
    this.debugSessionActive = false;
    // See JavaScriptRunner.clearDebuggerSession — the drawer's user-detach
    // path clears the store session before the worker's `done` message
    // arrives, so we skip the second telemetry fire on the runner side.
    const userDetachedAlready = useDebuggerStore.getState().session === null;
    useDebuggerStore.getState().detachSession();
    setActiveDebugWorker(null);
    if (!userDetachedAlready) {
      void trackEvent('debugger.detached', { language: 'js', reasonBucket });
    }
  }

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

  /**
   * Transpile TypeScript to JavaScript using esbuild-wasm.
   *
   * Slice 1.5 fold G — when `withMap` is true (debug runs only) we ask
   * esbuild for an external source map so the debugger instrumenter
   * can compose the TS→JS map with its own JS→JS map and pause at the
   * user's TS line. The map costs ~2x bytes per call; non-debug runs
   * stay on the cheap `sourcemap: false` path.
   */
  private async transpile(
    code: string,
    withMap = false
  ): Promise<{ js: string; map?: string; error?: ExecutionError }> {
    try {
      const result = await esbuild.transform(code, {
        loader: 'tsx',
        target: 'es2022',
        format: 'esm',
        sourcemap: withMap ? 'external' : false,
      });

      if (result.warnings.length > 0) {
        // Warnings are not fatal; just log them
        for (const w of result.warnings) {
          console.warn(`[esbuild] ${w.text}`);
        }
      }

      return { js: result.code, map: withMap ? result.map : undefined };
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

    // RL-027 Slice 1 — debug mode resolution mirrors the JS runner.
    const settings = useSettingsStore.getState();
    const debuggerSettings = settings.debuggerEnabled !== false;
    const debugStore = useDebuggerStore.getState();
    const tabBreakpoints = context?.tabId
      ? debugStore.breakpointsForTab(context.tabId).filter((bp) => bp.enabled)
      : [];
    const debug = debuggerSettings && tabBreakpoints.length > 0;

    // Step 1: Apply loop protection unless debug mode is active.
    const { loopProtection, maxLoopIterations } = settings;
    const processedCode =
      loopProtection && !debug ? injectJSLoopProtection(code, maxLoopIterations) : code;

    // Step 1b: Transform magic comments before transpilation
    // (esbuild would strip the //=> comments during transpilation)
    const hasMagic = detectJSMagicComments(processedCode).length > 0;
    const codeForTranspile = hasMagic ? transformJSMagicComments(processedCode) : processedCode;

    this.stop();
    const executionGeneration = ++this.executionGeneration;

    // Step 2: Transpile TS -> JS. Transpile happens BEFORE the parent
    // kill timer arms; an esbuild parse error reports immediately and
    // never spawns a worker. Slice 1.5 fold G — request the source map
    // only on debug runs; the map is what the instrumenter composes
    // with its own JS→JS map to pause at the user's TS line.
    const { js, map: tsMap, error: transpileError } =
      await this.transpile(codeForTranspile, debug);

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

    // RL-027 Slice 1 — instrument the transpiled JS when debug is on.
    // Slice 1.5 fold G — pass the esbuild TS→JS map so the instrumenter
    // can compose it with its own JS→JS map and emit yields that fire
    // on the user's TS line numbers (which is what the breakpoint store
    // already keeps).
    let instrumented = js;
    if (debug) {
      try {
        const result = instrumentForDebugger(js, {
          filename: context?.tabId ?? 'user-code.js',
          inputMap: tsMap,
        });
        instrumented = result.code;
      } catch {
        instrumented = js;
      }
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
          case 'paused': {
            const paused = msg as unknown as {
              line: number;
              reason: 'user-breakpoint' | 'step';
              locals: Record<string, string>;
              callStack: { functionName: string; line: number }[];
              watchResults: Record<string, { value?: string; error?: string; pending?: boolean }>;
            };
            if (context?.tabId) {
              useDebuggerStore.getState().setPausedFrame({
                tabId: context.tabId,
                line: paused.line,
                reason: paused.reason,
                locals: paused.locals,
                callStack: paused.callStack,
                watchResults: paused.watchResults,
              });
              void trackEvent('debugger.paused', {
                language: 'js',
                reasonBucket: paused.reason,
              });
            }
            break;
          }
          case 'done':
            finish({
              stdout,
              stderr,
              result,
              executionTime: msg.executionTime,
              error,
              magicResults: magicResults.length > 0 ? magicResults : undefined,
            });
            this.clearDebuggerSession('run-complete');
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
        // RL-027 Slice 1 — same cleanup as the JS runner crash path.
        this.clearDebuggerSession('crash');
        worker.terminate();
        if (this.worker === worker) this.worker = null;
      });

      // RL-078 — parent-owned kill timer.
      timeoutHandle = setTimeout(() => {
        worker.terminate();
        if (this.worker === worker) this.worker = null;
        // RL-027 Slice 1 — clear the debugger bridge + session on
        // timeout so a follow-up F5/F10 doesn't post to a dead worker.
        this.clearDebuggerSession('stop');
        finish(runnerTimeoutResult(timeout, t, { stdout, stderr }));
      }, timeout);

      if (debug && context?.tabId) {
        this.debugSessionActive = true;
        useDebuggerStore.getState().attachSession({
          runtime: 'js',
          tabId: context.tabId,
          attachedAt: Date.now(),
        });
        setActiveDebugWorker(worker);
        // RL-027 Slice 1.5 — `language: 'js'` is correct because the
        // runtime adapter is the JS worker (TS transpiles through
        // esbuild and runs in the same worker).
        void trackEvent('debugger.attached', { language: 'js', reasonBucket: 'attach' });
      }
      worker.postMessage({
        type: 'execute',
        runId,
        code: instrumented,
        timeout,
        resultTruncationMarker: t('runner.truncated.result'),
        debug,
        breakpoints: tabBreakpoints.map((bp) => ({ line: bp.line, condition: bp.condition })),
        watches: debug ? debugStore.watches.map((w) => w.expression) : [],
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
    this.clearDebuggerSession('stop');
    if (this.cancelInFlight) {
      const cancel = this.cancelInFlight;
      this.cancelInFlight = null;
      cancel();
    }
  }
}
