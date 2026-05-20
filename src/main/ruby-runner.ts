/**
 * RL-042 Slice 6 — desktop Ruby child-spawn backend.
 *
 * The renderer-side `DesktopRubySubprocessRunner` (folded into
 * `src/renderer/runners/ruby.ts`) calls
 * `window.lingua.ruby.run(source, options)` and the preload bridge
 * forwards to `ipcMain.handle('ruby:run', ...)` registered by
 * `registerRubyHandlers()` below.
 *
 * Security posture (same shape as node-runner.ts and rust-compiler.ts):
 *
 *   - `spawn()` only — never the shell-evaluating sibling. User code
 *     is written to a freshly-created temp file under `mkdtemp()` and
 *     passed by path. We never interpolate user input into a shell
 *     command line, so command injection is impossible at this layer.
 *   - Env: `buildNativeRunnerEnv(combinedAllowlist(RUBY_TOOLCHAIN_KEYS),
 *     userEnv)`. RL-079 allowlist + RL-011 user-tier env.
 *     Lingua's full host env is NOT forwarded.
 *   - Cwd: `path.dirname(filePath)` for saved tabs, `app.getPath('temp')`
 *     for Scratchpad. Fold D walks up looking for a `.ruby-version` file
 *     and threads the discovered version through `RBENV_VERSION` /
 *     PATH so per-project pins are honored on the desktop without
 *     needing rbenv shell-init.
 *   - Timeout: parent-owned. The renderer sets a per-call timeout; we
 *     send SIGTERM and escalate to SIGKILL after `KILL_ESCALATION_DELAY_MS`
 *     if the child has not exited (fold E).
 *   - Output caps: stdout / stderr each capped at
 *     `MAX_NATIVE_STDERR_BYTES` (1 MiB) with the existing
 *     `truncateBytes` helper.
 *
 * Folds shipped here:
 *
 *   - Fold A — `parseRubyVersion()` shape parser returned alongside
 *     `RubyDetectResult` so the Settings row can display "Ruby 3.3.6"
 *     instead of the full `ruby --version` line.
 *   - Fold D — per-project `.ruby-version` discovery. Walks up to 8
 *     directories from the tab's `filePath`, reads the version pin,
 *     and threads it as `RBENV_VERSION` on the spawned process. If
 *     rbenv isn't installed, the version still influences the version
 *     the user sees in the status notice.
 *   - Fold E — SIGTERM → SIGKILL escalation with a 1.5 s grace
 *     window (longer than node-runner's 200 ms because Ruby's
 *     `at_exit` hooks tend to run a beat slower).
 */

import { ipcMain, app } from 'electron';
import * as childProc from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import {
  MAX_NATIVE_STDERR_BYTES,
  truncateBytes,
} from '../shared/runnerLimits';
import {
  RUBY_TOOLCHAIN_KEYS,
  buildNativeRunnerEnv,
  combinedAllowlist,
} from './runners/nativeEnv';

const execFileAsync = promisify(childProc.execFile);

/**
 * Fold E — SIGTERM → SIGKILL escalation window. Ruby's `at_exit` and
 * `ensure` blocks often need more than node-runner's 200 ms to drain
 * (especially when the user's code holds open file handles), so we
 * give 1500 ms before pulling the rug. The window is still short
 * enough that a Stop button feels responsive.
 */
const KILL_ESCALATION_DELAY_MS = 1500;

/** Default parent-owned timeout for a single Ruby run. */
const DEFAULT_RUBY_TIMEOUT_MS = 30_000;

const RUNTIME_STDOUT_TRUNCATION_MARKER = '\n[stdout truncated]';
const RUNTIME_STDERR_TRUNCATION_MARKER = '\n[stderr truncated]';

function truncationMarkers(messages?: NativeRunnerMessages) {
  return {
    stdout: messages?.stdoutTruncated
      ? `\n${messages.stdoutTruncated}`
      : RUNTIME_STDOUT_TRUNCATION_MARKER,
    stderr: messages?.stderrTruncated
      ? `\n${messages.stderrTruncated}`
      : RUNTIME_STDERR_TRUNCATION_MARKER,
  };
}

export type RubyRunKind =
  | 'success'
  | 'error'
  | 'timeout'
  | 'stopped'
  | 'missing-binary';

export interface RubyDetectResult {
  installed: boolean;
  /** Full `ruby --version` line, e.g. `ruby 3.3.6 (...) [arm64-darwin23]`. */
  version?: string;
  /** Fold A — parsed semver, e.g. `3.3.6`. Absent when parsing fails. */
  semver?: string;
  /** Fold A — parsed platform, e.g. `arm64-darwin23`. */
  platform?: string;
  error?: string;
}

