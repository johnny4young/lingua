/**
 * implementation — renderer-side `LanguageRunner` for the Node
 * runtime mode.
 *
 * Mounted as the runtime-mode override for `'node'` in
 * `RunnerManager.runtimeModeRunners`. JS / TS tabs whose
 * `runtimeMode === 'node'` resolve here instead of the worker-based
 * JavaScript / TypeScript runners.
 *
 * Responsibilities:
 *
 *   1. Transpile TS through esbuild-wasm (same path the TS worker
 *      runner uses) so the desktop Node subprocess receives pure JS.
 *      JS tabs skip this step.
 *   2. Resolve the per-call timeout from the implementation settings store
 *      (`runtimeTimeoutPresetByLanguage`) unless the caller passed
 *      an explicit override (one-shot extended, magic-comment, etc.).
 *   3. Fire the IPC handle (`window.lingua.node.run`) with the
 *      transpiled source + timeout + filePath + stdin + userEnv +
 *      i18n truncation markers. The IPC bridge does the actual
 *      `spawn('node', ...)`.
 *   4. Map the IPC reply onto the canonical `ExecutionResult` shape
 *      (kind / stdout / stderr / executionTime / error /
 *      timeoutPreset / timeoutMs). Renderer adoption telemetry
 *      (`runtime.node_runner_used`) fires per-run with the closed-
 *      enum status bucket.
 *   5. Surface the first-run trust notice (implementation note) once per session,
 *      gated on `useUIStore` and the
 *      `nodeRunnerFirstRunNoticeShown` settings flag.
 *
 * Limitations documented in the slice plan:
 *
 *   - Magic comments (`//=>`, `// @watch`) and auto-log are INERT
 *     in Node mode — the worker's `__mc(...)` bridge doesn't exist
 *     in a fresh `node` subprocess.
 *   - Variable inspector  is hidden for `runtimeMode === 'node'`
 *     tabs — no worker-side capture hook.
 *   - Debug breakpoints are not honored. A future work could wire
 *     `node --inspect`, but implementation does not.
 */

import i18next from 'i18next';
import type {
  ConsoleOutput,
  ExecutionContext,
  ExecutionError,
  ExecutionResult,
  LanguageRunner,
} from '../types';
import {
  resolveTimeoutMs,
  type RuntimeTimeoutPreset,
} from '../../shared/runtimeTimeoutPresets';
import { useSettingsStore } from '../stores/settingsStore';
import { useUIStore } from '../stores/uiStore';
import { resolveUserEnvForRunner } from './env';
import { trackEvent } from '../utils/telemetry';
import {
  runnerStoppedResult,
  type TranslateFn,
} from './limits';
import { loadEsbuild } from './esbuildLoader';
import { pushMissingNativeToolchainNotice } from './nativeToolchainGuidance';

const t: TranslateFn = (key, options) =>
  i18next.t(key, options ?? {}) as string;

function executionLanguage(context?: ExecutionContext): 'javascript' | 'typescript' {
  return context?.language === 'typescript' ? 'typescript' : 'javascript';
}

