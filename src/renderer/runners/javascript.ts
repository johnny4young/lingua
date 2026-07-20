import i18next from 'i18next';
import type {
  LanguageRunner,
  ExecutionContext,
  ExecutionResult,
  ConsoleOutput,
  ExecutionError,
  LineTimingEntry,
  MagicCommentResult,
  WorkerResponse,
} from '../types';
import {
  transformJSMagicComments,
  detectJSMagicComments,
  detectJSAutoLogLines,
  detectJSStatementStartLines,
  lineTimingRequestedByMagicComment,
  transformJSAutoLog,
  transformJSLineTiming,
  type MagicCommentKind,
  type MagicCommentDirective,
} from '../utils/magicComments';
import {
  forceTablePayload,
  payloadForRichMediaMagicDirective,
  tryParseJsonForPayload,
  type RichOutputPayload,
} from '../../shared/richOutput';
import { injectJSLoopProtection } from '../utils/loopProtection';
import { useSettingsStore } from '../stores/settingsStore';
import {
  resolveTimeoutMs,
  type RuntimeTimeoutPreset,
} from '../../shared/runtimeTimeoutPresets';
import { useDebuggerStore } from '../stores/debuggerStore';
import { instrumentForDebugger } from '../runtime/debuggerInstrument';
import { setActiveDebugWorker } from '../runtime/debuggerWorkerBridge';
import { trackEvent } from '../utils/telemetry';
import {
  appendScopeCapture,
  collectTopLevelScopeNames,
} from '../utils/scopeCapture';
import {
  appendCappedConsole,
  capStderrIfOverflowing,
  runnerStoppedResult,
  runnerTimeoutResult,
  type TranslateFn,
} from './limits';

