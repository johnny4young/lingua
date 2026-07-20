/**
 * implementation — renderer-side `LanguageRunner` for the Deno and Bun runtime modes.
 *
 * Mounted as the runtime-mode override for `'deno'` / `'bun'` in
 * `RunnerManager.runtimeModeRunners`. JS / TS tabs whose `runtimeMode`
 * selects one of these resolve here instead of the worker runners.
 *
 * Unlike `NodeRunner`, Deno and Bun execute TypeScript natively, so there
 * is NO esbuild transpile step — the raw source crosses IPC and the main
 * backend (`src/main/altJsRuntimes.ts`) writes it to a temp `.ts` / `.js`
 * file and spawns the binary. Everything else mirrors NodeRunner: per-run
 * timeout from the implementation presets, runId-anchored cancel, the canonical
 * `ExecutionResult` mapping, and a first-run trust notice (these runtimes
 * have full host access, same as node).
 *
 * Magic comments, auto-log, variable inspector, and breakpoints are inert
 * here for the same reason they are in Node mode — no worker-side bridge.
 */

import i18next from 'i18next';
import type {
  ConsoleOutput,
  ExecutionContext,
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
import { runnerStoppedResult, type TranslateFn } from './limits';

const t: TranslateFn = (key, options) => i18next.t(key, options ?? {}) as string;

type AltRuntimeId = 'deno' | 'bun';

function executionLanguage(context?: ExecutionContext): 'javascript' | 'typescript' {
  return context?.language === 'typescript' ? 'typescript' : 'javascript';
}

function mintRunId(id: AltRuntimeId): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `${id}-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
}

export class AltJsRunner implements LanguageRunner {
  readonly id: AltRuntimeId;
  readonly name: string;
  language = 'javascript' as const;
  extensions = ['.js', '.mjs', '.cjs', '.ts', '.mts', '.cts'];

  private ready = false;
  private cancelInFlight: (() => void) | null = null;
  private activeRunId: string | null = null;

  constructor(id: AltRuntimeId) {
    this.id = id;
    this.name = id === 'deno' ? 'Deno (desktop)' : 'Bun (desktop)';
  }

  async init(): Promise<void> {
    // No esbuild — Deno/Bun run TS natively. Nothing to warm up.
    this.ready = true;
  }

  isReady(): boolean {
    return this.ready;
  }

  private bridge() {
    if (typeof window === 'undefined' || !window.lingua) return null;
    return this.id === 'deno' ? window.lingua.deno ?? null : window.lingua.bun ?? null;
  }

  async execute(code: string, context?: ExecutionContext): Promise<ExecutionResult> {
    const bridge = this.bridge();
    if (!bridge) {
      return {
        stdout: [],
        stderr: [],
        result: undefined,
        executionTime: 0,
        error: {
          message: `${this.name} runtime mode is only available in the desktop build.`,
        },
        kind: 'error',
      };
    }

    this.stop();

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

    return new Promise<ExecutionResult>((resolve) => {
      let resolved = false;
      const runId = mintRunId(this.id);
      this.activeRunId = runId;
      const finish = (value: ExecutionResult) => {
        if (resolved) return;
        resolved = true;
        if (this.cancelInFlight === cancel) this.cancelInFlight = null;
        if (this.activeRunId === runId) this.activeRunId = null;
        resolve(value);
      };
      const cancel = () => {
        void bridge.stop(runId).catch(() => {});
        finish(runnerStoppedResult(t, { stdout: [], stderr: [] }));
      };
      this.cancelInFlight = cancel;

      const userEnv = resolveUserEnvForRunner();

      void bridge
        .run(code, {
          runId,
          timeoutMs,
          language,
          userEnv,
        })
        .then((reply) => {
          if (resolved) return;

          if (reply.kind === 'success' && !settings.nodeRunnerFirstRunNoticeShown) {
            useUIStore.getState().pushStatusNotice({
              tone: 'info',
              messageKey: 'runtimeMode.notice.firstRunDangerous',
            });
            useSettingsStore.setState({ nodeRunnerFirstRunNoticeShown: true });
          }

          const stdoutConsole: ConsoleOutput[] = reply.stdout
            ? [{ type: 'log', args: [reply.stdout] }]
            : [];
          const stderrConsole: ConsoleOutput[] = reply.stderr
            ? [{ type: 'error', args: [reply.stderr] }]
            : [];

          if (reply.kind === 'missing-binary') {
            finish({
              stdout: [],
              stderr: stderrConsole,
              result: undefined,
              executionTime: reply.executionTime,
              error: { message: reply.error ?? `${this.name} is not installed on this host.` },
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
            error: reply.error ? { message: reply.error } : undefined,
            kind: reply.kind,
            timeoutPreset,
            timeoutMs: reply.timeoutMs,
          });
        })
        .catch((err) => {
          const message = err instanceof Error ? err.message : String(err);
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
