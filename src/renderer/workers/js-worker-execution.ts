import type { ScopeVariable } from '../../shared/scopeSnapshot';
import { finalizeScopeSnapshot } from '../../shared/scopeSnapshot';
import {
  applyJsWorkerExecutePayload,
  createJsWorkerDebuggerSession,
  sanitizeJsWorkerWatches,
  type JsWorkerDebuggerSession,
} from './js-worker-debugger';
import {
  evaluateDebuggerExpression,
  renderDebuggerLogpoint,
  snapshotDebuggerScope,
  type DebuggerScopeSnapshot,
} from './debuggerExpression';
import type { JsWorkerInboundMessage } from './js-worker-protocol';
import {
  JS_WORKER_FALLBACK_RESULT_TRUNCATION_MARKER,
  captureJsScope,
  captureLexicalScope,
  installJsWorkerConsoleProxy,
  restoreJsWorkerConsole,
  safeJsWorkerStructuredResult,
  serializeJsWorkerValues,
  truncateJsWorkerValue,
} from './js-worker-serialization';
import { buildLinguaWorkerBridge, parseJsWorkerError } from './js-worker-runtime';
import { createJsWorkerStdinReader } from './js-worker-stdin';

function evaluateWatchExpressions(
  watches: readonly string[],
  scope: DebuggerScopeSnapshot,
  marker: string
): Record<string, { value?: string; error?: string }> {
  const results: Record<string, { value?: string; error?: string }> = {};
  for (const expression of watches) {
    const result = evaluateDebuggerExpression(expression, scope);
    results[expression] = result.ok
      ? { value: serializeJsWorkerValues([result.value], marker)[0] ?? 'undefined' }
      : { error: result.error };
  }
  return results;
}

