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
 *
 * RL-027 Slice 1: when the renderer instrumented the source, the
 * `execute` payload carries `{ debug: true, breakpoints, ... }`. The
 * worker injects two closure helpers — `__lingua_dbg_yield(line, getLocals)`
 * called before each statement, and `__lingua_dbg_frame(name, line)` /
 * `__lingua_dbg_pop()` for frame-depth tracking that powers step-over
 * / step-into / step-out. Pauses fire only when the breakpoint set
 * contains the current line OR the current step mode dictates a stop;
 * otherwise the yield function fast-paths to `Promise.resolve()`.
 *
 * Reference: `docs/PLAN.md` RL-027 Slice 1 and `docs/DEBUGGER_ADR.md`.
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

function sourceLineFor(
  generatedLine: number | undefined,
  sourceLineMap: Record<number, number> | undefined
): number | undefined {
  if (generatedLine === undefined) return undefined;
  const mapped = sourceLineMap?.[generatedLine];
  return typeof mapped === 'number' && mapped > 0 ? mapped : generatedLine;
}

function createConsoleProxy(
  runId: string,
  marker: string,
  sourceLineMap?: Record<number, number>
) {
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
          const generatedLine = rawLine > 2 ? rawLine - 2 : rawLine;
          line = sourceLineFor(generatedLine, sourceLineMap);
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

/**
 * RL-027 Slice 1 — debugger pause coordination.
 *
 * Slice 1 ships the pause/resume/step protocol with frame-depth
 * tracking. Conditional breakpoint predicates and watch expressions
 * are STORED on the session (so the UI surfaces them) but their
 * evaluation lands in Slice 1.5 — the eval mechanism needs a
 * dedicated security review pass that this slice doesn't budget.
 * For Slice 1, conditional breakpoints always pause (as if the
 * predicate were `true`), and watch results carry an
 * `evaluation: 'pending'` marker so the UI can render the deferred
 * state without misleading the user.
 */
type StepMode = 'none' | 'over' | 'into' | 'out';

interface DebuggerSessionState {
  runId: string;
  enabled: boolean;
  breakpoints: Map<number, { condition: string }>;
  watches: string[];
  stepMode: StepMode;
  /** Frame depth at which the active step request was issued. */
  stepDepth: number;
  /** Live call stack — newest frame last. */
  frames: { functionName: string; line: number }[];
  /** Resolver for the pending `resume`/`step` await. */
  resumeResolver: (() => void) | null;
}

function createSession(runId: string): DebuggerSessionState {
  return {
    runId,
    enabled: false,
    breakpoints: new Map(),
    watches: [],
    stepMode: 'none',
    stepDepth: 0,
    frames: [],
    resumeResolver: null,
  };
}

interface ExecuteMessage {
  type: 'execute';
  runId: string;
  code: string;
  resultTruncationMarker?: string;
  debug?: boolean;
  breakpoints?: { line: number; condition?: string }[];
  watches?: string[];
  sourceLineMap?: Record<number, number>;
  /**
   * RL-020 Slice 6 — pre-set stdin buffer for `prompt()` /
   * `readline()`. Newline-delimited. Empty / undefined leaves the
   * native worker behavior in place (worker has no `prompt`, so
   * calls throw `ReferenceError`).
   */
  stdin?: string;
}

/**
 * RL-020 Slice 6 — line-by-line stdin reader. The worker constructs
 * a fresh reader on each `execute` request; consumed lines are
 * tracked locally and reported back to the main thread via the
 * `stdin-consumed` reply right before `done`. `getCount()` and
 * `getTotal()` feed the fold-G "Used N of M lines" surface.
 */
interface StdinReader {
  consume: () => string | null;
  getCount: () => number;
  getTotal: () => number;
}

function createStdinReader(buffer: string | undefined): StdinReader {
  if (!buffer || buffer.length === 0) {
    return {
      consume: () => null,
      getCount: () => 0,
      getTotal: () => 0,
    };
  }
  // Split on `\n`; trim a trailing empty segment so the user typing
  // `2\n3\n` is the same as `2\n3` (3 reads would return null on the
  // 3rd call either way).
  const rawLines = buffer.split('\n');
  if (rawLines.length > 0 && rawLines[rawLines.length - 1] === '') {
    rawLines.pop();
  }
  let cursor = 0;
  return {
    consume: () => {
      if (cursor >= rawLines.length) return null;
      const value = rawLines[cursor]!;
      cursor += 1;
      return value;
    },
    getCount: () => cursor,
    getTotal: () => rawLines.length,
  };
}

function applyExecutePayload(session: DebuggerSessionState, msg: ExecuteMessage): void {
  session.enabled = msg.debug === true;
  session.breakpoints.clear();
  if (Array.isArray(msg.breakpoints)) {
    for (const bp of msg.breakpoints) {
      if (typeof bp.line === 'number' && bp.line > 0) {
        session.breakpoints.set(bp.line, { condition: bp.condition ?? '' });
      }
    }
  }
  session.watches = Array.isArray(msg.watches) ? msg.watches : [];
  session.stepMode = 'none';
  session.stepDepth = 0;
  session.frames = [];
  session.resumeResolver = null;
}

let activeSession: DebuggerSessionState | null = null;

ctx.addEventListener('message', async (event) => {
  const msg = event.data;

  // RL-027 Slice 1 — debugger control messages from main. These
  // arrive WHILE a run is ongoing (the worker is paused awaiting a
  // resume), so we route them ahead of the `execute` branch.
  if (msg.type === 'resume' || msg.type === 'step') {
    const session = activeSession;
    if (!session || !session.resumeResolver) return;
    if (msg.type === 'step') {
      session.stepMode = (msg.mode as StepMode) ?? 'over';
      session.stepDepth = session.frames.length;
    } else {
      session.stepMode = 'none';
    }
    ctx.postMessage({ type: 'resumed', runId: session.runId });
    const resolver = session.resumeResolver;
    session.resumeResolver = null;
    resolver();
    return;
  }

  if (msg.type === 'set-breakpoints') {
    const session = activeSession;
    if (!session) return;
    session.breakpoints.clear();
    const bps = (msg as { breakpoints?: { line: number; condition?: string }[] }).breakpoints;
    if (Array.isArray(bps)) {
      for (const bp of bps) {
        if (typeof bp.line === 'number' && bp.line > 0) {
          session.breakpoints.set(bp.line, { condition: bp.condition ?? '' });
        }
      }
    }
    return;
  }

  if (msg.type === 'execute') {
    const exec = msg as ExecuteMessage;
    const { runId, code, resultTruncationMarker } = exec;
    const marker =
      typeof resultTruncationMarker === 'string' && resultTruncationMarker.length > 0
        ? resultTruncationMarker
        : FALLBACK_RESULT_TRUNCATION_MARKER;
    const startTime = performance.now();

    createConsoleProxy(runId, marker, exec.sourceLineMap);

    const session = createSession(runId);
    applyExecutePayload(session, exec);
    activeSession = session;

    // RL-020 Slice 6 — install line-by-line stdin readers. We
    // capture the previous values so a follow-up run starts from a
    // clean global scope (workers are single-shot today so this is
    // belt-and-braces, but if a future runner reuses the same
    // worker context the restoration keeps it honest).
    const stdinReader = createStdinReader(exec.stdin);
    const prevPrompt = (self as unknown as { prompt?: unknown }).prompt;
    const prevReadline = (self as unknown as { readline?: unknown }).readline;
    if (exec.stdin && exec.stdin.length > 0) {
      const consumer = () => stdinReader.consume();
      (self as unknown as { prompt: (message?: string) => string | null }).prompt =
        consumer;
      (self as unknown as { readline: () => string | null }).readline = consumer;
    }

    try {
      const executionPromise = (async () => {
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

        // RL-027 Slice 1 — yield helper. Called before each
        // instrumented statement. Fast path when debug is off OR
        // no breakpoint matches AND no step mode is armed.
        const __lingua_dbg_yield = async (
          line: number,
          getLocals: () => Record<string, unknown>
        ): Promise<void> => {
          if (!session.enabled) return;
          const breakpoint = session.breakpoints.get(line);
          const shouldPauseForStep =
            session.stepMode === 'into' ||
            (session.stepMode === 'over' &&
              session.frames.length <= session.stepDepth) ||
            (session.stepMode === 'out' && session.frames.length < session.stepDepth);

          // Slice 1: predicates are stored but always treated as true
          // (no eval until Slice 1.5's security review). The UI badge
          // surfaces this as "predicate stored, evaluation pending".
          const shouldPauseForBreakpoint = Boolean(breakpoint);

          if (!shouldPauseForBreakpoint && !shouldPauseForStep) return;

          const localsRaw = (() => {
            try {
              return getLocals();
            } catch {
              return {};
            }
          })();
          const localsSerialized: Record<string, string> = {};
          for (const [name, value] of Object.entries(localsRaw)) {
            localsSerialized[name] = serialize([value], marker)[0]!;
          }

          // Slice 1: watch expressions echo back as `pending` markers.
          // The Variables panel covers the actual locals; users who
          // want richer expressions will get them in Slice 1.5.
          const watchResults: Record<
            string,
            { value?: string; error?: string; pending?: boolean }
          > = {};
          for (const expr of session.watches) {
            watchResults[expr] = { pending: true };
          }

          const reason: 'user-breakpoint' | 'step' = shouldPauseForBreakpoint
            ? 'user-breakpoint'
            : 'step';

          ctx.postMessage({
            type: 'paused',
            runId,
            line,
            reason,
            locals: localsSerialized,
            callStack: [...session.frames].reverse(),
            watchResults,
            conditionalPending: Boolean(breakpoint?.condition),
          });

          await new Promise<void>((resolve) => {
            session.resumeResolver = resolve;
          });
        };

        const __lingua_dbg_frame = (
          functionName: string,
          line: number
        ): void => {
          session.frames.push({ functionName, line });
        };

        const __lingua_dbg_pop = (): void => {
          session.frames.pop();
        };

        const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
        const fn = new AsyncFunction(
          '__mc',
          '__lingua_dbg_yield',
          '__lingua_dbg_frame',
          '__lingua_dbg_pop',
          code
        );
        return await fn(__mc, __lingua_dbg_yield, __lingua_dbg_frame, __lingua_dbg_pop);
      })();

      const result = await executionPromise;

      if (result !== undefined) {
        ctx.postMessage({
          type: 'result',
          runId,
          value: serialize([result], marker)[0],
        });
      }

      const executionTime = performance.now() - startTime;
      // RL-020 Slice 6 fold G — emit consumption summary BEFORE the
      // `done` reply so the runner can stitch it onto the
      // `ExecutionResult` the panel renders.
      if (stdinReader.getTotal() > 0) {
        ctx.postMessage({
          type: 'stdin-consumed',
          runId,
          count: stdinReader.getCount(),
          total: stdinReader.getTotal(),
        });
      }
      ctx.postMessage({ type: 'done', runId, executionTime });
    } catch (err) {
      const executionTime = performance.now() - startTime;
      const parsed = parseError(err);

      ctx.postMessage({
        type: 'error',
        runId,
        error: parsed,
      });

      if (stdinReader.getTotal() > 0) {
        ctx.postMessage({
          type: 'stdin-consumed',
          runId,
          count: stdinReader.getCount(),
          total: stdinReader.getTotal(),
        });
      }
      ctx.postMessage({ type: 'done', runId, executionTime });
    } finally {
      restoreConsole();
      // Restore the previous prompt / readline bindings even though
      // the worker is single-shot — keeps the worker test harness
      // honest if a future test reuses the context. When the
      // previous binding was `undefined` (the worker has no native
      // `prompt`), DELETE the own property rather than re-assigning
      // it to literal `undefined`; otherwise `'prompt' in self`
      // would return `true` after restoration and a future
      // "was patched?" check would misread the state.
      const selfWithIO = self as unknown as {
        prompt?: unknown;
        readline?: unknown;
      };
      if (prevPrompt === undefined) {
        delete selfWithIO.prompt;
      } else {
        selfWithIO.prompt = prevPrompt;
      }
      if (prevReadline === undefined) {
        delete selfWithIO.readline;
      } else {
        selfWithIO.readline = prevReadline;
      }
      activeSession = null;
    }
  }
});
