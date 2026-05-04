/**
 * JavaScript execution Web Worker.
 *
 * Runs user code in an isolated context with console capture.
 * Communication via structured messages (WorkerRequest / WorkerResponse).
 *
 * RL-078: this worker no longer schedules its own deadline. The
 * parent renderer thread owns a kill timer and calls
 * `worker.terminate()` if user code does not yield in time. The
 * `runId` from each `execute` request is echoed on every reply so
 * the parent can drop messages from a previous (terminated) run.
 */

// Make this file a module so TS doesn't merge its scope with other workers
export {};

import { truncateSerialized } from '../runners/limits';

// Type-safe message posting (Worker context has no DOM types)
const ctx = self as unknown as Worker;

/** Override console methods to capture output and send to main thread */
const originalConsole = {
  log: console.log.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
  info: console.info.bind(console),
};

/** Fallback only used for malformed legacy messages without a marker. */
const FALLBACK_RESULT_TRUNCATION_MARKER = '[result truncated]';

function truncate(value: string, marker: string): string {
  return truncateSerialized(value, marker);
}

function serialize(args: unknown[], marker: string): string[] {
  return args.map((arg) => {
    if (arg === undefined) return 'undefined';
    if (arg === null) return 'null';
    if (typeof arg === 'string') return truncate(arg, marker);
    if (typeof arg === 'function') return `[Function: ${arg.name || 'anonymous'}]`;
    if (arg instanceof Error) return `${arg.name}: ${arg.message}`;
    try {
      return truncate(JSON.stringify(arg, null, 2), marker);
    } catch {
      return truncate(String(arg), marker);
    }
  });
}

function createConsoleProxy(runId: string, marker: string) {
  const methods = ['log', 'warn', 'error', 'info'] as const;
  for (const method of methods) {
    console[method] = (...args: unknown[]) => {
      // Extract calling line number from the stack trace.
      // The AsyncFunction constructor wraps user code, adding 2 lines of offset.
      let line: number | undefined;
      try {
        const stack = new Error().stack ?? '';
        const match = stack.match(/<anonymous>:(\d+):(\d+)/);
        if (match?.[1]) {
          const rawLine = parseInt(match[1], 10);
          // Subtract the 2-line offset from the async function wrapper
          line = rawLine > 2 ? rawLine - 2 : rawLine;
        }
      } catch {
        // ignore
      }

      ctx.postMessage({
        type: 'console',
        runId,
        method,
        args: serialize(args, marker),
        line,
      });
    };
  }
}

function restoreConsole() {
  console.log = originalConsole.log;
  console.warn = originalConsole.warn;
  console.error = originalConsole.error;
  console.info = originalConsole.info;
}

/** Parse error to extract line/column from stack trace */
function parseError(err: unknown): { message: string; line?: number; column?: number; stack?: string } {
  if (!(err instanceof Error)) {
    return { message: String(err) };
  }

  const result: { message: string; line?: number; column?: number; stack?: string } = {
    message: err.message,
    stack: err.stack,
  };

  // Try to extract line/column from stack trace
  // Format: "at eval (eval at <anonymous> (:1:1), <anonymous>:LINE:COL)"
  // or:     "at <anonymous>:LINE:COL"
  if (err.stack) {
    const match = err.stack.match(/<anonymous>:(\d+):(\d+)/);
    const lineValue = match?.[1];
    const columnValue = match?.[2];
    if (lineValue && columnValue) {
      result.line = parseInt(lineValue, 10);
      result.column = parseInt(columnValue, 10);
    }
  }

  return result;
}

ctx.addEventListener('message', async (event) => {
  const msg = event.data;

  if (msg.type === 'execute') {
    const { runId, code, resultTruncationMarker } = msg as {
      type: 'execute';
      runId: string;
      code: string;
      resultTruncationMarker?: string;
    };
    const marker =
      typeof resultTruncationMarker === 'string' && resultTruncationMarker.length > 0
        ? resultTruncationMarker
        : FALLBACK_RESULT_TRUNCATION_MARKER;
    const startTime = performance.now();

    createConsoleProxy(runId, marker);

    try {
      // Execute user code using async Function constructor for top-level await support.
      // RL-078: no in-worker timeout race — the parent terminates us.
      const executionPromise = (async () => {
        // Magic comment helper: captures expression value and sends to main thread
        const __mc = (line: number, value: unknown) => {
          let serialized: string;
          try {
            serialized = serialize([value], marker)[0]!;
          } catch {
            serialized = truncate(String(value), marker);
          }
          ctx.postMessage({
            type: 'magic-comment',
            runId,
            line,
            value: serialized,
          });
        };

        // Wrap in async Function to support top-level await
        const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
        const fn = new AsyncFunction('__mc', code);
        return await fn(__mc);
      })();

      const result = await executionPromise;

      // Send result if there is one
      if (result !== undefined) {
        ctx.postMessage({
          type: 'result',
          runId,
          value: serialize([result], marker)[0],
        });
      }

      const executionTime = performance.now() - startTime;
      ctx.postMessage({ type: 'done', runId, executionTime });
    } catch (err) {
      const executionTime = performance.now() - startTime;
      const parsed = parseError(err);

      ctx.postMessage({
        type: 'error',
        runId,
        error: parsed,
      });

      ctx.postMessage({ type: 'done', runId, executionTime });
    } finally {
      restoreConsole();
    }
  }
});
