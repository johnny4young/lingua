import i18next from 'i18next';
import type {
  LanguageRunner,
  ExecutionContext,
  ExecutionResult,
  ConsoleOutput,
  ExecutionError,
  WorkerResponse,
} from '../types';
import { useSettingsStore } from '../stores/settingsStore';
import { getActiveTab, useEditorStore } from '../stores/editorStore';
import {
  resolveTimeoutMs,
  type RuntimeTimeoutPreset,
} from '../../shared/runtimeTimeoutPresets';
import {
  appendCappedConsole,
  capStderrIfOverflowing,
  runnerStoppedResult,
  runnerTimeoutResult,
  type TranslateFn,
} from './limits';
import { resolveUserEnvForRunner } from './env';
import { trackEvent } from '../utils/telemetry';

/**
 * Ruby runtime dispatcher — RL-042 Slice 5 (WASM) + Slice 6 (desktop).
 *
 * `RubyRunner` is now a thin façade. On every `execute()` call it
 * inspects the platform (`window.lingua.ruby?` for the desktop bridge)
 * and the user preference (`Settings → Editor → Ruby runtime`) and
 * forwards to one of two implementations:
 *
 *   - `WasmRubyRunner` (Slice 5) — persistent web worker hosting
 *     CRuby + stdlib via `@ruby/wasm-wasi`. Always available.
 *   - `DesktopRubySubprocessRunner` (Slice 6) — spawns the host
 *     `ruby` binary via the `window.lingua.ruby.*` IPC bridge.
 *     Available only on desktop builds when `ruby --version` succeeds.
 *
 * Preference resolution (per execute()):
 *   - `wasm`   → always the worker.
 *   - `system` → desktop subprocess; falls back to WASM with a status
 *                notice when the binary is missing.
 *   - `auto`   → desktop subprocess when detected, WASM otherwise.
 *
 * Telemetry: every dispatch emits `runtime.ruby_runner_dispatched`
 * with `{ mode: 'system' | 'wasm' | 'missing', bucketedSpawnMs }` so
 * dashboards can isolate the two paths and detect spawn-latency
 * regressions (fold C).
 */

const RUBY_LOAD_TIMEOUT = 90_000;
const RUBY_LOAD_CANCELLED = '__LINGUA_RUBY_LOAD_CANCELLED__';

const t: TranslateFn = (key, options) =>
  i18next.t(key, options ?? {}) as string;

function workerLoadErrorMessage(event: Event): string {
  const maybeMessage = (event as { message?: unknown }).message;
  return typeof maybeMessage === 'string' && maybeMessage.length > 0
    ? maybeMessage
    : 'Ruby worker failed to load';
}

/**
 * RL-042 Slice 6 fold C — bucket the spawn-to-result latency so a
 * future regression in the IPC marshalling or the spawn path surfaces
 * in telemetry without leaking real timings. Closed-enum values; the
 * update-server parity test pins them.
 */
function bucketRubySpawnMs(ms: number): '<100ms' | '<300ms' | '<1s' | '<3s' | '>=3s' {
  if (ms < 100) return '<100ms';
  if (ms < 300) return '<300ms';
  if (ms < 1000) return '<1s';
  if (ms < 3000) return '<3s';
  return '>=3s';
}

// ----------------------------------------------------------------------
// WASM runtime (was the entire `RubyRunner` in Slice 5)
// ----------------------------------------------------------------------

export class WasmRubyRunner implements LanguageRunner {
  id = 'ruby';
  name = 'Ruby (ruby.wasm)';
  language = 'ruby' as const;
  extensions = ['.rb'];

  private worker: Worker | null = null;
  private ready = false;
  private rubyLoaded = false;
  private loadingPromise: Promise<void> | null = null;
  private loadingCancel: (() => void) | null = null;
  private currentRunId: string | null = null;
  private cancelInFlight: (() => void) | null = null;

  async init(): Promise<void> {
    this.ready = true;
  }

  isReady(): boolean {
    return this.ready;
  }

  private async ensureRuby(): Promise<Worker> {
    if (this.worker && this.rubyLoaded) {
      return this.worker;
    }

    if (!this.worker) {
      this.worker = new Worker(
        new URL('../workers/ruby-worker.ts', import.meta.url),
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
            this.rubyLoaded = false;
            this.loadingPromise = null;
            reject(
              new Error(
                `Timed out loading Ruby runtime after ${RUBY_LOAD_TIMEOUT / 1000}s`
              )
            );
          }, RUBY_LOAD_TIMEOUT);

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
          this.rubyLoaded = false;
          this.loadingPromise = null;
          reject(new Error(RUBY_LOAD_CANCELLED));
        };

