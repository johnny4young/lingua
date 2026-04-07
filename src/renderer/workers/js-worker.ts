/**
 * JavaScript execution Web Worker.
 *
 * Runs user code in an isolated context with console capture and timeout support.
 * Communication via structured messages (WorkerRequest / WorkerResponse).
 */

// Make this file a module so TS doesn't merge its scope with other workers
export {};

// Type-safe message posting (Worker context has no DOM types)
const ctx = self as unknown as Worker;

/** Override console methods to capture output and send to main thread */
const originalConsole = {
  log: console.log.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
  info: console.info.bind(console),
};

function serialize(args: unknown[]): string[] {
  return args.map((arg) => {
    if (arg === undefined) return 'undefined';
    if (arg === null) return 'null';
    if (typeof arg === 'string') return arg;
    if (typeof arg === 'function') return `[Function: ${arg.name || 'anonymous'}]`;
    if (arg instanceof Error) return `${arg.name}: ${arg.message}`;
    try {
      return JSON.stringify(arg, null, 2);
    } catch {
      return String(arg);
    }
  });
}

function createConsoleProxy() {
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
        method,
        args: serialize(args),
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
    const { code, timeout } = msg;
    const startTime = performance.now();
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    createConsoleProxy();

    try {
      // Set up timeout
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error(`Execution timed out after ${timeout / 1000}s`));
        }, timeout);
      });

      // Execute user code using async Function constructor for top-level await support
      const executionPromise = (async () => {
        // Wrap in async Function to support top-level await
        const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
        const fn = new AsyncFunction(code);
        return await fn();
      })();

      const result = await Promise.race([executionPromise, timeoutPromise]);

      if (timeoutId) clearTimeout(timeoutId);

      // Send result if there is one
      if (result !== undefined) {
        ctx.postMessage({
          type: 'result',
          value: serialize([result])[0],
        });
      }

      const executionTime = performance.now() - startTime;
      ctx.postMessage({ type: 'done', executionTime });
    } catch (err) {
      if (timeoutId) clearTimeout(timeoutId);

      const executionTime = performance.now() - startTime;
      const parsed = parseError(err);

      ctx.postMessage({
        type: 'error',
        error: parsed,
      });

      ctx.postMessage({ type: 'done', executionTime });
    } finally {
      restoreConsole();
    }
  }
});
