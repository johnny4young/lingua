/**
 * implementation — desktop Deno & Bun execution backends.
 *
 * Deno and Bun both run JavaScript AND TypeScript directly (no separate
 * transpile step), so a single generic runner drives both — parameterized
 * by the binary name and its argv builder. The security posture matches
 * node-runner.ts / ruby-runner.ts exactly:
 *
 *   - `spawn()` only, never a shell. Source is written to a temp file
 *     under `mkdtemp()` and passed by path — no command-line interpolation.
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
 * runtime-mode surface as Worker / Node / Browser Preview. Each renderer
 * runner still self-gates on bridge availability and binary detection so
 * web builds and hosts without the toolchain degrade with actionable errors.
 */

import { typedHandle } from './ipc/typedHandle';
import {
  execFile,
  spawn,
  type ChildProcessWithoutNullStreams,
} from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { MAX_NATIVE_STDERR_BYTES, truncateBytes } from '../shared/runnerLimits';
import { buildNativeRunnerEnv, combinedAllowlist } from './runners/nativeEnv';
import { detachedSpawnOptions, killProcessTree } from './runners/processTree';

const execFileAsync = promisify(execFile);

const KILL_ESCALATION_DELAY_MS = 200;
const DEFAULT_TIMEOUT_MS = 30_000;
const STDOUT_TRUNCATION_MARKER = '\n[stdout truncated]';
const STDERR_TRUNCATION_MARKER = '\n[stderr truncated]';

export type AltJsRuntimeId = 'deno' | 'bun';
export type AltJsRunKind = 'success' | 'error' | 'timeout' | 'stopped' | 'missing-binary';

export interface AltJsDetectResult {
  installed: boolean;
  version?: string;
  error?: string;
}

export interface AltJsRunOptions {
  runId?: string;
  timeoutMs?: number;
  language?: string;
  userEnv?: Record<string, string>;
}

export interface AltJsRunResult {
  kind: AltJsRunKind;
  stdout: string;
  stderr: string;
  exitCode: number;
  executionTime: number;
  error?: string;
  timeoutMs: number;
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
    toolchainKeys: ['DENO_DIR'],
  },
  bun: {
    binary: 'bun',
    installHint: 'Bun is not installed. Install it from https://bun.sh',
    ext: (language) => (language === 'typescript' ? 'ts' : 'js'),
    runArgs: (entryFile) => ['run', entryFile],
    // BUN_INSTALL anchors the per-user cache; nothing else leaks.
    toolchainKeys: ['BUN_INSTALL'],
  },
};

const detectCache = new Map<AltJsRuntimeId, AltJsDetectResult>();
const activeRuns = new Map<string, () => void>();

function resolveEnv(id: AltJsRuntimeId, userEnv?: Record<string, string>): NodeJS.ProcessEnv {
  return buildNativeRunnerEnv(combinedAllowlist(CONFIGS[id].toolchainKeys), userEnv);
}