export interface RubyRunOptions {
  /** Renderer-minted correlation id. Lets `ruby:stop` terminate the exact child. */
  runId?: string;
  /** Per-call timeout (ms). Defaults to 30 s when omitted. */
  timeoutMs?: number;
  /** Source-file path of the active tab. `undefined` for Scratchpad. */
  filePath?: string;
  /** Per-run user-env tier from RL-011. */
  userEnv?: Record<string, string>;
  /** Stdin buffer. Empty / undefined closes stdin immediately. */
  stdin?: string;
  /** I18n-keyed truncation markers. */
  messages?: NativeRunnerMessages;
}

export interface RubyRunResult {
  kind: RubyRunKind;
  stdout: string;
  stderr: string;
  exitCode: number;
  executionTime: number;
  error?: string;
  /** Echoed back so the renderer's `<RunStatusPill>` tooltip can name the budget. */
  timeoutMs: number;
}

let cachedDetect: RubyDetectResult | null = null;
const activeRubyRuns = new Map<string, () => void>();

/**
 * Fold A — parse a `ruby --version` line into structured fields.
 *
 * Examples we accept:
 *   - `ruby 3.3.6 (2024-11-05 revision 75015a4f5e) [arm64-darwin23]`
 *   - `ruby 3.2.2p53 (2023-03-30 revision e51014f9c0) [x86_64-linux]`
 *   - `ruby 2.7.6p219 (2022-04-12 revision c9c2245c0a) [x86_64-darwin19]`
 *
 * Returns `{ semver, platform }` when both can be extracted, else
 * partial / empty so callers can still display the raw line.
 */
export function parseRubyVersion(line: string): { semver?: string; platform?: string } {
  const trimmed = line.trim();
  const semverMatch = trimmed.match(/^ruby\s+(\d+\.\d+\.\d+)/);
  const platformMatch = trimmed.match(/\[([^\]]+)\]\s*$/);
  return {
    ...(semverMatch ? { semver: semverMatch[1] } : {}),
    ...(platformMatch ? { platform: platformMatch[1] } : {}),
  };
}

/**
 * Probe the local `ruby` binary. Result cached per main-process
 * lifetime; the renderer can force a refresh by passing `force=true`
 * (Settings → "Ruby runtime" → re-detect button).
 */
export async function detectRuby(
  userEnv?: Record<string, string>,
  force = false
): Promise<RubyDetectResult> {
  const cacheable = userEnv === undefined;
  if (cacheable && !force && cachedDetect) return cachedDetect;
  let result: RubyDetectResult;
  try {
    const { stdout } = await execFileAsync('ruby', ['--version'], {
      env: resolveRubyRunEnv(userEnv),
    });
    const version = stdout.trim();
    const { semver, platform } = parseRubyVersion(version);
    result = {
      installed: true,
      version,
      ...(semver ? { semver } : {}),
      ...(platform ? { platform } : {}),
    };
  } catch {
    result = {
      installed: false,
      error: 'Ruby is not installed. Install it from https://www.ruby-lang.org/en/downloads/',
    };
  }
  if (cacheable) cachedDetect = result;
  return result;
}

export function resolveRubyRunEnv(
  userEnv?: Record<string, string>,
  overrides: Record<string, string> = {}
): NodeJS.ProcessEnv {
  return buildNativeRunnerEnv(
    combinedAllowlist(RUBY_TOOLCHAIN_KEYS),
    userEnv,
    overrides
  );
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

function normalizeNativeMessages(value: unknown): NativeRunnerMessages | undefined {
  if (!isRecord(value)) return undefined;
  return {
    ...(typeof value.stdoutTruncated === 'string'
      ? { stdoutTruncated: value.stdoutTruncated }
      : {}),
    ...(typeof value.stderrTruncated === 'string'
      ? { stderrTruncated: value.stderrTruncated }
      : {}),
  };
}

function normalizeRunId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 128) return undefined;
  return trimmed;
}

function normalizeRubyRunOptions(value: unknown): RubyRunOptions {
  if (!isRecord(value)) return {};
  return {
    runId: normalizeRunId(value.runId),
    timeoutMs:
      typeof value.timeoutMs === 'number' ? value.timeoutMs : undefined,
    filePath: typeof value.filePath === 'string' ? value.filePath : undefined,
    userEnv: normalizeStringMap(value.userEnv),
    stdin: typeof value.stdin === 'string' ? value.stdin : undefined,
    messages: normalizeNativeMessages(value.messages),
  };
}

function invalidRubyRunResult(message: string): RubyRunResult {
  return {
    kind: 'error',
    stdout: '',
    stderr: message,
    exitCode: -1,
    executionTime: 0,
    error: message,
    timeoutMs: DEFAULT_RUBY_TIMEOUT_MS,
  };
}

