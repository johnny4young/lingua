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
  type MagicCommentDirective,
} from '../utils/magicComments';
import { injectPythonLoopProtectionWithLineMap } from '../utils/loopProtection';
import { useSettingsStore } from '../stores/settingsStore';
import { trackEvent } from '../utils/telemetry';
import {
  forceTablePayload,
  payloadForRichMediaMagicDirective,
  tryParseJsonForPayload,
  type RichOutputPayload,
} from '../../shared/richOutput';
import { richKindBucket } from '../components/Console/richConsoleFormat';
import {
  resolveTimeoutMs,
  type RuntimeTimeoutPreset,
} from '../../shared/runtimeTimeoutPresets';
import { resolveUserEnvForRunner } from './env';
import {
  appendCappedConsole,
  capStderrIfOverflowing,
  runnerStoppedResult,
  runnerTimeoutResult,
  type TranslateFn,
} from './limits';

// RL-020 Slice 7 — the literal run-time DEFAULT_TIMEOUT is gone;
// the runner resolves the deadline from the per-language Settings
// preset (`long` by default for Python = 120 s) on every call. The
// PYODIDE_LOAD_TIMEOUT below is independent — it bounds the
// one-off bootstrap of the Pyodide runtime, not the per-run
// execution window.
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
    // RL-020 Slice 7 — resolve the per-run deadline from the
    // language preset unless the caller passed an explicit override.
    // The Pyodide bootstrap deadline is independent (see
    // PYODIDE_LOAD_TIMEOUT above) — only the post-bootstrap run is
    // bounded by this value.
    const settingsSnapshot = useSettingsStore.getState();
    const callerOverrode = typeof context?.timeout === 'number';
    const presetForLanguage: RuntimeTimeoutPreset | undefined =
      settingsSnapshot.runtimeTimeoutPresetByLanguage?.['python'];
    const timeout = callerOverrode
      ? (context!.timeout as number)
      : resolveTimeoutMs('python', presetForLanguage);
    const timeoutPreset: RuntimeTimeoutPreset | 'override' = callerOverrode
      ? 'override'
      : presetForLanguage ?? 'long';
    const stdout: ConsoleOutput[] = [];
    const stderr: ConsoleOutput[] = [];
    const magicResults: MagicCommentResult[] = [];
    let result: unknown;
    let error: ExecutionError | undefined;
    // RL-020 Slice 6 fold G — Pyodide worker's stdin consumption
    // summary; mirror of the JS runner shape.
    let stdinConsumed: { count: number; total: number } | undefined;
    // RL-020 Slice 9 — scope snapshot relay (same shape as JS/TS).
    let scopeSnapshot: ExecutionResult['scopeSnapshot'] = null;
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
        // RL-020 Slice 7 — bootstrap failures count as `'error'`.
        kind: 'error',
      };
    }

    // Apply loop protection if enabled
    const { loopProtection, maxLoopIterations } = useSettingsStore.getState();
    const loopProtected = loopProtection
      ? injectPythonLoopProtectionWithLineMap(code, maxLoopIterations)
      : { code, sourceLineMap: {} };
    const processedCode = loopProtected.code;
    const sourceLineFor = (line: number | undefined) =>
      typeof line === 'number'
        ? (loopProtected.sourceLineMap[line] ?? line)
        : undefined;

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
    // RL-044 Slice 1C fold D — parallel side-table for the `#=> table`
    // directive so the runner knows when to upgrade the worker's
    // `value` text into a typed `RichOutputTable` payload. JS / TS use
    // a sibling pattern in their respective runners.
    const magicDirectiveByLine: Record<number, MagicCommentDirective> = {};
    for (const entry of magicEntries) {
      magicKindByLine[entry.line] = entry.kind;
      if (entry.directive) {
        magicDirectiveByLine[entry.line] = entry.directive;
      }
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
            // RL-044 Slice 1C — forward the additive payload from the
            // Pyodide worker. Absent on text-only fallback paths
            // (sys.stdout.write bypasses the print override, fold E
            // disabled mode), so the renderer's text path stays the
            // canonical fallback.
            const originalLine = sourceLineFor(msg.line);
            const output: ConsoleOutput = msg.payload
              ? { type: msg.method, args: msg.args, line: originalLine, payload: msg.payload }
              : { type: msg.method, args: msg.args, line: originalLine };
            // RL-044 Slice 1C fold B — adoption signal per produced
            // payload kind. Intentionally fires once per payload
            // ELEMENT, not once per console entry: a multi-arg
            // `print(a, b, c)` ships three aligned payloads (fold C)
            // and emits three events. This gives the dashboard the
            // per-kind distribution directly without needing a JOIN
            // against the renderer-side `runtime.console_rich_rendered`
            // (which uses a WeakSet de-dup and counts entries, not
            // payloads). Dashboards correlating both events should
            // expect an N:1 skew for multi-arg prints by design.
            if (msg.payload) {
              for (const payload of msg.payload) {
                void trackEvent('runtime.python_console_payload_emitted', {
                  kind: richKindBucket(payload),
                });
                // RL-044 Slice 2b-β-β-α fold E — security-relevant
                // adoption signal: count `__lingua.chart/image/html`
                // acceptances separately from the generic Python
                // payload stream so the security dashboard can split
                // user-emitted rich media from automatic table /
                // object payloads emitted by the print override.
                if (
                  payload.kind === 'chart' ||
                  payload.kind === 'image' ||
                  payload.kind === 'html'
                ) {
                  void trackEvent('runtime.python_rich_media_used', {
                    kind: payload.kind,
                  });
                }
              }
            }
            // RL-044 Slice 2b-β-β-α fold A — runner-side forwarding of
            // the Python worker's rich-media rejection flag. Closes
            // the runner-side telemetry hook that was deferred since
            // Slice 2a (see `buildLinguaWorkerBridge` in js-worker.ts
            // and `buildPythonRichMediaBridge` in python-worker.ts).
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
            break;
          }
          case 'magic-comment': {
            // RL-044 Slice 1C fold D — `#=> table` directive: the
            // worker either ships a forced-table payload alongside the
            // text value (preferred), or we recover one client-side by
            // round-tripping the `value` string through
            // `tryParseJsonForPayload` + `forceTablePayload`. Mirrors
            // the JS / TS runner pattern from Slice 1A.
            //
            // RL-044 Slice 2b-β-β-α — widened to `chart` / `image` /
            // `html` via the shared `payloadForRichMediaMagicDirective`
            // helper. JS / TS / Python now share the same client-side
            // recovery path so cross-language rich-media payloads
            // produce identical shapes.
            const directive = magicDirectiveByLine[msg.line];
            let payload: RichOutputPayload | undefined;
            if (msg.payload) {
              payload = msg.payload;
            } else if (directive === 'table') {
              const parsed = tryParseJsonForPayload(msg.value);
              if (parsed.ok) payload = forceTablePayload(parsed.value);
            } else if (
              directive === 'chart' ||
              directive === 'image' ||
              directive === 'html'
            ) {
              payload = payloadForRichMediaMagicDirective(directive, msg.value);
            }
            const entry: MagicCommentResult = {
              line: sourceLineFor(msg.line) ?? msg.line,
              value: msg.value,
              kind: magicKindByLine[msg.line] ?? 'arrow',
            };
            if (payload) entry.payload = payload;
            magicResults.push(entry);
            break;
          }
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
          case 'scope-snapshot': {
            // RL-020 Slice 9 — relay scope capture; same defensive
            // coercion as the JS/TS runners.
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
              kind: error ? 'error' : 'success',
              timeoutPreset,
              timeoutMs: timeout,
              scopeSnapshot,
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
        finish(runnerTimeoutResult(timeout, t, { stdout, stderr }, timeoutPreset));
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
        // RL-020 Slice 9 — variable inspector capture. The Python
        // worker handles capture/error gracefully; passing `false`
        // keeps the hot path identical to pre-slice behavior.
        captureScope: context?.captureScope === true,
        scopeDepth: context?.scopeDepth,
        // RL-044 Slice 1C fold E — forward the master Settings
        // toggle so the Pyodide preamble can skip payload
        // serialization entirely when the user opted out. Reuses the
        // top-of-execute `settingsSnapshot` (line 192) so a flip
        // mid-execute does not produce a split-state run.
        richConsoleEnabled:
          settingsSnapshot.consoleRichRenderingEnabled !== false,
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
