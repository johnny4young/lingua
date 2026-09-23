/**
 * Rust compilation and execution IPC handler for the main process.
 *
 * Handles:
 * - Detecting local Rust installation (`rustc`)
 * - Compiling Rust source code to a native binary via `rustc`
 * - Running the compiled binary and capturing stdout/stderr
 *
 * internal — the subprocess env is filtered through
 * `buildNativeRunnerEnv` so secrets in `process.env` (CI tokens,
 * OPENAI_API_KEY, etc.) cannot reach the spawned `rustc` or the
 * compiled user binary. Temp dirs use `mkdtemp` for collision
 * resistance, and stderr / stdout are capped at 1 MiB before being
 * surfaced to the renderer so a runaway compile or runtime cannot
 * flood the IPC channel.
 */

import { typedHandle } from './ipc/typedHandle';
import type { WebContents } from 'electron';
import { createNativeRunLifecycle } from './runners/nativeRunLifecycle';
import { writeFile } from 'node:fs/promises';
import { cleanupNativeRunTempDir, stageNativeRunTempDir } from './runners/nativeRunTempDirs';
import path from 'node:path';
import {
  MAX_COMPILE_OUTPUT_BYTES,
  MAX_NATIVE_STDERR_BYTES,
} from '../shared/runnerLimits';
import {
  RUST_TOOLCHAIN_KEYS,
  buildNativeRunnerEnv,
  combinedAllowlist,
} from './runners/nativeEnv';
import { spawnNativeRun, type SpawnNativeRunResult } from './runners/spawnNativeRun';
import type { RustDetectResult, RustRunResult } from '../shared/nativeRuntimeTypes';


/**
 * Rust edition passed to BOTH rustc (compile) and rustfmt (format-on-save,
 * src/main/formatters.ts). rustc defaults to edition 2015 when no flag is
 * passed, which silently rejects `async`/`await`/`dyn` and changes
 * `into_iter()` semantics — while every real-world cargo project (and our
 * own formatter) assumes 2021. Keeping a single constant means the compile
 * and format paths cannot drift apart again.
 */
export const RUST_EDITION = '2021';

/** Wall-clock budget for the compiled user binary. */
const RUST_RUN_TIMEOUT_MS = 30_000;

/**
 * SIGTERM → SIGKILL escalation window after the run timeout fires. A
 * compiled binary has no interpreter shutdown hooks worth waiting for;
 * matches the Node runner's 200 ms convention.
 */
const KILL_ESCALATION_DELAY_MS = 200;

const COMPILE_TRUNCATION_MARKER = '\n[Compile output truncated]';
const RUNTIME_STDOUT_TRUNCATION_MARKER = '\n[stdout truncated]';
const RUNTIME_STDERR_TRUNCATION_MARKER = '\n[stderr truncated]';

function truncationMarkers(messages?: NativeRunnerMessages) {
  return {
    compile: messages?.compileOutputTruncated
      ? `\n${messages.compileOutputTruncated}`
      : COMPILE_TRUNCATION_MARKER,
    stdout: messages?.stdoutTruncated
      ? `\n${messages.stdoutTruncated}`
      : RUNTIME_STDOUT_TRUNCATION_MARKER,
    stderr: messages?.stderrTruncated
      ? `\n${messages.stderrTruncated}`
      : RUNTIME_STDERR_TRUNCATION_MARKER,
  };
}

/**
 * Build the env passed to `rustc` and the compiled binary.
 *
 * internal: only allowlisted host keys flow through; the user-tier env
 * from internal layers on top. There are no runner-owned overrides for
 * Rust — rustc respects the host toolchain on its own and the
 * spawned binary gets whatever the user explicitly configured.
 */
export function resolveRustRunEnv(
  userEnv?: Record<string, string>
): NodeJS.ProcessEnv {
  return buildNativeRunnerEnv(combinedAllowlist(RUST_TOOLCHAIN_KEYS), userEnv);
}

/**
 * Session cache for the default-env probe. `rust:run` calls detect on
 * EVERY run, so an uncached probe adds a fixed `rustc --version` spawn
 * (slow behind rustup shims) to each execution. Only successful detects
 * are cached (and only for the default env) so installing Rust
 * mid-session is picked up by the next run — same convention as
 * node-runner and go-compiler.
 */
let cachedRustDetect: RustDetectResult | null = null;

const activeRuns = new Map<string, { owner?: WebContents; controller: AbortController }>();
const emptyRun = { stdout: '', stderr: '', exitCode: -1, executionTime: 0 };
const stopped = (): RustRunResult => ({ ...emptyRun, success: false, kind: 'stopped' });
const failed = (error: string): RustRunResult => ({ ...emptyRun, success: false, kind: 'error', error, stderr: error });

async function detectRust(userEnv?: Record<string, string>, signal?: AbortSignal): Promise<
  RustDetectResult & { timedOut?: boolean }
> {
  const cacheable = userEnv === undefined;
  if (signal?.aborted) return { installed: false, reason: 'check-failed' };
  if (cacheable && cachedRustDetect) return cachedRustDetect;
  const probe = await spawnNativeRun({
    command: 'rustc', args: ['--version'], env: resolveRustRunEnv(userEnv),
    timeoutMs: 5_000, killEscalationMs: KILL_ESCALATION_DELAY_MS,
    maxOutputBytes: MAX_COMPILE_OUTPUT_BYTES,
    stdoutTruncationMarker: COMPILE_TRUNCATION_MARKER,
    stderrTruncationMarker: COMPILE_TRUNCATION_MARKER, signal,
  });
  if (signal?.aborted || probe.killed) return { installed: false, reason: 'check-failed' };
  if (probe.spawnError || probe.timedOut || probe.exitCode !== 0) {
    const missing = (probe.spawnError as NodeJS.ErrnoException | undefined)?.code === 'ENOENT';
    return {
      installed: false,
      reason: missing ? 'missing' : 'check-failed',
      timedOut: probe.timedOut,
      error: missing
        ? 'Rust is not installed. Install it from https://rustup.rs'
        : 'Rust toolchain check failed. Retry detection or inspect your local Rust installation.',
    };
  }
  const result = { installed: true, version: probe.stdout.trim() };
  if (cacheable) cachedRustDetect = result;
  return result;
}