function mintRunId(): string {
  return globalThis.crypto?.randomUUID?.() ??
    `node-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export class NodeRunner implements LanguageRunner {
  id = 'node';
  name = 'Node.js (desktop)';
  // The runtime-mode override is registered against multiple
  // languages in `RunnerManager`. We pick `'javascript'` as the
  // canonical language here so the manager's dispatcher key
  // resolves consistently.
  language = 'javascript' as const;
  extensions = ['.js', '.mjs', '.cjs', '.ts', '.mts', '.cts'];

  private ready = false;
  private cancelInFlight: (() => void) | null = null;
  private activeRunId: string | null = null;

  async init(): Promise<void> {
    // Lazy-loads + initializes esbuild-wasm exactly once across all
    // runners (see esbuildLoader.ts) so the chunk stays off the boot path.
    await loadEsbuild();
    this.ready = true;
  }

  isReady(): boolean {
    return this.ready;
  }

  private async transpileTs(code: string): Promise<
    { js: string; error?: undefined } | { js: ''; error: ExecutionError }
  > {
    try {
      const esbuild = await loadEsbuild();
      const result = await esbuild.transform(code, {
        loader: 'tsx',
        target: 'es2022',
        // Preserve ESM syntax so the main-process runner can select
        // `--input-type=module` for static imports, exports, import.meta, and
        // top-level await instead of forcing every TypeScript tab through CJS.
        format: 'esm',
        sourcemap: false,
      });
      return { js: result.code };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
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

  async execute(
    code: string,
    context?: ExecutionContext
  ): Promise<ExecutionResult> {
    if (typeof window === 'undefined' || !window.lingua || !window.lingua.node) {
      // Web build OR a desktop preload that never landed implementation.
      // Surface a clear renderer-side error rather than a TypeError.
      return {
        stdout: [],
        stderr: [],
        result: undefined,
        executionTime: 0,
        error: {
          message:
            'Node runtime mode is only available in the desktop build.',
        },
        kind: 'error',
      };
    }

    this.stop();

    // Resolve the per-run deadline from the per-language preset
    // . Caller override (one-shot extended timeout,
    // `// @timeout` magic-comment) wins when present.
    const settings = useSettingsStore.getState();
    const language = executionLanguage(context);
    const callerOverrode = typeof context?.timeout === 'number';
    const presetForLanguage: RuntimeTimeoutPreset | undefined =
      settings.runtimeTimeoutPresetByLanguage?.[language];
    const timeoutMs = callerOverrode
      ? (context!.timeout as number)
      : resolveTimeoutMs(language, presetForLanguage);
    const timeoutPreset: RuntimeTimeoutPreset | 'override' = callerOverrode
      ? 'override'
      : presetForLanguage ?? 'normal';

    // TypeScript tabs always transpile before crossing IPC. The
    // content sniff remains as a compatibility fallback for older
    // callers that predate `ExecutionContext.language`.
    const looksLikeTs =
      language === 'typescript' ||
      /(?:^|\s)(?:interface|type\s+\w+\s*=|enum\s|as\s+const)/m.test(
        code
      );
    let transpiled = code;
    if (looksLikeTs) {
      const transpileResult = await this.transpileTs(code);
      if (transpileResult.error) {
        return {
          stdout: [],
          stderr: [],
          result: undefined,
          executionTime: 0,
          error: transpileResult.error,
          kind: 'error',
        };
      }
      transpiled = transpileResult.js;
    }

    // implementation note mirror — node mode does not capture
    // variable inspector data (no `globalThis` hook in a fresh
    // subprocess). The toggle hides on the renderer side.

    return new Promise<ExecutionResult>((resolve) => {
      let resolved = false;
      const runId = mintRunId();
      this.activeRunId = runId;
      const nodeBridge = window.lingua.node!;
      const finish = (value: ExecutionResult) => {
        if (resolved) return;
        resolved = true;
        if (this.cancelInFlight === cancel) this.cancelInFlight = null;
        if (this.activeRunId === runId) this.activeRunId = null;
        resolve(value);
      };
      const cancel = () => {
        void nodeBridge.stop(runId).catch(() => {});
        void trackEvent('runtime.node_runner_used', {
          language,
          status: 'stopped',
        });
        finish(
          runnerStoppedResult(t, {
            stdout: [],
            stderr: [],
          })
        );
      };
      this.cancelInFlight = cancel;

      const userEnv = resolveUserEnvForRunner();
      const filePath = context?.filePath;

      const truncationMessages = {
        stdoutTruncated: t('runner.truncated.stdout'),
        stderrTruncated: t('runner.truncated.stderr'),
      };

      void nodeBridge
        .run(transpiled, {
          runId,
          timeoutMs,
          filePath,
          userEnv,
          stdin: context?.stdin,
          messages: truncationMessages,
        })
        .then((reply) => {
          if (resolved) return;
          // implementation note — adoption telemetry. `status` mirrors the
          // closed enum on the IPC reply.
          void trackEvent('runtime.node_runner_used', {
            language,
            status: reply.kind,
          });

          // implementation note — first-run trust notice. Surfaces on the first
          // successful run per session; the settings flag persists
          // the dismissal across sessions when the user toggles it
          // off via Settings (deferred follow-up).
          if (
            reply.kind === 'success' &&
            !settings.nodeRunnerFirstRunNoticeShown
          ) {
            useUIStore.getState().pushStatusNotice({
              tone: 'info',
              messageKey: 'runtimeMode.notice.firstRunDangerous',
            });
            useSettingsStore.setState({
              nodeRunnerFirstRunNoticeShown: true,
            });
          }

          const stdoutConsole: ConsoleOutput[] = reply.stdout
            ? [{ type: 'log', args: [reply.stdout] }]
            : [];
          const stderrConsole: ConsoleOutput[] = reply.stderr
            ? [{ type: 'error', args: [reply.stderr] }]
            : [];

          if (reply.kind === 'missing-binary') {
            pushMissingNativeToolchainNotice('node', async () => {
              const result = await nodeBridge.detect(userEnv, true);
              return result.installed;
            });
            finish({
              stdout: [],
              stderr: stderrConsole,
              result: undefined,
              executionTime: reply.executionTime,
              error: {
                message:
                  reply.error ??
                  'Node.js is not installed on this host.',
              },
              kind: 'error',
              timeoutPreset,
              timeoutMs: reply.timeoutMs,
            });
            return;
          }

          finish({
            stdout: stdoutConsole,
            stderr: stderrConsole,
            result: undefined,
            executionTime: reply.executionTime,
            error: reply.error
              ? { message: reply.error }
              : undefined,
            kind: reply.kind,
            timeoutPreset,
            timeoutMs: reply.timeoutMs,
          });
        })
        .catch((err) => {
          const message =
            err instanceof Error ? err.message : String(err);
          finish({
            stdout: [],
            stderr: [],
            result: undefined,
            executionTime: 0,
            error: { message },
            kind: 'error',
            timeoutPreset,
            timeoutMs,
          });
        });
    });
  }

  stop(): void {
    if (this.cancelInFlight) {
      const cancel = this.cancelInFlight;
      this.cancelInFlight = null;
      cancel();
    }
  }
}