export async function detectAltRuntime(
  id: AltJsRuntimeId,
  userEnv?: Record<string, string>,
  force = false
): Promise<AltJsDetectResult> {
  const cacheable = userEnv === undefined;
  if (cacheable && !force) {
    const cached = detectCache.get(id);
    if (cached) return cached;
  }
  let result: AltJsDetectResult;
  try {
    const { stdout } = await execFileAsync(CONFIGS[id].binary, ['--version'], {
      env: resolveEnv(id, userEnv),
      timeout: 5_000,
    });
    result = { installed: true, version: stdout.trim().split('\n')[0] };
  } catch {
    result = { installed: false, error: CONFIGS[id].installHint };
  }
  if (cacheable) detectCache.set(id, result);
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
  options: AltJsRunOptions
): Promise<AltJsRunResult> {
  const config = CONFIGS[id];
  const timeoutMs = clampTimeout(options.timeoutMs);
  const env = resolveEnv(id, options.userEnv);
  const tempDir = await mkdtemp(path.join(tmpdir(), `lingua-${id}-`));
  const entryFile = path.join(tempDir, `entry.${config.ext(options.language)}`);

  try {
    await writeFile(entryFile, source, 'utf-8');
  } catch (err) {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
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

  return await new Promise<AltJsRunResult>((resolve) => {
    const start = Date.now();
    let stdout = '';
    let stderr = '';
    let stdoutTruncated = false;
    let stderrTruncated = false;
    let resolved = false;
    let kind: AltJsRunKind = 'success';
    let killedByTimer = false;
    let stoppedByUser = false;
    let escalationTimer: NodeJS.Timeout | null = null;

    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(config.binary, config.runArgs(entryFile, tempDir), {
        cwd: tempDir,
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
        ...detachedSpawnOptions(),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      void rm(tempDir, { recursive: true, force: true }).finally(() => {
        resolve({
          kind: 'error',
          stdout,
          stderr: message,
          exitCode: -1,
          executionTime: Date.now() - start,
          error: message,
          timeoutMs,
        });
      });
      return;
    }

    const terminate = (next: 'timeout' | 'stopped') => {
      if (resolved) return;
      if (next === 'timeout') killedByTimer = true;
      else stoppedByUser = true;
      kind = next;
      killProcessTree(child, 'SIGTERM');
      if (escalationTimer === null) {
        escalationTimer = setTimeout(() => killProcessTree(child, 'SIGKILL'), KILL_ESCALATION_DELAY_MS);
      }
    };

    if (options.runId) activeRuns.set(options.runId, () => terminate('stopped'));

    child.stdin.on('error', () => {
      /* EPIPE — child exited before stdin flush. */
    });
    try {
      child.stdin.end();
    } catch {
      /* already closed */
    }

    child.stdout.on('data', (chunk: Buffer) => {
      if (stdoutTruncated) return;
      stdout += chunk.toString();
      if (stdout.length > MAX_NATIVE_STDERR_BYTES) {
        stdout = truncateBytes(stdout, MAX_NATIVE_STDERR_BYTES, STDOUT_TRUNCATION_MARKER);
        stdoutTruncated = true;
      }
    });
    child.stderr.on('data', (chunk: Buffer) => {
      if (stderrTruncated) return;
      stderr += chunk.toString();
      if (stderr.length > MAX_NATIVE_STDERR_BYTES) {
        stderr = truncateBytes(stderr, MAX_NATIVE_STDERR_BYTES, STDERR_TRUNCATION_MARKER);
        stderrTruncated = true;
      }
    });

    const killTimer = setTimeout(() => terminate('timeout'), timeoutMs);

    const finish = async (result: AltJsRunResult) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(killTimer);
      if (escalationTimer !== null) clearTimeout(escalationTimer);
      if (options.runId) activeRuns.delete(options.runId);
      await rm(tempDir, { recursive: true, force: true }).catch(() => {});
      resolve(result);
    };

    child.on('close', (code: number | null) => {
      const exitCode = code ?? -1;
      if (!killedByTimer && !stoppedByUser && exitCode !== 0) kind = 'error';
      const errorText =
        kind === 'timeout'
          ? `Run timed out after ${Math.round(timeoutMs / 1000)}s`
          : kind === 'error'
            ? stderr || `Process exited with code ${exitCode}`
            : undefined;
      void finish({ kind, stdout, stderr, exitCode, executionTime: Date.now() - start, error: errorText, timeoutMs });
    });

    child.on('error', (err: Error) => {
      const message = err.message || `Failed to spawn ${config.binary}`;
      const missing: AltJsRunKind =
        /ENOENT/.test(message) || /not found/i.test(message) ? 'missing-binary' : 'error';
      void finish({
        kind: missing,
        stdout,
        stderr: stderr || message,
        exitCode: -1,
        executionTime: Date.now() - start,
        error: message,
        timeoutMs,
      });
    });
  });
}

export async function runAltRuntime(
  id: AltJsRuntimeId,
  source: string,
  options: AltJsRunOptions
): Promise<AltJsRunResult> {
  const detect = await detectAltRuntime(id, options.userEnv);
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
  return spawnAltRuntime(id, source, options);
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

export function normalizeAltRunOptions(value: unknown): AltJsRunOptions {
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
  typedHandle('deno:run', async (_event, source: string, options?: AltJsRunInvokeOptions) =>
    typeof source === 'string'
      ? runAltRuntime('deno', source, normalizeAltRunOptions(options))
      : invalidSourceResult('deno')
  );
  typedHandle('deno:stop', async (_event, runId: string) => stopAltRun(runId));

  typedHandle('bun:detect', async (_event, userEnv?: Record<string, string>, force?: boolean) =>
    detectAltRuntime('bun', userEnv, force === true)
  );
  typedHandle('bun:run', async (_event, source: string, options?: AltJsRunInvokeOptions) =>
    typeof source === 'string'
      ? runAltRuntime('bun', source, normalizeAltRunOptions(options))
      : invalidSourceResult('bun')
  );
  typedHandle('bun:stop', async (_event, runId: string) => stopAltRun(runId));
}