// implementation — the literal `DEFAULT_TIMEOUT` is gone; the
// runner reads the per-language preset from settings every time
// `execute()` is called so a Settings change picks up on the very
// next run without restarting the worker.

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
   * internal — opaque token of the currently-running execute() call.
   * Worker replies whose `runId` does not match are dropped, so a
   * stale `done` arriving after `terminate()` cannot poison the
   * next run.
   */
  private currentRunId: string | null = null;
  private debugSessionActive = false;
  /**
   * internal — `stop()` ends an in-flight run by terminating the
   * worker. The closure that owns the resolve / cleanup pair lives
   * inside `execute()`; we expose it here so the stop button (or a
   * follow-up `execute()` call) can shut the promise down cleanly
   * instead of leaving the renderer waiting on a dead worker.
   */
  private cancelInFlight: (() => void) | null = null;

  private clearDebuggerSession(
    reasonBucket:
      | 'run-complete'
      | 'crash'
      | 'stop'
      | 'user-detach' = 'run-complete'
  ): void {
    if (!this.debugSessionActive) return;
    this.debugSessionActive = false;
    // The drawer's user-detach path clears the store session and fires
    // its own `debugger.detached` BEFORE the worker yields its final
    // message. Skip the second telemetry fire here to avoid
    // double-counting the same session end on a Stop/done that follows
    // a user-initiated detach.
    const userDetachedAlready = useDebuggerStore.getState().session === null;
    useDebuggerStore.getState().detachSession();
    setActiveDebugWorker(null);
    // implementation note — `debugger.detached` carries `language`
    // (closed enum) + `reasonBucket` (closed enum). No code, no
    // breakpoint coordinates. Honors the ADR §4 privacy contract.
    if (!userDetachedAlready) {
      void trackEvent('debugger.detached', { language: 'js', reasonBucket });
    }
  }

  async init(): Promise<void> {
    this.ready = true;
  }

  isReady(): boolean {
    return this.ready;
  }

  async execute(code: string, context?: ExecutionContext): Promise<ExecutionResult> {
    // implementation — origin capture is baseline; no runtime opt-out.
    const sourceMappingEnabled = true;
    const stdout: ConsoleOutput[] = [];
    const stderr: ConsoleOutput[] = [];
    const magicResults: MagicCommentResult[] = [];
    let lineTimings: LineTimingEntry[] = [];
    let result: unknown;
    // implementation — the worker's structured return value, forwarded
    // losslessly when the caller set `captureStructuredResult` (notebook
    // path). Stays `undefined` for normal runs.
    let structuredResult: unknown;
    let error: ExecutionError | undefined;
    // implementation note — the worker echoes its stdin
    // consumption summary as a `stdin-consumed` message; relay
    // forward via the canonical ExecutionResult shape so the UI
    // panel can surface "Used N of M lines".
    let stdinConsumed: { count: number; total: number } | undefined;
    // implementation — scope snapshot relay; worker emits at most
    // one `scope-snapshot` reply per run, and only when we asked.
    let scopeSnapshot: ExecutionResult['scopeSnapshot'] = null;
    // Independent caps per stream — stdout overflowing should not
    // mute the truncation notice on stderr (and vice versa).
    let droppedStdout = 0;
    let droppedStderr = 0;
    let stderrByteTruncated = false;

    // internal debugger refinement — debug mode is now an explicit UI
    // intent. Normal Run ignores breakpoints so gutter marks do not
    // silently change execution semantics; Debug instruments the source
    // and auto-disables loop protection only when an enabled breakpoint
    // exists in the active tab.
    const settings = useSettingsStore.getState();
    // implementation — resolve the run-time deadline from the
    // per-language preset whenever the caller did NOT pass an
    // explicit timeout. Caller overrides (one-shot extended,
    // magic-comment `// @timeout`) keep the original number and
    // the pill tooltip drops the preset name via the `'override'`
    // sentinel.
    const callerOverrode = typeof context?.timeout === 'number';
    const presetForLanguage: RuntimeTimeoutPreset | undefined =
      settings.runtimeTimeoutPresetByLanguage?.['javascript'];
    const timeout = callerOverrode
      ? (context!.timeout as number)
      : resolveTimeoutMs('javascript', presetForLanguage);
    const timeoutPreset: RuntimeTimeoutPreset | 'override' = callerOverrode
      ? 'override'
      : presetForLanguage ?? 'normal';
    // implementation — debugger is baseline; the Settings master toggle is gone.
    const debuggerSettings = true;
    const debugStore = useDebuggerStore.getState();
    const tabBreakpoints = context?.tabId
      ? debugStore.breakpointsForTab(context.tabId).filter((bp) => bp.enabled)
      : [];
    const debug = context?.debug === true && debuggerSettings && tabBreakpoints.length > 0;

    // implementation — loop protection is baseline (the runtime kill switch
    // against `while(true)` cannot be user-tunable on a code editor).
    const { maxLoopIterations } = settings;
    const protectedCode = !debug
      ? injectJSLoopProtection(code, maxLoopIterations)
      : code;

    // Transform magic comments before execution
    const magicEntries = detectJSMagicComments(protectedCode);
    const hasMagic = magicEntries.length > 0;
    const magicTransformed = hasMagic ? transformJSMagicComments(protectedCode) : protectedCode;
    // implementation — side-table the worker reads is per-line. The
    // worker postMessage protocol stays kind-agnostic.
    const magicKindByLine: Record<number, MagicCommentKind> = {};
    // implementation — parallel side-table for `//=> table`
    // directives. The runner consults this when stitching back the
    // magic-comment result so it can upgrade the stringified value
    // to a typed `RichOutputPayload` before the renderer reads it.
    const magicDirectiveByLine: Record<number, MagicCommentDirective> = {};
    for (const entry of magicEntries) {
      magicKindByLine[entry.line] = entry.kind;
      if (entry.directive) {
        magicDirectiveByLine[entry.line] = entry.directive;
      }
    }
    // implementation — opt-in auto-log pass after the magic-comment
    // transform. The detector excludes lines already claimed by an
    // arrow / watch (magic-comment precedence is preserved), and the
    // transform replaces each bare expression with a single
    // `__mc(line, value)` capture so side effects do not run twice.
    // Debug runs deliberately
    // SKIP the auto-log transform — pause / step semantics already
    // produce a richer view of the program state, and silent
    // injections under a paused frame would surprise the user.
    let codeWithAutoLog = magicTransformed;
    if (context?.autoLog === true && !debug) {
      const magicLines = new Set<number>(magicEntries.map((entry) => entry.line));
      const autoLogLines = detectJSAutoLogLines(protectedCode, magicLines);
      if (autoLogLines.length > 0) {
        codeWithAutoLog = transformJSAutoLog(magicTransformed, autoLogLines);
        for (const line of autoLogLines) {
          if (!(line in magicKindByLine)) {
            magicKindByLine[line] = 'autoLog';
          }
        }
      }
    }

    // implementation — per-statement timing markers, AFTER auto-log
    // (the transformed capture lines are still single top-level
    // statements) and BEFORE scope capture so the appended capture code
    // is never attributed to a user statement. Enabled by the Settings
    // toggle (context.lineTiming) OR a `// @time` directive in the
    // buffer; debug runs never instrument — pause/step already owns
    // that view.
    let codeWithTiming = codeWithAutoLog;
    if (
      !debug &&
      (context?.lineTiming === true ||
        lineTimingRequestedByMagicComment(this.language, protectedCode))
    ) {
      const statementLines = detectJSStatementStartLines(codeWithAutoLog);
      if (statementLines.length > 0) {
        codeWithTiming = transformJSLineTiming(codeWithAutoLog, statementLines);
      }
    }

    let codeWithScopeCapture = codeWithTiming;
    if (context?.captureScope === true && !debug) {
      codeWithScopeCapture = appendScopeCapture(
        codeWithTiming,
        collectTopLevelScopeNames(codeWithTiming)
      );
    }

    let transformedCode = codeWithScopeCapture;
    let sourceLineMap: Record<number, number> | undefined;
    if (debug) {
      try {
        const instrumented = instrumentForDebugger(codeWithAutoLog, {
          filename: context?.tabId ?? 'user-code.js',
        });
        transformedCode = instrumented.code;
        sourceLineMap = instrumented.sourceLineMap;
      } catch {
        // Instrumentation failure should NOT block a run — fall back
        // to executing the un-instrumented source so the user still
        // sees runtime errors instead of an opaque "instrumentation
        // failed" screen.
        transformedCode = codeWithAutoLog;
      }
    }

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
          // implementation — same cleanup as the crash path so an F5/F10
          // after a timeout does not post to a dead worker.
          this.clearDebuggerSession('stop');
          finish(
            runnerTimeoutResult(timeout, t, { stdout, stderr }, timeoutPreset)
          );
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
        // internal — runId guard. Drop stale messages from terminated workers.
        if (!('runId' in msg) || msg.runId !== runId) return;
        if (this.currentRunId !== runId) return;

        switch (msg.type) {
          case 'console': {
            // implementation — thread the additive `payload` from the
            // worker through to `ConsoleOutput`. Absent when the
            // (legacy) protocol omits the field, so the renderer text
            // path keeps working unchanged.
            const output: ConsoleOutput = msg.payload
              ? { type: msg.method, args: msg.args, line: msg.line, payload: msg.payload }
              : { type: msg.method, args: msg.args, line: msg.line };
            // implementation note — `console.table` adoption signal.
            // Fire-and-forget; the renderer never blocks on telemetry.
            if (msg.consoleTableInvoked === true) {
              void trackEvent('runtime.console_table_called', {
                language: 'javascript',
              });
            }
            // implementation-β-β-α implementation note — runner-side forwarding of
            // `lingua.{chart,image,html}` rejection flags emitted by
            // `buildLinguaWorkerBridge` (js-worker.ts:380). Closes the
            // hook explicitly deferred in implementation (see js-worker.ts
            // implementation comment).
            if (msg.richMediaRejected) {
              const { kind, reason } = msg.richMediaRejected;
              void trackEvent('runtime.rich_media_payload_rejected', {
                kind,
                reason,
              });
            }
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
            context?.onConsole?.(output);
            break;
          }
          case 'stdin-consumed': {
            // implementation note — defensively coerce to a
            // bounded shape; the worker is trusted but the panel
            // only renders integer counts.
            const summary = msg as unknown as {
              count: unknown;
              total: unknown;
            };
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
            // implementation — relay the worker's scope capture onto
            // the eventual ExecutionResult. The worker already
            // applied the boot-time filter + internal-symbol filter
            // and bounded the payload; this side just defensively
            // checks the shape so a malformed reply doesn't crash
            // the panel.
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
            // implementation — the kind table now carries `'arrow'`,
            // `'watch'`, or `'autoLog'`. The worker postMessage
            // protocol stays kind-agnostic; the runner stitches the
            // kind back in via this side table.
            const directive = magicDirectiveByLine[msg.line];
            // implementation — when the user attached a `table`
            // directive, attempt to recover structure from the
            // worker's stringified value via JSON. The serializer in
            // the worker uses `JSON.stringify` so JSON-compatible
            // values round-trip faithfully; lossy values still keep
            // `value` as the canonical text fallback.
            let payload: RichOutputPayload | undefined;
            if (directive === 'table') {
              const parsed = tryParseJsonForPayload(msg.value);
              if (parsed.ok) {
                payload = forceTablePayload(parsed.value);
              }
            } else if (
              directive === 'chart' ||
              directive === 'image' ||
              directive === 'html'
            ) {
              payload = payloadForRichMediaMagicDirective(directive, msg.value);
            }
            const entry: MagicCommentResult = {
              line: msg.line,
              value: msg.value,
              kind: magicKindByLine[msg.line] ?? 'arrow',
            };
            if (payload) entry.payload = payload;
            magicResults.push(entry);
            break;
          }
          case 'line-timing':
            // internal — batched per-statement timings, one message per
            // run, posted right before done.
            lineTimings = msg.entries;
            break;
          case 'result':
            result = msg.value;
            // implementation — capture the structured value when the
            // worker forwarded it (only when we asked via
            // `captureStructuredResult`).
            if (msg.structured !== undefined) structuredResult = msg.structured;
            break;
          case 'error':
            error = msg.error;
            break;
          case 'paused': {
            // implementation — relay paused frames into the debugger
            // store so the UI can render the variables / call stack.
            const paused = msg as unknown as {
              line: number;
              reason: 'user-breakpoint' | 'step';
              locals: Record<string, string>;
              callStack: { functionName: string; line: number }[];
              watchResults: Record<string, { value?: string; error?: string; pending?: boolean }>;
              conditionalPending?: boolean;
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
              // implementation — `debugger.paused` carries the
              // closed-enum reason bucket. No source, no expression
              // content, no line numbers in the payload.
              void trackEvent('debugger.paused', {
                language: 'js',
                reasonBucket: paused.reason,
              });
            }
            // A paused debugger is expected to wait indefinitely for
            // user input. Keep the runaway-code deadline for active
            // execution, but suspend it while Continue/Step is pending.
            clearDeadline();
            // implementation — `conditionalPending` is dropped here;
            // when conditional-bp evaluation lands, thread the flag
            // into PausedFrame so the drawer can flag "predicate
            // stored, evaluation pending".
            void paused.conditionalPending;
            break;
          }
          case 'resumed':
            armDeadline();
            break;
          case 'done':
            finish({
              stdout,
              stderr,
              result,
              // implementation — surface the lossless structured value
              // when the worker forwarded it; `undefined` for normal runs.
              structuredResult,
              executionTime: msg.executionTime,
              error,
              magicResults: magicResults.length > 0 ? magicResults : undefined,
              // internal — per-statement wall-clock timings when the
              // run was instrumented (setting or // @time directive).
              ...(lineTimings.length > 0 ? { lineTimings } : {}),
              stdinConsumed,
              // implementation — explicit kind so the result-panel
              // pill self-gates on a field instead of regexing the
              // error message. `'success'` when there is no thrown
              // error; `'error'` otherwise (timeout / stop paths
              // never reach this branch because they finish() via
              // `runnerTimeoutResult` / `runnerStoppedResult`).
              kind: error ? 'error' : 'success',
              timeoutPreset,
              timeoutMs: timeout,
              // implementation — surface the worker capture if it
              // ran; `null` keeps the contract simple for runners
              // that didn't capture this round.
              scopeSnapshot,
            });
            // Detach the debugger session — the run is over.
            this.clearDebuggerSession('run-complete');
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
          // implementation — worker crashes count as `'error'` in
          // the pill so the user sees the "Run failed" variant
          // instead of a silent state.
          kind: 'error',
          timeoutPreset,
          timeoutMs: timeout,
        });
        // implementation — clear the debugger bridge + session on
        // crash so a follow-up F5/F10 doesn't post to a dead worker.
        this.clearDebuggerSession('crash');
        worker.terminate();
        if (this.worker === worker) this.worker = null;
      });

      // internal — parent-owned kill timer. If user code never yields,
      // the in-worker handlers above never fire; this timer is the
      // only thing that can recover the UI. Debug pauses clear and
      // re-arm this deadline around user-controlled stepping.
      armDeadline();

      if (debug && context?.tabId) {
        this.debugSessionActive = true;
        useDebuggerStore.getState().attachSession({
          runtime: 'js',
          tabId: context.tabId,
          attachedAt: Date.now(),
        });
        setActiveDebugWorker(worker);
        // implementation — `debugger.attached` fires once per debug
        // session so dashboard can derive median session length and
        // attach→pause latency. ADR §4 payload contract.
        void trackEvent('debugger.attached', { language: 'js', reasonBucket: 'attach' });
      }
      // Send execution request after registering the debug bridge so a
      // pause on the first instrumented statement is resumable.
      worker.postMessage({
        type: 'execute',
        runId,
        code: transformedCode,
        timeout,
        resultTruncationMarker: t('runner.truncated.result'),
        debug,
        breakpoints: tabBreakpoints.map((bp) => ({ line: bp.line, condition: bp.condition })),
        watches: debug ? debugStore.watches.map((w) => w.expression) : [],
        sourceLineMap,
        sourceMappingEnabled,
        // implementation — pre-set stdin buffer the worker installs
        // as the source of `prompt()` / `readline()` answers. Empty
        // / undefined leaves the native worker behavior in place.
        stdin: context?.stdin,
        // implementation — variable inspector capture. Debug runs
        // skip capture; the debugger drawer already exposes the
        // paused-frame locals and a second snapshot would race with
        // the resume protocol.
        captureScope: !debug && context?.captureScope === true,
        scopeDepth: context?.scopeDepth,
        scopeLanguage: 'javascript',
        // implementation — ask the worker to forward the structured
        // return value (notebook reads it from `structuredResult`).
        captureStructuredResult: context?.captureStructuredResult === true,
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
    // Resolve any in-flight execute() promise so the renderer is
    // not left waiting on a worker we just killed.
    if (this.cancelInFlight) {
      const cancel = this.cancelInFlight;
      this.cancelInFlight = null;
      cancel();
    }
  }
}