export function createJsWorkerMessageHandler(ctx: Worker) {
  let activeSession: JsWorkerDebuggerSession | null = null;

  return async (event: MessageEvent<unknown>): Promise<void> => {
    // internal — one deliberate boundary assertion; `MessageEvent.data` is
    // untyped by the DOM. Every branch below narrows by `msg.type` with no
    // further casts, and the exhaustiveness guard after the last branch
    // makes an unhandled variant a compile error.
    const msg = event.data as JsWorkerInboundMessage;

    // implementation — debugger control messages from main. These
    // arrive WHILE a run is ongoing (the worker is paused awaiting a
    // resume), so we route them ahead of the `execute` branch.
    if (msg.type === 'resume' || msg.type === 'step') {
      const session = activeSession;
      if (!session || !session.resumeResolver) return;
      if (msg.type === 'step') {
        session.stepMode = msg.mode ?? 'over';
        session.stepDepth = session.frames.length;
      } else {
        session.stepMode = 'none';
      }
      ctx.postMessage({ type: 'resumed', runId: session.runId });
      session.pausedScope = null;
      const resolver = session.resumeResolver;
      session.resumeResolver = null;
      resolver();
      return;
    }

    if (msg.type === 'set-breakpoints') {
      const session = activeSession;
      if (!session) return;
      session.breakpoints.clear();
      const bps = msg.breakpoints;
      if (Array.isArray(bps)) {
        for (const bp of bps) {
          if (typeof bp.line === 'number' && bp.line > 0) {
            session.breakpoints.set(bp.line, {
              mode:
                bp.mode === 'conditional' || bp.mode === 'logpoint' ? bp.mode : 'pause',
              condition: bp.condition ?? '',
              logMessage: bp.logMessage ?? '',
            });
          }
        }
      }
      return;
    }

    if (msg.type === 'set-watches') {
      const session = activeSession;
      if (!session) return;
      session.watches = sanitizeJsWorkerWatches(msg.watches);
      if (session.pausedScope) {
        ctx.postMessage({
          type: 'watch-results',
          runId: session.runId,
          watchResults: evaluateWatchExpressions(
            session.watches,
            session.pausedScope,
            session.resultMarker
          ),
        });
      }
      return;
    }

    if (msg.type === 'execute') {
      const exec = msg;
      const { runId, code, resultTruncationMarker } = exec;
      const marker =
        typeof resultTruncationMarker === 'string' && resultTruncationMarker.length > 0
          ? resultTruncationMarker
          : JS_WORKER_FALLBACK_RESULT_TRUNCATION_MARKER;
      const startTime = performance.now();

      installJsWorkerConsoleProxy(
        runId,
        marker,
        exec.sourceLineMap,
        exec.sourceMappingEnabled !== false
      );

      const session = createJsWorkerDebuggerSession(runId);
      applyJsWorkerExecutePayload(session, exec);
      session.resultMarker = marker;
      activeSession = session;
      let lexicalScopeVariables: ScopeVariable[] | null = null;

      // implementation — install line-by-line stdin readers. We
      // capture the previous values so a follow-up run starts from a
      // clean global scope (workers are single-shot today so this is
      // belt-and-braces, but if a future runner reuses the same
      // worker context the restoration keeps it honest).
      const stdinReader = createJsWorkerStdinReader(exec.stdin);
      const prevPrompt = (self as unknown as { prompt?: unknown }).prompt;
      const prevReadline = (self as unknown as { readline?: unknown }).readline;
      if (exec.stdin && exec.stdin.length > 0) {
        const consumer = () => stdinReader.consume();
        (self as unknown as { prompt: (message?: string) => string | null }).prompt = consumer;
        (self as unknown as { readline: () => string | null }).readline = consumer;
      }

      // implementation — per-statement wall-clock ticks. The runner's
      // transform prefixes each top-level statement with
      // `__mc_tick(<line>)`; each tick closes the PREVIOUS statement's
      // interval and opens its own, so the elapsed time between two
      // ticks is attributed to the earlier statement. `flushLineTimings`
      // closes the final open interval and posts ONE batched message —
      // called on success AND on the error path so the statements that
      // did complete keep their measurements.
      const lineTimings: Array<{ line: number; durationMs: number }> = [];
      let tickLine: number | null = null;
      let tickStart = 0;
      const __mc_tick = (line: number) => {
        const now = performance.now();
        if (tickLine !== null) {
          lineTimings.push({ line: tickLine, durationMs: now - tickStart });
        }
        tickLine = line > 0 ? line : null;
        tickStart = now;
      };
      const flushLineTimings = () => {
        __mc_tick(0);
        if (lineTimings.length > 0) {
          ctx.postMessage({ type: 'line-timing', runId, entries: lineTimings });
          lineTimings.length = 0;
        }
      };

      try {
        const executionPromise = (async () => {
          const __mc = (line: number, value: unknown) => {
            let serialized: string;
            try {
              serialized = serializeJsWorkerValues([value], marker)[0]!;
            } catch {
              serialized = truncateJsWorkerValue(String(value), marker);
            }
            ctx.postMessage({
              type: 'magic-comment',
              runId,
              line,
              value: serialized,
            });
          };

          // implementation — yield helper. Called before each
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
              (session.stepMode === 'over' && session.frames.length <= session.stepDepth) ||
              (session.stepMode === 'out' && session.frames.length < session.stepDepth);

            if (!breakpoint && !shouldPauseForStep) return;

            const localsRaw = (() => {
              try {
                return getLocals();
              } catch {
                return {};
              }
            })();
            const scope = snapshotDebuggerScope(localsRaw);

            let shouldPauseForBreakpoint = breakpoint?.mode === 'pause';
            let conditionError: string | undefined;
            if (breakpoint?.mode === 'conditional') {
              const condition = evaluateDebuggerExpression(breakpoint.condition ?? '', scope);
              if (condition.ok) {
                shouldPauseForBreakpoint = Boolean(condition.value);
              } else {
                // Fail safe: an invalid predicate must never silently skip a
                // breakpoint. Pause and explain the configuration error.
                shouldPauseForBreakpoint = true;
                conditionError = condition.error;
              }
            }
            if (breakpoint?.mode === 'logpoint') {
              const logpoint = renderDebuggerLogpoint(breakpoint.logMessage ?? '', scope);
              ctx.postMessage({
                type: 'console',
                runId,
                method: logpoint.ok ? 'log' : 'warn',
                args: [logpoint.ok ? logpoint.output : `Logpoint error: ${logpoint.error}`],
                line,
              });
            }

            if (!shouldPauseForBreakpoint && !shouldPauseForStep) return;

            const localsSerialized: Record<string, string> = {};
            for (const [name, value] of Object.entries(localsRaw)) {
              localsSerialized[name] = serializeJsWorkerValues([value], marker)[0]!;
            }

            const watchResults = evaluateWatchExpressions(session.watches, scope, marker);

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
              conditionError,
            });

            session.pausedScope = scope;
            await new Promise<void>(resolve => {
              session.resumeResolver = resolve;
            });
          };

          const __lingua_dbg_frame = (functionName: string, line: number): void => {
            session.frames.push({ functionName, line });
          };

          const __lingua_dbg_pop = (): void => {
            session.frames.pop();
          };

          const __lingua_capture_scope = (getters: Record<string, () => unknown>): void => {
            lexicalScopeVariables = captureLexicalScope(getters, exec.scopeDepth, marker);
          };

          // implementation — rich-media helpers exposed to user code as
          // the `lingua` parameter. Closure-bound (not on globalThis) so
          // there's no global pollution and the binding goes out of scope
          // when the AsyncFunction returns. Each helper validates the
          // payload via the shared whitelist. Rejects include a
          // `richMediaRejected` flag; the JS / TS / Python runners
          // forward that flag to `runtime.rich_media_payload_rejected`
          // (implementation-β-β-α implementation note).
          const lingua = buildLinguaWorkerBridge(ctx, runId);

          const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
          const fn = new AsyncFunction(
            '__mc',
            '__mc_tick',
            '__lingua_dbg_yield',
            '__lingua_dbg_frame',
            '__lingua_dbg_pop',
            '__lingua_capture_scope',
            'lingua',
            code
          );
          return await fn(
            __mc,
            __mc_tick,
            __lingua_dbg_yield,
            __lingua_dbg_frame,
            __lingua_dbg_pop,
            __lingua_capture_scope,
            lingua
          );
        })();

        const result = await executionPromise;
        // Close the last statement's interval BEFORE scope capture /
        // result serialization so their cost never pollutes it.
        flushLineTimings();

        if (result !== undefined) {
          const resultMessage: {
            type: 'result';
            runId: string;
            value: unknown;
            structured?: unknown;
          } = {
            type: 'result',
            runId,
            value: serializeJsWorkerValues([result], marker)[0],
          };
          // implementation — forward the live structured value (the
          // notebook's `{ stdout, stderr, sessionDelta }`) when asked, so
          // the runner can round-trip it losslessly instead of parsing the
          // display string that `serialize` truncates at MAX_RESULT_BYTES.
          // `safeStructuredResult` is resilient: a bare `structuredClone`
          // would drop the WHOLE delta when a cell declares a function /
          // class beside serializable data (the rewriter captures those into
          // `_sessionDelta`), so it cascades per leaf and keeps the
          // serializable siblings. `undefined` ⇒ leave it string-only.
          if (exec.captureStructuredResult === true) {
            const snapshot = safeJsWorkerStructuredResult(result);
            if (snapshot !== undefined) resultMessage.structured = snapshot;
          }
          ctx.postMessage(resultMessage);
        }

        // implementation — capture the post-execute scope BEFORE the
        // stdin-consumed / done replies so the runner can stitch the
        // snapshot onto the `ExecutionResult` it builds at `done`.
        // The capture is gated on `exec.captureScope` to keep the hot
        // path cheap when the inspector toggle is off; the runner
        // decides whether to ask. Reads `globalThis` keys, subtracts
        // the boot-time set + the known internal helpers, and walks
        // each remaining binding via the shared serializer.
        if (exec.captureScope === true) {
          try {
            const snapshot =
              lexicalScopeVariables !== null
                ? finalizeScopeSnapshot(exec.scopeLanguage ?? 'javascript', lexicalScopeVariables)
                : captureJsScope(exec.scopeLanguage ?? 'javascript', exec.scopeDepth, marker);
            ctx.postMessage({ type: 'scope-snapshot', runId, snapshot });
          } catch (captureErr) {
            // Capture failures must not break the run. Emit an empty
            // snapshot so the runner still threads the field through
            // to the result store and the panel can render the empty
            // state instead of stale data.
            ctx.postMessage({
              type: 'scope-snapshot',
              runId,
              snapshot: finalizeScopeSnapshot(exec.scopeLanguage ?? 'javascript', []),
              error: captureErr instanceof Error ? captureErr.message : String(captureErr),
            });
          }
        }

        const executionTime = performance.now() - startTime;
        // implementation note — emit consumption summary BEFORE the
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
        // Flush what we have: completed statements keep their exact
        // measurements and the failing statement reports the time it ran
        // before throwing — often the most interesting number of the run.
        flushLineTimings();
        const parsed = parseJsWorkerError(err);

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
        restoreJsWorkerConsole();
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
      return;
    }

    // internal — exhaustiveness lock: adding a new JsWorkerInboundMessage
    // variant without a branch above turns this assignment into a compile
    // error (the narrowed remainder must be `never`).
    const unhandled: never = msg;
    void unhandled;
  };
}