/**
 * Fold D — discover a per-project `.ruby-version` pin. Walks up to 8
 * directories from `startDir` looking for the dotfile. Returns the
 * trimmed first line when found (rbenv / asdf both write the version
 * on the first line). Returns `null` for Scratchpad tabs (no
 * `filePath`) or when no pin exists anywhere up the tree.
 */
export function findRubyVersionFile(filePath?: string): string | null {
  if (!filePath) return null;
  let dir = path.dirname(filePath);
  for (let depth = 0; depth < 8; depth += 1) {
    const candidate = path.join(dir, '.ruby-version');
    if (existsSync(candidate)) {
      try {
        const raw = readFileSync(candidate, 'utf-8');
        const firstLine = raw.split('\n')[0]?.trim();
        if (firstLine && firstLine.length > 0 && firstLine.length <= 64) {
          // Defensive: reject anything that looks like a path injection
          // or non-version glob. rbenv accepts strings like `3.3.6`,
          // `ruby-3.3.6`, `truffleruby-23.0.0`, `system`. Anything with
          // a path separator is suspicious.
          if (!/[/\\]/.test(firstLine)) return firstLine;
        }
      } catch {
        // Unreadable .ruby-version — fall through to the next parent.
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/**
 * Pick the cwd for the spawned `ruby` process. Saved tabs use the
 * file's directory so relative `require_relative` paths resolve;
 * Scratchpad falls back to the OS temp directory.
 */
export function resolveRubyCwd(filePath?: string): string {
  if (filePath) return path.dirname(filePath);
  return app.getPath('temp');
}

async function spawnRuby(source: string, options: RubyRunOptions): Promise<RubyRunResult> {
  const timeoutMs = clampTimeout(options.timeoutMs);
  const cwd = resolveRubyCwd(options.filePath);

  // Fold D — thread the discovered .ruby-version through RBENV_VERSION
  // so rbenv shims pick the right interpreter. Without rbenv installed,
  // RBENV_VERSION is silently ignored by the spawned `ruby` and we just
  // fall back to whichever binary `PATH` resolved.
  const rubyVersionPin = findRubyVersionFile(options.filePath);
  const env = resolveRubyRunEnv(
    options.userEnv,
    rubyVersionPin ? { RBENV_VERSION: rubyVersionPin, ASDF_RUBY_VERSION: rubyVersionPin } : {}
  );
  const markers = truncationMarkers(options.messages);

  // Always write source to a tempfile + pass by path. `-e` would mangle
  // multi-line heredocs and quoting edge cases; the tempfile path is
  // robust on all platforms.
  const tempDir = await mkdtemp(path.join(tmpdir(), 'lingua-ruby-'));
  const tempFile = path.join(tempDir, 'script.rb');
  await writeFile(tempFile, source, 'utf-8');
  const args = [tempFile];

  return await new Promise<RubyRunResult>((resolve) => {
    const start = Date.now();
    let stdout = '';
    let stderr = '';
    let stdoutTruncated = false;
    let stderrTruncated = false;
    let resolved = false;
    let kind: RubyRunKind = 'success';
    let killedByTimer = false;
    let stoppedByUser = false;
    let escalationTimer: NodeJS.Timeout | null = null;

    const child = childProc.spawn('ruby', args, {
      cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const terminateChild = (nextKind: 'timeout' | 'stopped') => {
      if (resolved) return;
      if (nextKind === 'timeout') {
        killedByTimer = true;
      } else {
        stoppedByUser = true;
      }
      kind = nextKind;
      try {
        child.kill('SIGTERM');
      } catch {
        // Already exited.
      }
      if (escalationTimer === null) {
        escalationTimer = setTimeout(() => {
          try {
            child.kill('SIGKILL');
          } catch {
            // Already exited.
          }
        }, KILL_ESCALATION_DELAY_MS);
      }
    };

    if (options.runId) {
      activeRubyRuns.set(options.runId, () => terminateChild('stopped'));
    }

    // Stdin: forward the pre-set buffer (Slice 6 fold-style — same as
    // Node + Pyodide). Empty / undefined closes immediately so user
    // code that reads stdin without an end handler hits EOF on first
    // `gets` call (stock Ruby behavior).
    try {
      if (options.stdin && options.stdin.length > 0) {
        child.stdin.write(options.stdin);
      }
      child.stdin.end();
    } catch {
      // stdin may already be closed if the child crashed during boot.
    }

    child.stdout.on('data', (chunk: Buffer) => {
      if (stdoutTruncated) return;
      stdout += chunk.toString();
      if (stdout.length > MAX_NATIVE_STDERR_BYTES) {
        stdout = truncateBytes(stdout, MAX_NATIVE_STDERR_BYTES, markers.stdout);
        stdoutTruncated = true;
      }
    });

    child.stderr.on('data', (chunk: Buffer) => {
      if (stderrTruncated) return;
      stderr += chunk.toString();
      if (stderr.length > MAX_NATIVE_STDERR_BYTES) {
        stderr = truncateBytes(stderr, MAX_NATIVE_STDERR_BYTES, markers.stderr);
        stderrTruncated = true;
      }
    });

    // Parent-owned timeout. Mirrors RL-078's pattern for worker
    // runners — main owns the kill timer; subprocess never schedules
    // its own.
    const killTimer: NodeJS.Timeout = setTimeout(() => {
      terminateChild('timeout');
    }, timeoutMs);

    const finish = (result: RubyRunResult) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(killTimer);
      if (escalationTimer !== null) clearTimeout(escalationTimer);
      if (options.runId) activeRubyRuns.delete(options.runId);
      // Resolve the IPC promise before async tempdir cleanup so a fast
      // follow-up run cannot be delayed behind filesystem teardown. Cleanup
      // failures are non-fatal because the temp directory is disposable.
      resolve(result);
      void rm(tempDir, { recursive: true, force: true }).catch(() => {});
    };

    child.on('close', (code: number | null) => {
      const exitCode = code ?? -1;
      const executionTime = Date.now() - start;
      if (!killedByTimer && !stoppedByUser && exitCode !== 0) {
        kind = 'error';
      }
      const errorText =
        kind === 'timeout'
          ? `Run timed out after ${Math.round(timeoutMs / 1000)}s`
          : kind === 'error'
            ? stderr || `Process exited with code ${exitCode}`
            : undefined;
      void finish({
        kind,
        stdout,
        stderr,
        exitCode,
        executionTime,
        error: errorText,
        timeoutMs,
      });
    });

    child.on('error', (err: Error) => {
      // `error` fires on spawn failure (e.g. ENOENT when `ruby` is not
      // on PATH). Surface as `missing-binary` so the renderer renders
      // the right copy + falls back to the WASM worker.
      const executionTime = Date.now() - start;
      const message = err.message || 'Failed to spawn ruby';
      const missing: RubyRunKind =
        /ENOENT/.test(message) || /not found/i.test(message)
          ? 'missing-binary'
          : 'error';
      void finish({
        kind: missing,
        stdout,
        stderr: stderr || message,
        exitCode: -1,
        executionTime,
        error: message,
        timeoutMs,
      });
    });
  });
}

function clampTimeout(timeoutMs: number | undefined): number {
  if (typeof timeoutMs !== 'number' || !Number.isFinite(timeoutMs)) {
    return DEFAULT_RUBY_TIMEOUT_MS;
  }
  if (timeoutMs < 100) return 100;
  // Hard ceiling matches the runtimeTimeoutPresets `extended` (5 min).
  if (timeoutMs > 5 * 60 * 1000) return 5 * 60 * 1000;
  return Math.floor(timeoutMs);
}

async function runRubyCode(
  source: string,
  options: RubyRunOptions
): Promise<RubyRunResult> {
  const detect = await detectRuby(options.userEnv);
  if (!detect.installed) {
    return {
      kind: 'missing-binary',
      stdout: '',
      stderr: detect.error ?? 'Ruby is not installed.',
      exitCode: -1,
      executionTime: 0,
      error: detect.error,
      timeoutMs: clampTimeout(options.timeoutMs),
    };
  }
  return spawnRuby(source, options);
}

export function stopRubyRun(runId: unknown): { stopped: boolean } {
  const normalizedRunId = normalizeRunId(runId);
  if (!normalizedRunId) return { stopped: false };
  const stop = activeRubyRuns.get(normalizedRunId);
  if (!stop) return { stopped: false };
  stop();
  return { stopped: true };
}

/** Register all Ruby-related IPC handlers. */
export function registerRubyHandlers(): void {
  ipcMain.handle(
    'ruby:detect',
    async (_event, userEnv?: unknown, force?: unknown) =>
      detectRuby(normalizeStringMap(userEnv), force === true)
  );
  ipcMain.handle(
    'ruby:run',
    async (_event, source: unknown, options?: unknown) => {
      if (typeof source !== 'string') {
        return invalidRubyRunResult('Ruby runner received invalid source.');
      }
      return runRubyCode(source, normalizeRubyRunOptions(options));
    }
  );
  ipcMain.handle('ruby:stop', async (_event, runId?: unknown) =>
    stopRubyRun(runId)
  );
}

/**
 * Test-only: reset the detection cache. Imported by
 * `tests/main/ruby-runner.test.ts`.
 */
export function __resetRubyDetectCache(): void {
  cachedDetect = null;
  activeRubyRuns.clear();
}
