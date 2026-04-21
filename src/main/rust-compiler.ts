/**
 * Rust compilation and execution IPC handler for the main process.
 *
 * Handles:
 * - Detecting local Rust installation (`rustc`)
 * - Compiling Rust source code to a native binary via `rustc`
 * - Running the compiled binary and capturing stdout/stderr
 */

import { ipcMain } from 'electron';
import { execFile, spawn } from 'node:child_process';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

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
 * Merge a user-space env record over `process.env` for the Rust
 * compile + run subprocess. RL-011 Slice D second increment.
 *
 * Unlike Go's compile path there are no runner-owned keys that must
 * be immovable — rustc respects the host toolchain on its own and the
 * spawned binary reads whatever env we hand it. We still drop non-
 * string user values defensively; the renderer's envVarsStore already
 * rejects them up front, but the IPC boundary is untrusted.
 */
export function resolveRustRunEnv(userEnv?: Record<string, string>): NodeJS.ProcessEnv {
  const safeUserEnv: Record<string, string> = {};
  if (userEnv) {
    for (const [key, value] of Object.entries(userEnv)) {
      if (typeof value !== 'string') continue;
      safeUserEnv[key] = value;
    }
  }
  return {
    ...process.env,
    ...safeUserEnv,
  };
}

/** Detect if Rust (rustc) is installed and return version info */
async function detectRust(): Promise<RustDetectResult> {
  try {
    const { stdout } = await execFileAsync('rustc', ['--version']);
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
  userEnv?: Record<string, string>
): Promise<RustRunResult> {
  const rustInfo = await detectRust();
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

  const tempDir = path.join(tmpdir(), `lingua-rust-${Date.now()}`);
  const sourceFile = path.join(tempDir, 'main.rs');
  const binaryFile = path.join(
    tempDir,
    process.platform === 'win32' ? 'main.exe' : 'main'
  );

  try {
    await mkdir(tempDir, { recursive: true });
    await writeFile(sourceFile, sourceCode, 'utf-8');

    // RL-011 Slice D — resolve once and use for both compile + spawn
    // so `rustc` and the user binary see the same environment.
    const mergedEnv = resolveRustRunEnv(userEnv);

    // --- Compile ---
    const compileStart = Date.now();
    try {
      await execFileAsync('rustc', [sourceFile, '-o', binaryFile], {
        env: mergedEnv,
        timeout: 60_000, // compilation can be slow on first run
      });
    } catch (compileErr) {
      const stderr =
        (compileErr as { stderr?: string })?.stderr ?? String(compileErr);
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

      const child = spawn(binaryFile, [], { env: mergedEnv, timeout: 30_000 });

      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString();
      });

      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
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
  ipcMain.handle('rust:detect', async () => detectRust());

  ipcMain.handle(
    'rust:run',
    async (_event, sourceCode: string, userEnv?: Record<string, string>) =>
      runRustCode(sourceCode, userEnv),
  );
}