        const handler = (event: MessageEvent) => {
          const msg = event.data;
          if (msg.type === 'ready') {
            this.rubyLoaded = true;
            cleanup();
            resolve();
          } else if (msg.type === 'error') {
            cleanup();
            worker.terminate();
            if (this.worker === worker) {
              this.worker = null;
            }
            this.rubyLoaded = false;
            this.loadingPromise = null;
            reject(new Error(msg.error?.message ?? 'Failed to load Ruby'));
          }
        };

        const errorHandler = (event: Event) => {
          cleanup();
          worker.terminate();
          if (this.worker === worker) {
            this.worker = null;
          }
          this.rubyLoaded = false;
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
      throw new Error('Ruby worker failed to load');
    }
    return this.worker;
  }

  async execute(code: string, context?: ExecutionContext): Promise<ExecutionResult> {
    const settingsSnapshot = useSettingsStore.getState();
    const callerOverrode = typeof context?.timeout === 'number';
    const presetForLanguage: RuntimeTimeoutPreset | undefined =
      settingsSnapshot.runtimeTimeoutPresetByLanguage?.['ruby'];
    const timeout = callerOverrode
      ? (context!.timeout as number)
      : resolveTimeoutMs('ruby', presetForLanguage);
    const timeoutPreset: RuntimeTimeoutPreset | 'override' = callerOverrode
      ? 'override'
      : presetForLanguage ?? 'normal';

    const stdout: ConsoleOutput[] = [];
    const stderr: ConsoleOutput[] = [];
    let error: ExecutionError | undefined;
    let droppedStdout = 0;
    let droppedStderr = 0;
    let stderrByteTruncated = false;

    if (this.currentRunId !== null || this.cancelInFlight !== null) {
      this.stop();
    }

    let worker: Worker;
    try {
      worker = await this.ensureRuby();
    } catch (err) {
      if (err instanceof Error && err.message === RUBY_LOAD_CANCELLED) {
        return runnerStoppedResult(t, { stdout, stderr });
      }
      return {
        stdout: [],
        stderr: [],
        result: undefined,
        executionTime: 0,
        error: {
          message: `Failed to load Ruby runtime: ${err instanceof Error ? err.message : String(err)}`,
        },
        kind: 'error',
      };
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
        if (!('runId' in msg) || msg.runId !== runId) return;
        if (this.currentRunId !== runId) return;

        switch (msg.type) {
          case 'console': {
            const output: ConsoleOutput = {
              type: msg.method,
              args: msg.args,
            };
            if (typeof msg.line === 'number') output.line = msg.line;
            if (msg.method === 'error' || msg.method === 'warn') {
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
          case 'error':
            error = msg.error;
            break;
          case 'done':
            finish({
              stdout,
              stderr,
              result: undefined,
              executionTime: msg.executionTime,
              error,
              kind: error ? 'error' : 'success',
              timeoutPreset,
              timeoutMs: timeout,
            });
            break;
        }
      };

      worker.addEventListener('message', handler);

      timeoutHandle = setTimeout(() => {
        worker.terminate();
        if (this.worker === worker) {
          this.worker = null;
          this.rubyLoaded = false;
          this.loadingPromise = null;
        }
        finish(runnerTimeoutResult(timeout, t, { stdout, stderr }, timeoutPreset));
      }, timeout);

      worker.postMessage({
        type: 'execute',
        runId,
        code,
        timeout,
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
      this.rubyLoaded = false;
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

// ----------------------------------------------------------------------
// Desktop subprocess runtime (RL-042 Slice 6)
// ----------------------------------------------------------------------

interface DesktopBridge {
  detect: (
    userEnv?: Record<string, string>,
    force?: boolean
  ) => Promise<RubyDetectResult>;
  run: (
    source: string,
    options?: RubyRunInvokeOptions
  ) => Promise<RubyRunResult>;
  stop: (runId: string) => Promise<{ stopped: boolean }>;
}

function getDesktopBridge(): DesktopBridge | null {
  if (typeof window === 'undefined') return null;
  return (window as Window & { lingua?: { ruby?: DesktopBridge } }).lingua?.ruby ?? null;
}

export class DesktopRubySubprocessRunner implements LanguageRunner {
  id = 'ruby';
  name = 'Ruby (system)';
  language = 'ruby' as const;
  extensions = ['.rb'];

  private ready = false;
  private currentRunId: string | null = null;

  async init(): Promise<void> {
    this.ready = true;
  }

  isReady(): boolean {
    return this.ready;
  }

  async execute(code: string, context?: ExecutionContext): Promise<ExecutionResult> {
    const bridge = getDesktopBridge();
    if (!bridge) {
      // Defensive — the dispatcher should never call us when the bridge
      // is absent. Return a structured error so this never silently
      // hangs the runner manager.
      return {
        stdout: [],
        stderr: [],
        result: undefined,
        executionTime: 0,
        error: { message: 'Desktop Ruby bridge is not available.' },
        kind: 'error',
      };
    }

    const settingsSnapshot = useSettingsStore.getState();
    const callerOverrode = typeof context?.timeout === 'number';
    const presetForLanguage: RuntimeTimeoutPreset | undefined =
      settingsSnapshot.runtimeTimeoutPresetByLanguage?.['ruby'];
    const timeout = callerOverrode
      ? (context!.timeout as number)
      : resolveTimeoutMs('ruby', presetForLanguage);
    const timeoutPreset: RuntimeTimeoutPreset | 'override' = callerOverrode
      ? 'override'
      : presetForLanguage ?? 'normal';

    const runId = crypto.randomUUID();
    this.currentRunId = runId;

    const filePath = resolveActiveFilePath();
    const userEnv = resolveUserEnvForRunner();

    let result: RubyRunResult;
    try {
      result = await bridge.run(code, {
        runId,
        timeoutMs: timeout,
        ...(filePath ? { filePath } : {}),
        userEnv,
        messages: {
          stdoutTruncated: t('runner.truncated.stdout', {
            defaultValue: '[stdout truncated]',
          }),
          stderrTruncated: t('runner.truncated.stderr', {
            defaultValue: '[stderr truncated]',
          }),
        },
      });
    } catch (err) {
      this.currentRunId = null;
      const message = err instanceof Error ? err.message : String(err);
      return {
        stdout: [],
        stderr: [],
        result: undefined,
        executionTime: 0,
        error: { message: `Ruby IPC failed: ${message}` },
        kind: 'error',
      };
    }

    if (this.currentRunId === runId) this.currentRunId = null;

    // Translate the IPC text streams into ConsoleOutput rows. The
    // worker path already splits on newline; mirror that here so the
    // ConsolePanel surface stays line-oriented.
    const stdoutRows = splitLines(result.stdout).map<ConsoleOutput>((line) => ({
      type: 'log',
      args: [line],
    }));
    const stderrRows = splitLines(result.stderr).map<ConsoleOutput>((line) => ({
      type: 'warn',
      args: [line],
    }));

    const kind: ExecutionResult['kind'] =
      result.kind === 'success'
        ? 'success'
        : result.kind === 'timeout'
          ? 'timeout'
          : result.kind === 'stopped'
            ? 'stopped'
            : 'error';

    const executionResult: ExecutionResult = {
      stdout: stdoutRows,
      stderr: stderrRows,
      result: undefined,
      executionTime: result.executionTime,
      kind,
      timeoutPreset,
      timeoutMs: result.timeoutMs,
    };
    if (result.kind !== 'success' && result.error) {
      executionResult.error = { message: result.error };
    }
    if (result.kind === 'stopped') {
      executionResult.cancelled = true;
    }
    return executionResult;
  }

  stop(): void {
    const bridge = getDesktopBridge();
    if (bridge && this.currentRunId) {
      void bridge.stop(this.currentRunId).catch(() => {
        // The IPC may race the natural close — safe to ignore.
      });
    }
    this.currentRunId = null;
  }
}

function splitLines(text: string): string[] {
  if (text.length === 0) return [];
  const parts = text.split('\n');
  // Drop ONLY the trailing empty entry produced by a trailing
  // newline. Mid-output blank lines (`puts ""` between two prints)
  // must survive so the desktop path stays line-for-line faithful to
  // the WASM worker's `postBufferedOutput` semantics.
  if (parts.length > 0 && parts[parts.length - 1] === '') parts.pop();
  return parts;
}

function resolveActiveFilePath(): string | undefined {
  try {
    const editor = useEditorStore.getState();
    const tab = getActiveTab(editor);
    return typeof tab?.filePath === 'string' ? tab.filePath : undefined;
  } catch {
    return undefined;
  }
}

// ----------------------------------------------------------------------
// Hybrid dispatcher — public RubyRunner
// ----------------------------------------------------------------------

export type RubyRuntimePreference = 'auto' | 'system' | 'wasm';
export type RubyDispatchedMode = 'system' | 'wasm' | 'missing';

interface DetectionState {
  inFlight: Promise<RubyDetectResult> | null;
  cached: RubyDetectResult | null;
  envKey: string | null;
}

function envCacheKey(userEnv: Record<string, string>): string {
  return JSON.stringify(
    Object.entries(userEnv).sort(([left], [right]) => left.localeCompare(right))
  );
}

/**
 * Public `RubyRunner` consumed by `RunnerManager`. Internally owns
 * both the WASM worker and the desktop subprocess wrappers, plus a
 * per-session detection cache so we don't spawn `ruby --version`
 * before every run.
 */
export class RubyRunner implements LanguageRunner {
  id = 'ruby';
  name = 'Ruby';
  language = 'ruby' as const;
  extensions = ['.rb'];

  private wasm = new WasmRubyRunner();
  private desktop = new DesktopRubySubprocessRunner();
  private ready = false;
  private detection: DetectionState = { inFlight: null, cached: null, envKey: null };

  async init(): Promise<void> {
    this.ready = true;
    // Eagerly init both inner runners; both are idempotent and cheap
    // until the first execute() actually triggers the WASM boot or
    // the desktop IPC.
    await Promise.all([this.wasm.init(), this.desktop.init()]);
  }

  isReady(): boolean {
    return this.ready;
  }

  /** Test-only: reset the detection cache. */
  resetDetectionCache(): void {
    this.detection = { inFlight: null, cached: null, envKey: null };
  }

  private async detect(force = false): Promise<RubyDetectResult | null> {
    const bridge = getDesktopBridge();
    if (!bridge) return null;
    const userEnv = resolveUserEnvForRunner();
    const cacheKey = envCacheKey(userEnv);
    if (!force && this.detection.cached && this.detection.envKey === cacheKey) {
      return this.detection.cached;
    }
    if (!force && this.detection.inFlight && this.detection.envKey === cacheKey) {
      return this.detection.inFlight;
    }
    const promise = bridge
      .detect(userEnv, force)
      .catch<RubyDetectResult>(() => ({
        installed: false,
        error: 'Ruby detection IPC failed',
      }))
      .then((result) => {
        this.detection.cached = result;
        this.detection.inFlight = null;
        this.detection.envKey = cacheKey;
        return result;
      });
    this.detection.inFlight = promise;
    this.detection.envKey = cacheKey;
    return promise;
  }

  async execute(code: string, context?: ExecutionContext): Promise<ExecutionResult> {
    const preference =
      useSettingsStore.getState().rubyRuntimePreference ?? 'auto';
    const bridge = getDesktopBridge();

    let mode: RubyDispatchedMode;
    let dispatchTarget: 'wasm' | 'desktop';

    if (!bridge || preference === 'wasm') {
      // Web build or explicit user opt-out → always WASM.
      dispatchTarget = 'wasm';
      mode = 'wasm';
    } else if (preference === 'system') {
      // User insists on the system binary. If missing we still fall
      // back to WASM so the run doesn't dead-end — the renderer will
      // surface a status notice elsewhere.
      const detect = await this.detect();
      if (detect?.installed) {
        dispatchTarget = 'desktop';
        mode = 'system';
      } else {
        dispatchTarget = 'wasm';
        mode = 'missing';
      }
    } else {
      // `auto` — system when detected, WASM otherwise.
      const detect = await this.detect();
      if (detect?.installed) {
        dispatchTarget = 'desktop';
        mode = 'system';
      } else {
        dispatchTarget = 'wasm';
        mode = 'wasm';
      }
    }

    const start =
      typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? performance.now()
        : Date.now();
    const inner = dispatchTarget === 'wasm' ? this.wasm : this.desktop;
    const result = await inner.execute(code, context);
    const elapsed =
      (typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? performance.now()
        : Date.now()) - start;

    void trackEvent('runtime.ruby_runner_dispatched', {
      mode,
      bucketedSpawnMs: bucketRubySpawnMs(elapsed),
    });

    return result;
  }

  stop(): void {
    // Always stop both inner runners. The dispatcher cannot know which path is in-flight
    // during the `await this.detect()` window inside execute(), so
    // routing on a tracked `lastDispatched` would miss any Stop that
    // arrives before detect resolves. Both `stop()` methods are
    // idempotent: `WasmRubyRunner.stop()` is a no-op when the worker
    // is null, `DesktopRubySubprocessRunner.stop()` is a no-op when
    // `currentRunId` is null.
    this.wasm.stop();
    this.desktop.stop();
  }
}
