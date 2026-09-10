/**
 * The worker-runner shell shared by the JavaScript and TypeScript runners.
 *
 * Both languages execute in the same `js-worker` — TypeScript transpiles
 * through esbuild first — and both used to carry their own copy of everything
 * that happens after the transform: booting the worker, arming the parent kill
 * timer, the eleven-case message pump, the capped console accumulators, the
 * result assembly, and `stop()`. With comments stripped, those two copies of
 * the pump differed in ten lines out of roughly two hundred.
 *
 * What stays with each runner is its transform pipeline, which genuinely
 * differs: JavaScript instruments source directly, TypeScript transpiles and
 * composes source maps first. Everything downstream of that is here.
 *
 * The shell owns the worker lifecycle state rather than reaching back into the
 * runner, so a runner holds one of these and delegates. That keeps the
 * `runId` guard, the debugger session flag and the in-flight cancel closure in
 * a single place; they are the three pieces that made the duplicated version
 * hard to reason about, because a stale reply, a crash and a stop all had to
 * agree about them.
 */

import i18next from 'i18next';
import type {
  ConsoleOutput,
  ExecutionContext,
  ExecutionError,
  ExecutionResult,
  LineTimingEntry,
  MagicCommentResult,
  WorkerResponse,
} from '../types/execution';
import type { MagicCommentDirective, MagicCommentKind } from '../utils/magicComments';
import {
  forceTablePayload,
  payloadForRichMediaMagicDirective,
  tryParseJsonForPayload,
  type RichOutputPayload,
} from '../../shared/richOutput';
import { useDebuggerStore, type BreakpointMode } from '../stores/debuggerStore';
import { setActiveDebugWorker } from '../runtime/debuggerWorkerBridge';
import { trackEvent } from '../utils/telemetry';
import type { RuntimeTimeoutPreset } from '../../shared/runtimeTimeoutPresets';
import {
  appendCappedConsole,
  capStderrIfOverflowing,
  runnerStoppedResult,
  runnerTimeoutResult,
  type TranslateFn,
} from './limits';

const t: TranslateFn = (key, options) => i18next.t(key, options ?? {}) as string;

/** Why a debugger session ended, as a closed telemetry bucket. */
export type DebuggerDetachReason = 'run-complete' | 'crash' | 'stop' | 'user-detach';

/**
 * The subset of a stored breakpoint the worker protocol carries. Structural
 * rather than an import of the store's `Breakpoint`, which is not exported and
 * also holds renderer-only fields (`tabId`, `enabled`) the worker never sees.
 */
interface WorkerBreakpoint {
  line: number;
  mode: BreakpointMode;
  condition: string;
  logMessage: string;
}

/**
 * Everything a runner hands over once its transform pipeline is done.
 *
 * `code` is post-transform for JavaScript and post-transpile for TypeScript;
 * the shell does not care which, it only posts it.
 */
export interface WorkerRunSpec {
  code: string;
  /**
   * Stamped on the scope snapshot and on console-table telemetry. The
   * debugger telemetry deliberately stays `'js'` for both, because the
   * runtime adapter really is the JS worker.
   */
  language: 'javascript' | 'typescript';
  timeout: number;
  timeoutPreset: RuntimeTimeoutPreset | 'override';
  debug: boolean;
  breakpoints: ReadonlyArray<WorkerBreakpoint>;
  watches: string[];
  sourceLineMap: Record<number, number> | undefined;
  sourceMappingEnabled: boolean;
  /** Per-line side tables the worker protocol cannot carry. */
  magicKindByLine: Record<number, MagicCommentKind>;
  magicDirectiveByLine: Record<number, MagicCommentDirective>;
  /**
   * Notebook-only, and JavaScript-only in practice: notebook cells transpile
   * TypeScript themselves and run through the JavaScript runner, so the
   * TypeScript runner never asks for this.
   */
  captureStructuredResult: boolean;
  context: ExecutionContext | undefined;
}

export class WorkerRunnerShell {
  private worker: Worker | null = null;

  /**
   * Opaque token of the currently-running `run()` call. Worker replies whose
   * `runId` does not match are dropped, so a stale `done` arriving after
   * `terminate()` cannot poison the next run.
   */
  private currentRunId: string | null = null;

  private debugSessionActive = false;

