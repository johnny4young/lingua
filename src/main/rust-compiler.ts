/**
 * Rust compilation and execution IPC handler for the main process.
 *
 * Handles:
 * - Detecting local Rust installation (`rustc`)
 * - Compiling Rust source code to a native binary via `rustc`
 * - Running the compiled binary and capturing stdout/stderr
 *
 * RL-079 — the subprocess env is filtered through
 * `buildNativeRunnerEnv` so secrets in `process.env` (CI tokens,
 * OPENAI_API_KEY, etc.) cannot reach the spawned `rustc` or the
 * compiled user binary. Temp dirs use `mkdtemp` for collision
 * resistance, and stderr / stdout are capped at 1 MiB before being
 * surfaced to the renderer so a runaway compile or runtime cannot
 * flood the IPC channel.
 */

import { ipcMain } from 'electron';
import { execFile, spawn } from 'node:child_process';
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

const execFileAsync = promisify(execFile);

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
 * RL-079: only allowlisted host keys flow through; the user-tier env
 * from RL-011 layers on top. There are no runner-owned overrides for
 * Rust — rustc respects the host toolchain on its own and the
 * spawned binary gets whatever the user explicitly configured.
 */
export function resolveRustRunEnv(
  userEnv?: Record<string, string>
): NodeJS.ProcessEnv {
  return buildNativeRunnerEnv(combinedAllowlist(RUST_TOOLCHAIN_KEYS), userEnv);
}

/** Detect if Rust (rustc) is installed and return version info */
async function detectRust(userEnv?: Record<string, string>): Promise<RustDetectResult> {
  try {
    const { stdout } = await execFileAsync('rustc', ['--version'], {
      env: resolveRustRunEnv(userEnv),
    });
    return { installed: true, version: stdout.trim() };
  } catch {
    return {
      installed: false,
      error: 'Rust is not installed. Install it from https://rustup.rs',
    };
  }
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

  // RL-079 — `mkdtemp` returns a unique directory under the OS temp
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
      await execFileAsync('rustc', [sourceFile, '-o', binaryFile], {
        env: mergedEnv,
        timeout: 60_000, // compilation can be slow on first run
      });
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
    return await new Promise<RustRunResult>((resolve) => {
      const start = Date.now();
      let stdout = '';
      let stderr = '';
      let stdoutTruncated = false;
      let stderrTruncated = false;

      const child = spawn(binaryFile, [], { env: mergedEnv, timeout: 30_000 });

      child.stdout.on('data', (chunk: Buffer) => {
        if (stdoutTruncated) return;
        stdout += chunk.toString();
        if (stdout.length > MAX_NATIVE_STDERR_BYTES) {
          stdout = truncateBytes(
            stdout,
            MAX_NATIVE_STDERR_BYTES,
            markers.stdout
          );
          stdoutTruncated = true;
        }
      });

      child.stderr.on('data', (chunk: Buffer) => {
        if (stderrTruncated) return;
        stderr += chunk.toString();
        if (stderr.length > MAX_NATIVE_STDERR_BYTES) {
          stderr = truncateBytes(
            stderr,
            MAX_NATIVE_STDERR_BYTES,
            markers.stderr
          );
          stderrTruncated = true;
        }
      });

      child.on('close', (code: number | null) => {
        const exitCode = code ?? -1;
        resolve({
          success: exitCode === 0,
          stdout,
          stderr,
          exitCode,
          executionTime: Date.now() - start,
          error:
            exitCode !== 0
              ? stderr || `Process exited with code ${exitCode}`
              : undefined,
        });
      });

      child.on('error', (err: Error) => {
        resolve({
          success: false,
          stdout,
          stderr: err.message,
          exitCode: -1,
          executionTime: Date.now() - start,
          error: err.message,
        });
      });
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

/** Register all Rust-related IPC handlers */
export function registerRustHandlers(): void {
  ipcMain.handle('rust:detect', async (_event, userEnv?: Record<string, string>) =>
    detectRust(userEnv)
  );

  ipcMain.handle(
    'rust:run',
    async (
      _event,
      sourceCode: string,
      userEnv?: Record<string, string>,
      messages?: NativeRunnerMessages
    ) => runRustCode(sourceCode, userEnv, messages),
  );
}
