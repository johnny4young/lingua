/**
 * Go compilation IPC handler for the main process.
 *
 * Handles:
 * - Detecting local Go installation
 * - Compiling Go source code to WASM using GOOS=js GOARCH=wasm
 * - Locating wasm_exec.js from the Go installation
 *
 * internal — the toolchain subprocess env is filtered through
 * `buildNativeRunnerEnv` so secrets in `process.env` cannot reach the
 * spawned `go build`. `GOOS=js` and `GOARCH=wasm` are runner-owned
 * overrides that the user env tier cannot shadow. Temp dirs use
 * `mkdtemp` for collision resistance, and compile output is capped at
 * 1 MiB before being surfaced to the renderer.
 */

import { typedHandle } from './ipc/typedHandle';
import type { WebContents } from 'electron';
import { createNativeRunLifecycle } from './runners/nativeRunLifecycle';
import { spawnNativeRun } from './runners/spawnNativeRun';
import { writeFile, readFile, stat } from 'node:fs/promises';
import { cleanupNativeRunTempDir, stageNativeRunTempDir } from './runners/nativeRunTempDirs';
import path from 'node:path';
import {
  MAX_COMPILE_OUTPUT_BYTES,
  MAX_GO_WASM_BYTES,
  truncateBytes,
} from '../shared/runnerLimits';
import {
  GO_TOOLCHAIN_KEYS,
  buildNativeRunnerEnv,
  combinedAllowlist,
} from './runners/nativeEnv';
import type { GoCompileResult, GoDetectResult } from '../shared/nativeRuntimeTypes';

const WASM_EXEC_RELATIVE_PATHS = [
  ['lib', 'wasm', 'wasm_exec.js'],
  ['misc', 'wasm', 'wasm_exec.js'],
] as const;

const COMPILE_TRUNCATION_MARKER = '\n[Compile output truncated]';

function compileTruncationMarker(messages?: NativeRunnerMessages): string {
  return messages?.compileOutputTruncated
    ? `\n${messages.compileOutputTruncated}`
    : COMPILE_TRUNCATION_MARKER;
}

export function getWasmExecCandidatePaths(goRoot: string): string[] {
  return WASM_EXEC_RELATIVE_PATHS.map((segments) => path.join(goRoot, ...segments));
}

