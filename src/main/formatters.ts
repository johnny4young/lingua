/**
 * Format IPC handlers for gofmt, rustfmt, and Python (ruff with black fallback).
 *
 * - Detects the binary lazily and caches the result for the process lifetime
 * - Pipes source via stdin to avoid creating temp files on the filesystem
 * - Never throws — returns a discriminated result so the renderer can surface
 *   missing binaries with actionable messages without crashing the save path
 */

import { ipcMain } from 'electron';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { buildNativeRunnerEnv, combinedAllowlist } from './runners/nativeEnv';

const execFileAsync = promisify(execFile);
const FORMATTER_TOOLCHAIN_KEYS = combinedAllowlist([]);
const MAX_FORMATTER_OUTPUT_BYTES = 1024 * 1024;

export function resolveFormatterEnv(): NodeJS.ProcessEnv {
  return buildNativeRunnerEnv(FORMATTER_TOOLCHAIN_KEYS, undefined);
}

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
    await execFileAsync(binary, ['--version'], { env: resolveFormatterEnv() });
    availabilityCache.set(binary, true);
    return true;
  } catch {
    availabilityCache.set(binary, false);
    return false;
  }
}

interface CappedCapture {
  text: string;
  bytes: number;
  truncated: boolean;
}

function appendCapped(capture: CappedCapture, chunk: Buffer): void {
  const remaining = MAX_FORMATTER_OUTPUT_BYTES - capture.bytes;
  if (remaining <= 0) {
    capture.truncated = true;
    return;
  }
  if (chunk.length > remaining) {
    capture.text += chunk.subarray(0, remaining).toString();
    capture.bytes += remaining;
    capture.truncated = true;
    return;
  }
  capture.text += chunk.toString();
  capture.bytes += chunk.length;
}

function formatFailureText(
  stderr: CappedCapture,
  fallback: string
): string {
  const text = stderr.text.trim() || fallback;
  return stderr.truncated
    ? `${text}\n[formatter stderr truncated at ${MAX_FORMATTER_OUTPUT_BYTES} bytes]`
    : text;
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
      env: resolveFormatterEnv(),
    });

    const stdout: CappedCapture = { text: '', bytes: 0, truncated: false };
    const stderr: CappedCapture = { text: '', bytes: 0, truncated: false };

    child.stdout.on('data', (chunk: Buffer) => {
      appendCapped(stdout, chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      appendCapped(stderr, chunk);
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
        if (stdout.truncated) {
          resolve({
            available: true,
            success: false,
            error: `Formatter output exceeded ${MAX_FORMATTER_OUTPUT_BYTES} byte limit.`,
          });
          return;
        }
        resolve({ available: true, success: true, formatted: stdout.text });
        return;
      }

      resolve({
        available: true,
        success: false,
        error: formatFailureText(
          stderr,
          `Formatter exited with code ${code ?? -1}`
        ),
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

/**
 * Python formatting prefers `ruff format` (single binary, no deps, fast) and
 * falls back to `black` when ruff is not installed. Both binaries support
 * stdin → stdout with `-` as the target, so the runner contract is identical.
 */
async function formatWithPython(source: string): Promise<FormatIpcResult> {
  if (await isBinaryAvailable('ruff')) {
    return runFormatter('ruff', ['format', '-'], source);
  }
  if (await isBinaryAvailable('black')) {
    return runFormatter('black', ['--quiet', '-'], source);
  }
  return {
    available: false,
    reason: 'binary-missing',
    error:
      'No Python formatter available on PATH. Install ruff (https://docs.astral.sh/ruff/) or black (https://pypi.org/project/black/) to enable Python formatting.',
  };
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
  ipcMain.handle('format:python', async (_event, source: string) =>
    formatWithPython(source)
  );
}
