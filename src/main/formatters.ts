/**
 * Format IPC handlers for gofmt and rustfmt.
 *
 * - Detects the binary lazily and caches the result for the process lifetime
 * - Pipes source via stdin to avoid creating temp files on the filesystem
 * - Never throws — returns a discriminated result so the renderer can surface
 *   missing binaries with actionable messages without crashing the save path
 */

import { ipcMain } from 'electron';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface FormatBinaryMissing {
  available: false;
  reason: 'binary-missing';
  error: string;
}

export interface FormatSuccess {
  available: true;
  success: true;
  formatted: string;
}

export interface FormatFailure {
  available: true;
  success: false;
  error: string;
}

export type FormatIpcResult = FormatBinaryMissing | FormatSuccess | FormatFailure;

const availabilityCache = new Map<string, boolean>();

async function isBinaryAvailable(binary: string): Promise<boolean> {
  const cached = availabilityCache.get(binary);
  if (cached !== undefined) {
    return cached;
  }

  try {
    await execFileAsync(binary, ['--version']);
    availabilityCache.set(binary, true);
    return true;
  } catch {
    availabilityCache.set(binary, false);
    return false;
  }
}

function runFormatter(
  binary: string,
  args: readonly string[],
  source: string
): Promise<FormatIpcResult> {
  return new Promise((resolve) => {
    const child = spawn(binary, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 15_000,
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on('error', (err) => {
      resolve({
        available: true,
        success: false,
        error: err instanceof Error ? err.message : String(err),
      });
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve({ available: true, success: true, formatted: stdout });
        return;
      }

      resolve({
        available: true,
        success: false,
        error: stderr.trim() || `Formatter exited with code ${code ?? -1}`,
      });
    });

    child.stdin.on('error', () => {
      // Swallow EPIPE — the close handler resolves with stderr context
    });

    child.stdin.end(source, 'utf-8');
  });
}

async function formatWithGofmt(source: string): Promise<FormatIpcResult> {
  if (!(await isBinaryAvailable('gofmt'))) {
    return {
      available: false,
      reason: 'binary-missing',
      error:
        'gofmt is not available on PATH. Install Go from https://go.dev/dl/ to enable Go formatting.',
    };
  }
  return runFormatter('gofmt', [], source);
}

async function formatWithRustfmt(source: string): Promise<FormatIpcResult> {
  if (!(await isBinaryAvailable('rustfmt'))) {
    return {
      available: false,
      reason: 'binary-missing',
      error:
        'rustfmt is not available on PATH. Install it via `rustup component add rustfmt` to enable Rust formatting.',
    };
  }
  return runFormatter('rustfmt', ['--emit', 'stdout', '--edition', '2021'], source);
}

/** Primarily for tests — lets suites reset the cached binary probe between cases. */
export function resetFormatterAvailabilityCache(): void {
  availabilityCache.clear();
}

export function registerFormatterHandlers(): void {
  ipcMain.handle('format:gofmt', async (_event, source: string) =>
    formatWithGofmt(source)
  );
  ipcMain.handle('format:rustfmt', async (_event, source: string) =>
    formatWithRustfmt(source)
  );
}
