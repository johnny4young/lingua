/**
 * Desktop Deno and Bun execution backends.
 *
 * Deno and Bun both run JavaScript AND TypeScript directly (no separate
 * transpile step), so a single generic runner drives both — parameterized
 * by the binary name and its argv builder. The security posture matches
 * node-runner.ts / ruby-runner.ts exactly:
 *
 *   - The shared `spawnNativeRun` supervisor, never a shell. Source is
 *     written to a staged temp file and passed by path — no command-line
 *     interpolation.
 *   - Env filtered through the internal allowlist + internal user tier; the
 *     host env is never forwarded wholesale.
 *   - Parent-owned timeout with SIGTERM→SIGKILL escalation via
 *     `killProcessTree` (process-group leader on POSIX).
 *   - stdout / stderr capped at 1 MiB with the shared truncation markers.
 *
 * Deno is spawned with an explicit permission allowlist argument
 * (`--allow-read=<tempdir>` only) so user code is sandboxed to its own
 * temp directory by default — network and broader filesystem access stay
 * denied unless a future work surfaces an opt-in. Bun has no built-in
 * permission model; it runs with the filtered env as its only boundary,
 * documented here so the trust posture is explicit.
 *
 * Wiring status: this module ships the tested execution backend and its
 * IPC handlers, and the renderer exposes Deno / Bun through the same
 * runtime-mode surface as Worker / Node / Browser Preview. The renderer
 * runner manager checks bridge availability before it constructs a runner,
 * and each runner handles binary detection, so web builds and hosts without
 * the toolchain degrade with actionable errors.
 */

import type { WebContents } from 'electron';
import { createNativeRunLifecycle } from './runners/nativeRunLifecycle';
import { typedHandle } from './ipc/typedHandle';
import { writeFile } from 'node:fs/promises';
import { cleanupNativeRunTempDir, stageNativeRunTempDir } from './runners/nativeRunTempDirs';
import path from 'node:path';
import { MAX_NATIVE_STDERR_BYTES } from '../shared/runnerLimits';
import { BUN_TOOLCHAIN_KEYS, DENO_TOOLCHAIN_KEYS } from '../shared/nativeToolchainEnvKeys';
import { buildNativeRunnerEnv, combinedAllowlist } from './runners/nativeEnv';
import { spawnNativeRun, type SpawnNativeRunResult } from './runners/spawnNativeRun';
import { detectNativeRuntimeVersion } from './runners/nativeRuntimeDetection';
import type {
  AltJsDetectResult,
  AltJsRunResult,
} from '../shared/nativeRuntimeTypes';

const KILL_ESCALATION_DELAY_MS = 200;
const DEFAULT_TIMEOUT_MS = 30_000;
const STDOUT_TRUNCATION_MARKER = '\n[stdout truncated]';
const STDERR_TRUNCATION_MARKER = '\n[stderr truncated]';

type AltJsRuntimeId = 'deno' | 'bun';

interface AltJsRunOptions {
  runId?: string;
  timeoutMs?: number;
  language?: string;
  userEnv?: Record<string, string>;
}

interface RuntimeConfig {
  binary: string;
  installHint: string;
  /** Extension for the temp entry file. Both accept .ts + .js. */
  ext: (language: string | undefined) => string;
  /** Build the run argv given the temp entry path and its dir. */
  runArgs: (entryFile: string, entryDir: string) => string[];
  /** Toolchain env keys these runtimes honor (kept minimal, internal). */
  toolchainKeys: readonly string[];
}

const CONFIGS: Record<AltJsRuntimeId, RuntimeConfig> = {
  deno: {
    binary: 'deno',
    installHint: 'Deno is not installed. Install it from https://deno.com',
    ext: (language) => (language === 'typescript' ? 'ts' : 'js'),
    // Sandbox to the temp dir: read-only there, everything else denied.
    runArgs: (entryFile, entryDir) => [
      'run',
      '--quiet',
      `--allow-read=${entryDir}`,
      entryFile,
    ],
    // DENO_DIR is the module/cache root; keep the rest of the host env out.
    toolchainKeys: DENO_TOOLCHAIN_KEYS,
  },
  bun: {
    binary: 'bun',
    installHint: 'Bun is not installed. Install it from https://bun.sh',
    ext: (language) => (language === 'typescript' ? 'ts' : 'js'),
    runArgs: (entryFile) => ['run', entryFile],
    // BUN_INSTALL anchors the per-user cache; nothing else leaks.
    toolchainKeys: BUN_TOOLCHAIN_KEYS,
  },
};

