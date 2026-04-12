/**
 * Go compilation IPC handler for the main process.
 *
 * Handles:
 * - Detecting local Go installation
 * - Compiling Go source code to WASM using GOOS=js GOARCH=wasm
 * - Locating wasm_exec.js from the Go installation
 */

import { ipcMain } from 'electron';
import { execFile } from 'node:child_process';
import { writeFile, readFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const WASM_EXEC_RELATIVE_PATHS = [
  ['lib', 'wasm', 'wasm_exec.js'],
  ['misc', 'wasm', 'wasm_exec.js'],
] as const;

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

/** Detect if Go is installed and return version info */
async function detectGo(): Promise<GoDetectResult> {
  try {
    const { stdout } = await execFileAsync('go', ['version']);
    const version = stdout.trim();

    // Get GOROOT for wasm_exec.js
    const { stdout: goRoot } = await execFileAsync('go', ['env', 'GOROOT']);

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

/** Compile Go source code to WASM */
async function compileGoToWasm(sourceCode: string): Promise<GoCompileResult> {
  const goInfo = await detectGo();
  if (!goInfo.installed || !goInfo.goRoot) {
    return {
      success: false,
      error: goInfo.error ?? 'Go is not installed.',
    };
  }

  // Create a temp directory for compilation
  const tempDir = path.join(tmpdir(), `lingua-go-${Date.now()}`);
  const sourceFile = path.join(tempDir, 'main.go');
  const wasmFile = path.join(tempDir, 'main.wasm');

  try {
    await mkdir(tempDir, { recursive: true });

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
      env: {
        ...process.env,
        GOOS: 'js',
        GOARCH: 'wasm',
      },
      timeout: 30_000,
    });

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
    const errorMsg = stderr ?? message;

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
  ipcMain.handle('go:detect', async () => {
    return detectGo();
  });

  ipcMain.handle('go:compile', async (_event, sourceCode: string) => {
    return compileGoToWasm(sourceCode);
  });
}