  /**
   * `stop()` ends an in-flight run by terminating the worker. The closure
   * that owns the resolve / cleanup pair lives inside `run()`; it is exposed
   * here so the stop button (or a follow-up run) can shut the promise down
   * cleanly instead of leaving the renderer waiting on a dead worker.
   */
  private cancelInFlight: (() => void) | null = null;

  clearDebuggerSession(reasonBucket: DebuggerDetachReason = 'run-complete'): void {
    if (!this.debugSessionActive) return;
    this.debugSessionActive = false;
    // The drawer's user-detach path clears the store session and fires its own
    // `debugger.detached` BEFORE the worker yields its final message. Skip the
    // second telemetry fire here to avoid double-counting the same session end
    // on a Stop/done that follows a user-initiated detach.
    const userDetachedAlready = useDebuggerStore.getState().session === null;
    useDebuggerStore.getState().detachSession();
    setActiveDebugWorker(null);
    // `debugger.detached` carries `language` (closed enum) + `reasonBucket`
    // (closed enum). No code, no breakpoint coordinates.
    if (!userDetachedAlready) {
      void trackEvent('debugger.detached', { language: 'js', reasonBucket });
    }
  }

  run(spec: WorkerRunSpec): Promise<ExecutionResult> {
    const {
      code,
      language,
      timeout,
      timeoutPreset,
      debug,
      breakpoints,
      watches,
      sourceLineMap,
      sourceMappingEnabled,
      magicKindByLine,
      magicDirectiveByLine,
      captureStructuredResult,
      context,
    } = spec;

    const stdout: ConsoleOutput[] = [];
    const stderr: ConsoleOutput[] = [];
    const magicResults: MagicCommentResult[] = [];
    let lineTimings: LineTimingEntry[] = [];
    let result: unknown;
    /** The worker's structured return value, forwarded losslessly when asked. */
    let structuredResult: unknown;
    let error: ExecutionError | undefined;
    let stdinConsumed: { count: number; total: number } | undefined;
    let scopeSnapshot: ExecutionResult['scopeSnapshot'] = null;
    // Independent caps per stream — stdout overflowing should not mute the
    // truncation notice on stderr (and vice versa).
    let droppedStdout = 0;
    let droppedStderr = 0;
    let stderrByteTruncated = false;

    // Terminate any previous worker. `stop()` also drops `currentRunId` so any
    // in-flight messages from the old worker are ignored.
    this.stop();

    const runId = crypto.randomUUID();
    this.currentRunId = runId;

    return new Promise<ExecutionResult>(resolve => {
      // A new worker per execution, for clean state.
      this.worker = new Worker(new URL('../workers/js-worker.ts', import.meta.url), {
        type: 'module',
      });
      const worker = this.worker;
      let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
      let resolved = false;

      const clearDeadline = () => {
        if (timeoutHandle !== null) {
          clearTimeout(timeoutHandle);
          timeoutHandle = null;
        }
      };

      const armDeadline = () => {
        clearDeadline();
        timeoutHandle = setTimeout(() => {
          worker.terminate();
          if (this.worker === worker) this.worker = null;
          // Same cleanup as the crash path, so an F5/F10 after a timeout does
          // not post to a dead worker.
          this.clearDebuggerSession('stop');
          finish(runnerTimeoutResult(timeout, t, { stdout, stderr }, timeoutPreset));
        }, timeout);
      };

      const finish = (value: ExecutionResult) => {
        if (resolved) return;
        resolved = true;
        clearDeadline();
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
        // runId guard. Drop stale messages from terminated workers.
        if (!('runId' in msg) || msg.runId !== runId) return;
        if (this.currentRunId !== runId) return;

        switch (msg.type) {
          case 'console': {
            // Thread the additive `payload` through to `ConsoleOutput`. Absent
            // when the legacy protocol omits the field, so the renderer text
            // path keeps working unchanged.
            const output: ConsoleOutput = msg.payload
              ? { type: msg.method, args: msg.args, line: msg.line, payload: msg.payload }
              : { type: msg.method, args: msg.args, line: msg.line };
            // `console.table` adoption signal. Fire-and-forget; the renderer
            // never blocks on telemetry.
            if (msg.consoleTableInvoked === true) {
              void trackEvent('runtime.console_table_called', { language });
            }
            // Runner-side forwarding of `lingua.{chart,image,html}` rejection
            // flags emitted by `buildLinguaWorkerBridge`.
            if (msg.richMediaRejected) {
              const { kind, reason } = msg.richMediaRejected;
              void trackEvent('runtime.rich_media_payload_rejected', { kind, reason });
            }
            if (msg.method === 'error') {
              if (!stderrByteTruncated) {
                droppedStderr = appendCappedConsole(stderr, output, droppedStderr, t);
                stderrByteTruncated = capStderrIfOverflowing(stderr, t);
              }
            } else {
              droppedStdout = appendCappedConsole(stdout, output, droppedStdout, t);
            }
            context?.onConsole?.(output);
            break;
          }
          case 'stdin-consumed': {
            // Defensively coerce to a bounded shape; the worker is trusted but
            // the panel only renders integer counts.
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
          case 'scope-snapshot': {
            // Relay the worker's scope capture onto the eventual
            // ExecutionResult. The worker already applied the boot-time and
            // internal-symbol filters and bounded the payload; this side just
            // checks the shape so a malformed reply cannot crash the panel.
            const incoming = msg as unknown as {
              snapshot?: { language?: unknown; variables?: unknown };
            };
            if (
              incoming.snapshot &&
              typeof (incoming.snapshot as { language?: unknown }).language === 'string' &&
              Array.isArray((incoming.snapshot as { variables?: unknown }).variables)
            ) {
              scopeSnapshot = incoming.snapshot as ExecutionResult['scopeSnapshot'];
            }
            break;
          }
          case 'magic-comment': {
            // The worker protocol is kind-agnostic; the kind is stitched back
            // in from the side table. When the user attached a `table`
            // directive, recover structure from the stringified value via
            // JSON — the worker serializes with `JSON.stringify`, so
            // JSON-compatible values round-trip and lossy ones still keep
            // `value` as the canonical text fallback.
            const directive = magicDirectiveByLine[msg.line];
            let payload: RichOutputPayload | undefined;
            if (directive === 'table') {
              const parsed = tryParseJsonForPayload(msg.value);
              if (parsed.ok) {
                payload = forceTablePayload(parsed.value);
              }
            } else if (directive === 'chart' || directive === 'image' || directive === 'html') {
              payload = payloadForRichMediaMagicDirective(directive, msg.value);
            }
            const entry: MagicCommentResult = {
              line: msg.line,
              value: msg.value,
              kind: magicKindByLine[msg.line] ?? 'arrow',
              ...(msg.isError === true ? { isError: true } : {}),
            };
            if (payload) entry.payload = payload;
            magicResults.push(entry);
            break;
          }
          case 'line-timing':
            // Batched per-statement timings, one message per run, posted right
            // before done.
            lineTimings = msg.entries;
            break;
          case 'result':
            result = msg.value;
            // The structured value only arrives when we asked for it via
            // `captureStructuredResult`.
            if (msg.structured !== undefined) structuredResult = msg.structured;
            break;
          case 'error':
            error = msg.error;
            break;
          case 'paused': {
            // Relay paused frames into the debugger store so the UI can render
            // the variables / call stack.
            const paused = msg as unknown as {
              line: number;
              reason: 'user-breakpoint' | 'step';
              locals: Record<string, string>;
              callStack: { functionName: string; line: number }[];
              watchResults: Record<string, { value?: string; error?: string; pending?: boolean }>;
              conditionError?: string;
            };
            if (context?.tabId) {
              useDebuggerStore.getState().setPausedFrame({
                tabId: context.tabId,
                line: paused.line,
                reason: paused.reason,
                locals: paused.locals,
                callStack: paused.callStack,
                watchResults: paused.watchResults,
                conditionError: paused.conditionError,
              });
              // `debugger.paused` carries the closed-enum reason bucket. No
              // source, no expression content, no line numbers.
              void trackEvent('debugger.paused', {
                language: 'js',
                reasonBucket: paused.reason,
              });
            }
            // A paused debugger is expected to wait indefinitely for user
            // input. Keep the runaway-code deadline for active execution, but
            // suspend it while Continue/Step is pending.
            clearDeadline();
            break;
          }
          case 'watch-results':
            useDebuggerStore.getState().updateWatchResults(msg.watchResults);
            break;
          case 'resumed':
            armDeadline();
            break;
          case 'done':
            finish({
              stdout,
              stderr,
              result,
              // Lossless structured value when the worker forwarded it;
              // `undefined` for normal runs.
              structuredResult,
              executionTime: msg.executionTime,
              error,
              magicResults: magicResults.length > 0 ? magicResults : undefined,
              // Per-statement wall-clock timings when the run was instrumented
              // (setting or `// @time` directive).
              ...(lineTimings.length > 0 ? { lineTimings } : {}),
              stdinConsumed,
              // Explicit kind so the result-panel pill self-gates on a field
              // instead of regexing the error message. Timeout and stop paths
              // never reach this branch — they finish() via
              // `runnerTimeoutResult` / `runnerStoppedResult`.
              kind: error ? 'error' : 'success',
              timeoutPreset,
              timeoutMs: timeout,
              scopeSnapshot,
            });
            // Detach the debugger session — the run is over.
            this.clearDebuggerSession('run-complete');
            // The worker is single-shot; terminate so we do not leak.
            worker.terminate();
            if (this.worker === worker) this.worker = null;
            break;
        }
      });

      worker.addEventListener('error', event => {
        // The same staleness guard the message listener carries. A worker
        // terminated when a newer run began can still flush a queued error,
        // and while its own `finish` is already a no-op, the debugger cleanup
        // below is shell-wide: without this it would detach the session and
        // clear the active worker bridge belonging to the run that replaced
        // it. Terminating an already-dead worker is harmless, so that is all
        // a stale error gets.
        if (this.currentRunId !== runId) {
          worker.terminate();
          return;
        }
        finish({
          stdout,
          stderr,
          result: undefined,
          executionTime: 0,
          error: { message: event.message || 'Worker error' },
          // Worker crashes count as `'error'` in the pill so the user sees the
          // "Run failed" variant instead of a silent state.
          kind: 'error',
          timeoutPreset,
          timeoutMs: timeout,
        });
        // Clear the debugger bridge + session on crash so a follow-up F5/F10
        // does not post to a dead worker.
        this.clearDebuggerSession('crash');
        worker.terminate();
        if (this.worker === worker) this.worker = null;
      });

      // Parent-owned kill timer. If user code never yields, the in-worker
      // handlers above never fire; this timer is the only thing that can
      // recover the UI. Debug pauses clear and re-arm it around user-controlled
      // stepping.
      armDeadline();

      if (debug && context?.tabId) {
        this.debugSessionActive = true;
        useDebuggerStore.getState().attachSession({
          runtime: 'js',
          tabId: context.tabId,
          attachedAt: Date.now(),
        });
        setActiveDebugWorker(worker);
        // `language: 'js'` is correct for both runners: the runtime adapter is
        // the JS worker either way.
        void trackEvent('debugger.attached', { language: 'js', reasonBucket: 'attach' });
      }

      // Send the execution request AFTER registering the debug bridge, so a
      // pause on the first instrumented statement is resumable.
      worker.postMessage({
        type: 'execute',
        runId,
        code,
        timeout,
        resultTruncationMarker: t('runner.truncated.result'),
        debug,
        breakpoints: breakpoints.map(bp => ({
          line: bp.line,
          mode: bp.mode,
          condition: bp.condition,
          logMessage: bp.logMessage,
        })),
        watches,
        sourceLineMap,
        sourceMappingEnabled,
        // Pre-set stdin buffer the worker installs as the source of `prompt()`
        // / `readline()` answers. Empty or undefined leaves the native worker
        // behavior in place.
        stdin: context?.stdin,
        // Variable inspector capture. Debug runs skip it; the debugger drawer
        // already exposes the paused-frame locals and a second snapshot would
        // race with the resume protocol.
        captureScope: !debug && context?.captureScope === true,
        scopeDepth: context?.scopeDepth,
        scopeLanguage: language,
        captureStructuredResult,
      });
    });
  }

  stop(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    this.currentRunId = null;
    this.clearDebuggerSession('stop');
    // Resolve any in-flight run() promise so the renderer is not left waiting
    // on a worker we just killed.
    if (this.cancelInFlight) {
      const cancel = this.cancelInFlight;
      this.cancelInFlight = null;
      cancel();
    }
  }
}