const detectCache = new Map<AltJsRuntimeId, AltJsDetectResult>();
const activeRuns = new Map<string, () => void>();

function resolveEnv(id: AltJsRuntimeId, userEnv?: Record<string, string>): NodeJS.ProcessEnv {
  return buildNativeRunnerEnv(combinedAllowlist(CONFIGS[id].toolchainKeys), userEnv);
}

async function detectAltRuntime(
  id: AltJsRuntimeId,
  userEnv?: Record<string, string>,
  force = false,
  signal?: AbortSignal
): Promise<AltJsDetectResult> {
  const cacheable = userEnv === undefined;
  if (cacheable && !force) {
    const cached = detectCache.get(id);
    if (cached) return cached;
  }
  let result: AltJsDetectResult;
  const probe = await detectNativeRuntimeVersion({
    command: CONFIGS[id].binary,
    env: resolveEnv(id, userEnv),
    signal,
    killEscalationMs: KILL_ESCALATION_DELAY_MS,
  });
  if (probe.version !== null) {
    result = { installed: true, version: probe.version.split('\n')[0] };
  } else {
    result = { installed: false, reason: probe.reason, error: CONFIGS[id].installHint };
  }
  if (cacheable && !signal?.aborted) {
    if (result.reason === 'check-failed') detectCache.delete(id);
    else detectCache.set(id, result);
  }
  return result;
}

function clampTimeout(timeoutMs: number | undefined): number {
  if (typeof timeoutMs !== 'number' || !Number.isFinite(timeoutMs)) return DEFAULT_TIMEOUT_MS;
  if (timeoutMs < 100) return 100;
  if (timeoutMs > 5 * 60 * 1000) return 5 * 60 * 1000;
  return Math.floor(timeoutMs);
}

async function spawnAltRuntime(
  id: AltJsRuntimeId,
  source: string,
  options: AltJsRunOptions,
  signal: AbortSignal
): Promise<AltJsRunResult> {
  const config = CONFIGS[id];
  const timeoutMs = clampTimeout(options.timeoutMs);
  const env = resolveEnv(id, options.userEnv);
  let tempDir: string | undefined;
  let entryFile: string;
  try {
    tempDir = stageNativeRunTempDir(`lingua-${id}-`);
    if (signal.aborted) {
      await cleanupNativeRunTempDir(tempDir);
      return stoppedAltRunResult(options);
    }
    entryFile = path.join(tempDir, `entry.${config.ext(options.language)}`);
    await writeFile(entryFile, source, 'utf-8');
  } catch (err) {
    if (tempDir) await cleanupNativeRunTempDir(tempDir);
    if (signal.aborted) return stoppedAltRunResult(options);
    return {
      kind: 'error',
      stdout: '',
      stderr: err instanceof Error ? err.message : String(err),
      exitCode: -1,
      executionTime: 0,
      error: 'Failed to stage source for execution.',
      timeoutMs,
    };
  }

  try {
    if (signal.aborted) return stoppedAltRunResult(options);
    const run = await spawnNativeRun({
      command: config.binary,
      args: config.runArgs(entryFile, tempDir),
      cwd: tempDir,
      env,
      timeoutMs,
      killEscalationMs: KILL_ESCALATION_DELAY_MS,
      maxOutputBytes: MAX_NATIVE_STDERR_BYTES,
      stdoutTruncationMarker: STDOUT_TRUNCATION_MARKER,
      stderrTruncationMarker: STDERR_TRUNCATION_MARKER,
      stdin: {},
      signal,
    });
    return mapAltRunResult(run, config.binary, timeoutMs);
  } finally {
    await cleanupNativeRunTempDir(tempDir);
  }
}

function mapAltRunResult(
  run: SpawnNativeRunResult,
  binary: string,
  timeoutMs: number
): AltJsRunResult {
  const base = {
    stdout: run.stdout,
    stderr: run.stderr,
    exitCode: run.exitCode,
    executionTime: run.executionTime,
    timeoutMs,
  };
  if (run.spawnError) {
    const message = run.spawnError.message || `Failed to spawn ${binary}`;
    const missing = /ENOENT/.test(message) || /not found/i.test(message);
    return {
      ...base,
      kind: missing ? 'missing-binary' : 'error',
      stderr: run.stderr || message,
      exitCode: -1,
      error: message,
    };
  }
  if (run.killed) return { ...base, kind: 'stopped' };
  if (run.timedOut) {
    return { ...base, kind: 'timeout', error: `Run timed out after ${Math.round(timeoutMs / 1000)}s` };
  }
  if (run.exitCode !== 0) {
    return { ...base, kind: 'error', error: run.stderr || `Process exited with code ${run.exitCode}` };
  }
  return { ...base, kind: 'success' };
}

