/**
 * Go compilation IPC handler for the main process.
 *
 * Handles:
 * - Detecting local Go installation
 * - Compiling Go source code to WASM using GOOS=js GOARCH=wasm
 * - Locating wasm_exec.js from the Go installation
 *
 * RL-079 — the toolchain subprocess env is filtered through
 * `buildNativeRunnerEnv` so secrets in `process.env` cannot reach the
 * spawned `go build`. `GOOS=js` and `GOARCH=wasm` are runner-owned
 * overrides that the user env tier cannot shadow. Temp dirs use
 * `mkdtemp` for collision resistance, and compile output is capped at
 * 1 MiB before being surfaced to the renderer.
 */

import { ipcMain } from 'electron';
import { execFile } from 'node:child_process';
import { writeFile, readFile, mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
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

const execFileAsync = promisify(execFile);
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

interface GoCompileResult {
  success: boolean;
  wasmBytes?: number[];
  wasmExecJs?: string;
  error?: string;
  goVersion?: string;
}

interface GoDetectResult {
  installed: boolean;
  version?: string;
  goRoot?: string;
  error?: string;
}

export function getWasmExecCandidatePaths(goRoot: string): string[] {
  return WASM_EXEC_RELATIVE_PATHS.map((segments) => path.join(goRoot, ...segments));
}

export async function readWasmExecJs(
  goRoot: string
): Promise<{ path: string; source: string }> {
  const checkedPaths: string[] = [];

  for (const candidatePath of getWasmExecCandidatePaths(goRoot)) {
    checkedPaths.push(candidatePath);

    try {
      const source = await readFile(candidatePath, 'utf-8');
      return { path: candidatePath, source };
    } catch (error) {
      const errorCode = (error as NodeJS.ErrnoException).code;
      if (errorCode === 'ENOENT') {
        continue;
      }

      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to read Go WASM runtime at "${candidatePath}": ${message}`);
    }
  }

  throw new Error(
    `Go WASM runtime not found for GOROOT "${goRoot}". Checked: ${checkedPaths.join(', ')}`
  );
}

export function resolveGoToolchainEnv(
  userEnv?: Record<string, string>
): NodeJS.ProcessEnv {
  return buildNativeRunnerEnv(combinedAllowlist(GO_TOOLCHAIN_KEYS), userEnv);
}

/** Detect if Go is installed and return version info */
async function detectGo(userEnv?: Record<string, string>): Promise<GoDetectResult> {
  try {
    const env = resolveGoToolchainEnv(userEnv);
    const { stdout } = await execFileAsync('go', ['version'], { env });
    const version = stdout.trim();

    // Get GOROOT for wasm_exec.js
    const { stdout: goRoot } = await execFileAsync('go', ['env', 'GOROOT'], { env });

    return {
      installed: true,
      version,
      goRoot: goRoot.trim(),
    };
  } catch {
    return {
      installed: false,
      error: 'Go is not installed. Install it from https://go.dev/dl/',
    };
  }
}

/**
 * Build the env passed to `go build`.
 *
 * RL-079 + RL-011 contract:
 *  - Only allowlisted host keys flow through (`buildNativeRunnerEnv`).
 *  - User env from RL-011 layers on top.
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

async function compileGoToWasm(
  sourceCode: string,
  userEnv?: Record<string, string>,
  messages?: NativeRunnerMessages
): Promise<GoCompileResult> {
  const goInfo = await detectGo(userEnv);
  if (!goInfo.installed || !goInfo.goRoot) {
    return {
      success: false,
      error: goInfo.error ?? 'Go is not installed.',
    };
  }

  // RL-079 — `mkdtemp` returns a unique directory with 6 random suffix
  // chars, eliminating the collision window a `Date.now()` filename
  // would leave open for two concurrent runs.
  const tempDir = await mkdtemp(path.join(tmpdir(), 'lingua-go-'));
  const sourceFile = path.join(tempDir, 'main.go');
  const wasmFile = path.join(tempDir, 'main.wasm');

  try {
    // Write source code
    await writeFile(sourceFile, sourceCode, 'utf-8');

    // Initialize a temp go module
    await writeFile(
      path.join(tempDir, 'go.mod'),
      'module lingua_temp\n\ngo 1.21\n',
      'utf-8'
    );

    // Compile to WASM
    await execFileAsync('go', ['build', '-o', wasmFile, '.'], {
      cwd: tempDir,
      env: resolveGoCompileEnv(userEnv),
      timeout: 30_000,
    });

    const wasmStat = await stat(wasmFile);
    if (wasmStat.size > MAX_GO_WASM_BYTES) {
      return {
        success: false,
        error: `Compiled Go WASM exceeded ${MAX_GO_WASM_BYTES} byte limit.`,
        goVersion: goInfo.version,
      };
    }

    // Read the compiled WASM
    const wasmBuffer = await readFile(wasmFile);
    const wasmBytes = Array.from(new Uint8Array(wasmBuffer));

    const { source: wasmExecJs } = await readWasmExecJs(goInfo.goRoot);

    return {
      success: true,
      wasmBytes,
      wasmExecJs,
      goVersion: goInfo.version,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    // Try to extract Go compiler error
    const stderr = (err as { stderr?: string })?.stderr;
    const errorMsg = truncateBytes(
      stderr ?? message,
      MAX_COMPILE_OUTPUT_BYTES,
      compileTruncationMarker(messages)
    );

    return {
      success: false,
      error: errorMsg,
      goVersion: goInfo.version,
    };
  } finally {
    // Clean up temp directory
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

/** Register all Go-related IPC handlers */
export function registerGoHandlers(): void {
  ipcMain.handle('go:detect', async (_event, userEnv?: Record<string, string>) => {
    return detectGo(userEnv);
  });

  ipcMain.handle(
    'go:compile',
    async (
      _event,
      sourceCode: string,
      userEnv?: Record<string, string>,
      messages?: NativeRunnerMessages
    ) => {
      return compileGoToWasm(sourceCode, userEnv, messages);
    }
  );
}
