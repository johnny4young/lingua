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
import { execFile } from 'node:child_process';
import { writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import {
  MAX_COMPILE_OUTPUT_BYTES,
  MAX_NATIVE_STDERR_BYTES,
  truncateBytes,
} from '../shared/runnerLimits';
import {
  RUST_TOOLCHAIN_KEYS,
  buildNativeRunnerEnv,
  combinedAllowlist,
} from './runners/nativeEnv';
import { spawnNativeRun } from './runners/spawnNativeRun';

const execFileAsync = promisify(execFile);

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

interface RustDetectResult {
  installed: boolean;
  version?: string;
  error?: string;
}

interface RustRunResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
  executionTime: number;
  error?: string;
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

/** Detect if Rust (rustc) is installed and return version info */
async function detectRust(userEnv?: Record<string, string>): Promise<RustDetectResult> {
  const cacheable = userEnv === undefined;
  if (cacheable && cachedRustDetect) return cachedRustDetect;
  try {
    const { stdout } = await execFileAsync('rustc', ['--version'], {
      env: resolveRustRunEnv(userEnv),
      // A hung rustup shim must not wedge the detect IPC promise forever.
      // Matches the LSP launchers' 5s probe convention.
      timeout: 5_000,
    });
    const result: RustDetectResult = { installed: true, version: stdout.trim() };
    if (cacheable) cachedRustDetect = result;
    return result;
  } catch {
    return {
      installed: false,
      error: 'Rust is not installed. Install it from https://rustup.rs',
    };
  }
}

/** Test seam — drop the session detect cache between cases. */
export function resetRustDetectCacheForTests(): void {
  cachedRustDetect = null;
}

/** Compile and run Rust source code natively */
async function runRustCode(
  sourceCode: string,
  userEnv?: Record<string, string>,
  messages?: NativeRunnerMessages
): Promise<RustRunResult> {
  const rustInfo = await detectRust(userEnv);
  if (!rustInfo.installed) {
    return {
      success: false,
      stdout: '',
      stderr: rustInfo.error ?? 'Rust is not installed.',
      exitCode: -1,
      executionTime: 0,
      error: rustInfo.error,
    };
  }

  // internal — `mkdtemp` returns a unique directory under the OS temp
  // root with 6 random suffix chars, eliminating the collision window
  // a `Date.now()` filename would leave open for two concurrent runs.
  const tempDir = await mkdtemp(path.join(tmpdir(), 'lingua-rust-'));
  const sourceFile = path.join(tempDir, 'main.rs');
  const binaryFile = path.join(
    tempDir,
    process.platform === 'win32' ? 'main.exe' : 'main'
  );

  try {
    await writeFile(sourceFile, sourceCode, 'utf-8');

    const mergedEnv = resolveRustRunEnv(userEnv);
    const markers = truncationMarkers(messages);

    // --- Compile ---
    const compileStart = Date.now();
    try {
      await execFileAsync(
        'rustc',
        ['--edition', RUST_EDITION, sourceFile, '-o', binaryFile],
        {
          env: mergedEnv,
          timeout: 60_000, // compilation can be slow on first run
        }
      );
    } catch (compileErr) {
      const stderrRaw =
        (compileErr as { stderr?: string })?.stderr ?? String(compileErr);
      const stderr = truncateBytes(
        stderrRaw,
        MAX_COMPILE_OUTPUT_BYTES,
        markers.compile
      );
      return {
        success: false,
        stdout: '',
        stderr,
        exitCode: 1,
        executionTime: Date.now() - compileStart,
        error: stderr,
      };
    }

    // --- Execute ---
    // Process-group leader on POSIX so the timeout can fell the whole
    // tree (user binaries that fork/spawn), with SIGTERM → SIGKILL
    // escalation — spawn's built-in `timeout` option only ever sent a
    // single SIGTERM, which a signal-ignoring binary survives forever.
    // No stdin management here: a freshly-compiled binary is not fed
    // input, so we leave the child's stdin untouched.
    const run = await spawnNativeRun({
      command: binaryFile,
      args: [],
      env: mergedEnv,
      timeoutMs: RUST_RUN_TIMEOUT_MS,
      killEscalationMs: KILL_ESCALATION_DELAY_MS,
      maxOutputBytes: MAX_NATIVE_STDERR_BYTES,
      stdoutTruncationMarker: markers.stdout,
      stderrTruncationMarker: markers.stderr,
    });

    if (run.spawnError) {
      return {
        success: false,
        stdout: run.stdout,
        stderr: run.spawnError.message,
        exitCode: -1,
        executionTime: run.executionTime,
        error: run.spawnError.message,
      };
    }

    return {
      success: run.exitCode === 0,
      stdout: run.stdout,
      stderr: run.stderr,
      exitCode: run.exitCode,
      executionTime: run.executionTime,
      error:
        run.exitCode !== 0
          ? run.stderr || `Process exited with code ${run.exitCode}`
          : undefined,
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

/** Register all Rust-related IPC handlers */
export function registerRustHandlers(): void {
  typedHandle('rust:detect', async (_event, userEnv?: Record<string, string>) =>
    detectRust(userEnv)
  );

  typedHandle(
    'rust:run',
    async (
      _event,
      sourceCode: string,
      userEnv?: Record<string, string>,
      messages?: NativeRunnerMessages
    ) => runRustCode(sourceCode, userEnv, messages),
  );
}