function stoppedAltRunResult(options: AltJsRunOptions): AltJsRunResult {
  return {
    kind: 'stopped', stdout: '', stderr: '', exitCode: -1, executionTime: 0,
    timeoutMs: clampTimeout(options.timeoutMs),
  };
}

async function runAltRuntime(
  id: AltJsRuntimeId,
  source: string,
  options: AltJsRunOptions,
  owner?: WebContents
): Promise<AltJsRunResult> {
  if (options.runId && activeRuns.has(options.runId)) {
    return {
      kind: 'error', stdout: '', stderr: '', exitCode: -1, executionTime: 0,
      error: 'A native JavaScript run with this identity is already active.',
      timeoutMs: clampTimeout(options.timeoutMs),
    };
  }
  const { controller, release } = createNativeRunLifecycle(owner);
  const stop = () => controller.abort();
  if (options.runId) activeRuns.set(options.runId, stop);
  try {
    if (controller.signal.aborted) return stoppedAltRunResult(options);
    const detect = await detectAltRuntime(id, options.userEnv, false, controller.signal);
    if (controller.signal.aborted) return stoppedAltRunResult(options);
    if (!detect.installed) {
      return {
        kind: 'missing-binary',
        stdout: '',
        stderr: detect.error ?? `${id} is not installed.`,
        exitCode: -1,
        executionTime: 0,
        error: detect.error,
        timeoutMs: clampTimeout(options.timeoutMs),
      };
    }
    return await spawnAltRuntime(id, source, options, controller.signal);
  } finally {
    release();
    if (options.runId && activeRuns.get(options.runId) === stop) activeRuns.delete(options.runId);
  }
}

export function stopAltRun(runId: unknown): { stopped: boolean } {
  if (typeof runId !== 'string' || runId.length === 0) return { stopped: false };
  const stop = activeRuns.get(runId);
  if (!stop) return { stopped: false };
  stop();
  return { stopped: true };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeStringMap(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) return undefined;
  const out: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'string') out[key] = entry;
  }
  return out;
}

function normalizeAltRunOptions(value: unknown): AltJsRunOptions {
  if (!isRecord(value)) return {};
  return {
    runId: typeof value.runId === 'string' ? value.runId : undefined,
    timeoutMs: typeof value.timeoutMs === 'number' ? value.timeoutMs : undefined,
    language: typeof value.language === 'string' ? value.language : undefined,
    userEnv: normalizeStringMap(value.userEnv),
  };
}

/** Test seam — clears detection + active-run state between cases. */
export function _resetAltRuntimesForTests(): void {
  detectCache.clear();
  activeRuns.clear();
}

function invalidSourceResult(id: AltJsRuntimeId): AltJsRunResult {
  return {
    kind: 'error',
    stdout: '',
    stderr: `${id} runner received invalid source.`,
    exitCode: -1,
    executionTime: 0,
    error: 'invalid-source',
    timeoutMs: DEFAULT_TIMEOUT_MS,
  };
}

export function registerAltJsRuntimeHandlers(): void {
  // Registered under literal channel names (not a `${id}` loop) so the
  // typed IPC contract type-checks each one and the ipcContract drift test
  // can statically see them.
  typedHandle('deno:detect', async (_event, userEnv?: Record<string, string>, force?: boolean) =>
    detectAltRuntime('deno', userEnv, force === true)
  );
  typedHandle('deno:run', async (event, source: string, options?: AltJsRunInvokeOptions) =>
    typeof source === 'string'
      ? runAltRuntime('deno', source, normalizeAltRunOptions(options), event.sender)
      : invalidSourceResult('deno')
  );
  typedHandle('deno:stop', async (_event, runId: string) => stopAltRun(runId));

  typedHandle('bun:detect', async (_event, userEnv?: Record<string, string>, force?: boolean) =>
    detectAltRuntime('bun', userEnv, force === true)
  );
  typedHandle('bun:run', async (event, source: string, options?: AltJsRunInvokeOptions) =>
    typeof source === 'string'
      ? runAltRuntime('bun', source, normalizeAltRunOptions(options), event.sender)
      : invalidSourceResult('bun')
  );
  typedHandle('bun:stop', async (_event, runId: string) => stopAltRun(runId));
}