export async function readWasmExecJs(
  goRoot: string, signal?: AbortSignal
): Promise<{ path: string; source: string }> {
  const checkedPaths: string[] = [];

  for (const candidatePath of getWasmExecCandidatePaths(goRoot)) {
    signal?.throwIfAborted();
    checkedPaths.push(candidatePath);

    try {
      const source = await readFile(candidatePath, 'utf-8');
      signal?.throwIfAborted();
      return { path: candidatePath, source };
    } catch (error) {
      const errorCode = (error as NodeJS.ErrnoException).code;
      if (errorCode === 'ENOENT') {
        continue;
      }

      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to read Go WASM runtime at "${candidatePath}": ${message}`, {
        cause: error,
      });
    }
  }

  throw new Error(
    `Go WASM runtime not found for GOROOT "${goRoot}". Checked: ${checkedPaths.join(', ')}`
  );
}

function resolveGoToolchainEnv(
  userEnv?: Record<string, string>
): NodeJS.ProcessEnv {
  return buildNativeRunnerEnv(combinedAllowlist(GO_TOOLCHAIN_KEYS), userEnv);
}

/**
 * Session cache for the default-env probe. `go:compile` calls detect on
 * EVERY run, and the probe costs two spawns (`go version` + `go env
 * GOROOT`) — 40–160 ms of fixed latency per run, worse behind
 * rustup/asdf-style shims. Only successful detects are cached (and only
 * for the default env) so installing Go mid-session is still picked up
 * by the next run, matching the node-runner convention.
 */
let cachedGoDetect: GoDetectResult | null = null;

/** Detect with the same process ownership as compilation. */
async function detectGo(userEnv?: Record<string, string>, signal?: AbortSignal): Promise<
  GoDetectResult & { timedOut?: boolean }
> {
  const cacheable = userEnv === undefined;
  if (signal?.aborted) return { installed: false, reason: 'check-failed' };
  if (cacheable && cachedGoDetect) return cachedGoDetect;
  const env = resolveGoToolchainEnv(userEnv);
  const outputs: string[] = [];
  for (const args of [['version'], ['env', 'GOROOT']]) {
    if (signal?.aborted) return { installed: false, reason: 'check-failed' };
    const probe = await spawnNativeRun({
      command: 'go', args, env, signal, timeoutMs: 5_000, killEscalationMs: 200,
      maxOutputBytes: MAX_COMPILE_OUTPUT_BYTES,
      stdoutTruncationMarker: COMPILE_TRUNCATION_MARKER,
      stderrTruncationMarker: COMPILE_TRUNCATION_MARKER,
    });
    if (signal?.aborted || probe.killed) return { installed: false, reason: 'check-failed' };
    if (probe.spawnError || probe.timedOut || probe.exitCode !== 0) {
      const missing = (probe.spawnError as NodeJS.ErrnoException | undefined)?.code === 'ENOENT';
      return {
        installed: false,
        reason: missing ? 'missing' : 'check-failed',
        timedOut: probe.timedOut,
        error: missing
          ? 'Go is not installed. Install it from https://go.dev/dl/'
          : 'Go toolchain check failed. Retry detection or inspect your local Go installation.',
      };
    }
    outputs.push(probe.stdout.trim());
  }
  const result: GoDetectResult = { installed: true, version: outputs[0], goRoot: outputs[1] };
  if (cacheable) cachedGoDetect = result;
  return result;
}

/**
 * Build the env passed to `go build`.
 *
 * implementation detail contract:
 *  - Only allowlisted host keys flow through (`buildNativeRunnerEnv`).
 *  - User env from internal layers on top.
 *  - `GOOS=js` / `GOARCH=wasm` are runner-owned overrides applied
 *    last; user env cannot shadow them — they would silently break
 *    the WASM pipeline.
 */
export function resolveGoCompileEnv(
  userEnv?: Record<string, string>
): NodeJS.ProcessEnv {
  return buildNativeRunnerEnv(
    combinedAllowlist(GO_TOOLCHAIN_KEYS),
    userEnv,
    { GOOS: 'js', GOARCH: 'wasm' }
  );
}

const activeCompiles = new Map<string, { owner?: WebContents; controller: AbortController }>();
const stopped = (): GoCompileResult => ({ success: false, kind: 'stopped' });
const failed = (error: string): GoCompileResult => ({ success: false, kind: 'error', error });

async function compileGoToWasm(
  sourceCode: string, userEnv: Record<string, string> | undefined,
  messages: NativeRunnerMessages | undefined, runId: string | undefined,
  owner?: WebContents
): Promise<GoCompileResult> {
  if (runId && activeCompiles.has(runId)) return failed('A Go compile with this ID is already active.');
  const lifecycle = createNativeRunLifecycle(owner);
  const { controller } = lifecycle;
  const { signal } = controller;
  const active = { owner, controller };
  if (runId) activeCompiles.set(runId, active);
  let tempDir: string | undefined;
  let goVersion: string | undefined;
  try {
    const goInfo = await detectGo(userEnv, signal);
    if (signal.aborted) return stopped();
    if (goInfo.timedOut) return { success: false, kind: 'timeout', timeoutMs: 5_000 };
    if (!goInfo.installed || !goInfo.goRoot) return failed(goInfo.error ?? 'Go is not installed.');
    goVersion = goInfo.version;
    tempDir = stageNativeRunTempDir('lingua-go-');
    if (signal.aborted) return stopped();
    const wasmFile = path.join(tempDir, 'main.wasm');
    await writeFile(path.join(tempDir, 'main.go'), sourceCode, 'utf-8');
    if (signal.aborted) return stopped();
    await writeFile(path.join(tempDir, 'go.mod'), 'module lingua_temp\n\ngo 1.21\n', 'utf-8');
    if (signal.aborted) return stopped();
    const compiled = await spawnNativeRun({
      command: 'go', args: ['build', '-o', wasmFile, '.'], cwd: tempDir,
      env: resolveGoCompileEnv(userEnv), signal, timeoutMs: 30_000, killEscalationMs: 200,
      maxOutputBytes: MAX_COMPILE_OUTPUT_BYTES,
      stdoutTruncationMarker: compileTruncationMarker(messages),
      stderrTruncationMarker: compileTruncationMarker(messages),
    });
    if (signal.aborted || compiled.killed) return stopped();
    if (compiled.timedOut) return { success: false, kind: 'timeout', timeoutMs: 30_000, goVersion };
    if (compiled.spawnError || compiled.exitCode !== 0) {
      return { ...failed(compiled.spawnError?.message || compiled.stderr || `Go compiler exited with code ${compiled.exitCode}`), goVersion };
    }
    const wasmStat = await stat(wasmFile);
    if (signal.aborted) return stopped();
    if (wasmStat.size > MAX_GO_WASM_BYTES) {
      return { ...failed(`Compiled Go WASM exceeded ${MAX_GO_WASM_BYTES} byte limit.`), goVersion };
    }
    const wasmBuffer = await readFile(wasmFile);
    if (signal.aborted) return stopped();
    // Preserve the typed-array IPC/worker transfer, not an expanded number[].
    const wasmBytes = new Uint8Array(wasmBuffer.buffer, wasmBuffer.byteOffset, wasmBuffer.byteLength);
    const { source: wasmExecJs } = await readWasmExecJs(goInfo.goRoot, signal);
    if (signal.aborted) return stopped();
    return { success: true, kind: 'success', wasmBytes, wasmExecJs, goVersion };
  } catch (error) {
    if (signal.aborted) return stopped();
    const message = error instanceof Error ? error.message : String(error);
    return { ...failed(truncateBytes(message, MAX_COMPILE_OUTPUT_BYTES, compileTruncationMarker(messages))), goVersion };
  } finally {
    if (tempDir) await cleanupNativeRunTempDir(tempDir);
    if (runId && activeCompiles.get(runId) === active) activeCompiles.delete(runId);
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
export function registerGoHandlers(): void {
  typedHandle('go:detect', async (event, userEnv?: unknown) => {
    if (userEnv !== undefined && !stringMap(userEnv)) return { installed: false, reason: 'check-failed', error: 'Invalid Go environment.' };
    const lifecycle = createNativeRunLifecycle(event.sender);
    try { return await detectGo(userEnv, lifecycle.controller.signal); }
    finally { lifecycle.release(); }
  });
  typedHandle('go:compile', async (event, source: unknown, userEnv?: unknown, messages?: unknown, runId?: unknown) => {
    if (typeof source !== 'string') return failed('Go compiler received invalid source.');
    if ((userEnv !== undefined && !stringMap(userEnv))
      || (messages !== undefined && !stringMap(messages))
      || (runId !== undefined && !validRunId(runId))) return failed('Invalid Go compile request.');
    return compileGoToWasm(source, userEnv, messages, runId, event.sender);
  });
  typedHandle('go:stop', async (event, runId: unknown) => {
    if (!validRunId(runId)) return { stopped: false };
    const active = activeCompiles.get(runId);
    if (!active || active.owner !== event.sender) return { stopped: false };
    active.controller.abort();
    return { stopped: true };
  });
}