function processResult(run: SpawnNativeRunResult, timeoutMs: number): RustRunResult {
  const kind = run.killed ? 'stopped' : run.timedOut ? 'timeout'
    : run.spawnError || run.exitCode !== 0 ? 'error' : 'success';
  return {
    success: kind === 'success', kind, stdout: run.stdout, stderr: run.stderr,
    exitCode: run.exitCode, executionTime: run.executionTime,
    ...(kind === 'timeout' ? { timeoutMs } : {}),
    error: kind === 'error'
      ? run.spawnError?.message || run.stderr || `Process exited with code ${run.exitCode}`
      : undefined,
  };
}

/** One controller owns detection, staging, compilation and execution. */
async function runRustCode(
  sourceCode: string, userEnv: Record<string, string> | undefined,
  messages: NativeRunnerMessages | undefined, runId: string | undefined,
  owner?: WebContents
): Promise<RustRunResult> {
  if (runId && activeRuns.has(runId)) return failed('A Rust run with this ID is already active.');
  const lifecycle = createNativeRunLifecycle(owner);
  const { controller } = lifecycle;
  const { signal } = controller;
  const active = { owner, controller };
  if (runId) activeRuns.set(runId, active);
  let tempDir: string | undefined;
  try {
    const rustInfo = await detectRust(userEnv, signal);
    if (signal.aborted) return stopped();
    if (rustInfo.timedOut) return { ...emptyRun, success: false, kind: 'timeout', timeoutMs: 5_000 };
    if (!rustInfo.installed) return failed(rustInfo.error ?? 'Rust is not installed.');

    tempDir = stageNativeRunTempDir('lingua-rust-');
    if (signal.aborted) return stopped();
    const sourceFile = path.join(tempDir, 'main.rs');
    const binaryFile = path.join(tempDir, process.platform === 'win32' ? 'main.exe' : 'main');
    await writeFile(sourceFile, sourceCode, 'utf-8');
    if (signal.aborted) return stopped();
    const env = resolveRustRunEnv(userEnv);
    const markers = truncationMarkers(messages);
    const compiled = await spawnNativeRun({
      command: 'rustc', args: ['--edition', RUST_EDITION, sourceFile, '-o', binaryFile],
      env, signal, timeoutMs: 60_000, killEscalationMs: KILL_ESCALATION_DELAY_MS,
      maxOutputBytes: MAX_COMPILE_OUTPUT_BYTES,
      stdoutTruncationMarker: markers.compile, stderrTruncationMarker: markers.compile,
    });
    if (signal.aborted) return stopped();
    if (compiled.exitCode !== 0 || compiled.spawnError || compiled.timedOut || compiled.killed) {
      return processResult(compiled, 60_000);
    }
    const run = await spawnNativeRun({
      command: binaryFile, args: [], env, signal, timeoutMs: RUST_RUN_TIMEOUT_MS,
      killEscalationMs: KILL_ESCALATION_DELAY_MS, maxOutputBytes: MAX_NATIVE_STDERR_BYTES,
      stdoutTruncationMarker: markers.stdout, stderrTruncationMarker: markers.stderr,
    });
    return signal.aborted ? stopped() : processResult(run, RUST_RUN_TIMEOUT_MS);
  } catch (error) {
    return signal.aborted ? stopped() : failed(error instanceof Error ? error.message : String(error));
  } finally {
    if (tempDir) await cleanupNativeRunTempDir(tempDir);
    if (runId && activeRuns.get(runId) === active) activeRuns.delete(runId);
    lifecycle.release();
  }
}

function stringMap(value: unknown): value is Record<string, string> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    && Object.values(value).every(entry => typeof entry === 'string');
}
function validRunId(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 128;
}

/** Validate wire values before probing, allocating files or spawning. */
export function registerRustHandlers(): void {
  typedHandle('rust:detect', async (event, userEnv?: unknown) => {
    if (userEnv !== undefined && !stringMap(userEnv)) return { installed: false, reason: 'check-failed', error: 'Invalid Rust environment.' };
    const lifecycle = createNativeRunLifecycle(event.sender);
    try { return await detectRust(userEnv, lifecycle.controller.signal); }
    finally { lifecycle.release(); }
  });
  typedHandle('rust:run', async (event, source: unknown, userEnv?: unknown, messages?: unknown, runId?: unknown) => {
    if (typeof source !== 'string' || (userEnv !== undefined && !stringMap(userEnv))
      || (messages !== undefined && !stringMap(messages))
      || (runId !== undefined && !validRunId(runId))) return failed('Invalid Rust run request.');
    return runRustCode(source, userEnv, messages, runId, event.sender);
  });
  typedHandle('rust:stop', async (event, runId: unknown) => {
    if (!validRunId(runId)) return { stopped: false };
    const active = activeRuns.get(runId);
    if (!active || active.owner !== event.sender) return { stopped: false };
    active.controller.abort();
    return { stopped: true };
  });
}
