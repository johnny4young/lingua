import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { homedir } from 'node:os';
import { access } from 'node:fs/promises';
import path from 'node:path';
import {
  buildNativeRunnerEnv,
  combinedAllowlist,
  RUST_TOOLCHAIN_KEYS,
} from '../runners/nativeEnv';
import { LspProcess } from './lspProcess';
import type { JsonRpcNotification } from './lspProcess';

/**
 * RL-026 Slice 3 — rust-analyzer launcher.
 *
 * Wraps `LspProcess` with rust-analyzer-specific concerns:
 *   - Detection: PATH lookup first (most common path on macOS/Linux
 *     where rustup symlinks live in `~/.cargo/bin` which is normally
 *     already on PATH), then a defensive fallback to the rustup-
 *     standard `~/.cargo/bin/rust-analyzer` so a non-default shell
 *     (or a launched-from-Finder Electron child whose PATH omits
 *     `~/.cargo/bin`) still finds the binary.
 *   - Initialize handshake: a minimal LSP `initialize` + `initialized`
 *     pair claiming only the capabilities Lingua actually consumes
 *     (text sync, diagnostics, completions, hover, signature help).
 *     Asking for less helps rust-analyzer skip work it would otherwise
 *     do for a heavier IDE.
 *   - Lifecycle: a single auto-restart attempt with a 500ms backoff
 *     when the child crashes. A second crash inside the same launcher
 *     surfaces a `'degraded'` status; the renderer recovery row hangs
 *     off that state and can call `restart()` after the user clicks.
 *   - Env: filtered through `buildNativeRunnerEnv` so host secrets
 *     (CI tokens, OPENAI_API_KEY) never reach the spawned subprocess.
 */

const execFileAsync = promisify(execFile);

export type RustAnalyzerStatus =
  | { kind: 'starting' }
  | { kind: 'running'; version: string }
  | { kind: 'missing'; reason: string }
  | { kind: 'startup-failed'; error: string }
  | { kind: 'degraded'; error: string };

export interface RustAnalyzerLauncherOptions {
  /**
   * Workspace root passed as `rootUri` in initialize. Falls back to a
   * null root when the renderer has no project open. Avoid defaulting
   * to the user's home directory: rust-analyzer may treat that as a
   * workspace and crawl far more source than Lingua was asked to open.
   */
  workspaceRoot?: string;
  /**
   * Notification stream from the live LSP process. Re-emitted unchanged
   * so the IPC layer can forward `publishDiagnostics` and friends to
   * the renderer.
   */
  onNotification?: (notification: JsonRpcNotification) => void;
  /** Status transitions (renderer surfaces these). */
  onStatus?: (status: RustAnalyzerStatus) => void;
}

const HOME_CARGO_BIN = path.join(homedir(), '.cargo', 'bin');
const RUST_ANALYZER_BIN = process.platform === 'win32' ? 'rust-analyzer.exe' : 'rust-analyzer';
const FALLBACK_BIN_PATHS = [path.join(HOME_CARGO_BIN, RUST_ANALYZER_BIN)] as const;

const RESTART_BACKOFF_MS = 500;

/**
 * Resolve the rust-analyzer binary path. Returns the literal name when
 * PATH lookup will work (so spawn inherits PATH lookup), or an explicit
 * path when we had to fall back. `null` means the binary does not exist
 * in any known location.
 */
export async function resolveRustAnalyzerBinary(): Promise<{
  command: string;
  source: 'path' | 'cargo-bin';
} | null> {
  try {
    await execFileAsync(RUST_ANALYZER_BIN, ['--version'], {
      env: buildLauncherEnv(),
      timeout: 5000,
    });
    return { command: RUST_ANALYZER_BIN, source: 'path' };
  } catch {
    // Fall through to fallback paths.
  }

  for (const fallback of FALLBACK_BIN_PATHS) {
    try {
      await access(fallback);
      await execFileAsync(fallback, ['--version'], {
        env: buildLauncherEnv(),
        timeout: 5000,
      });
      return { command: fallback, source: 'cargo-bin' };
    } catch {
      continue;
    }
  }

  return null;
}

export async function detectRustAnalyzerVersion(
  command: string
): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(command, ['--version'], {
      env: buildLauncherEnv(),
      timeout: 5000,
    });
    return stdout.trim();
  } catch {
    return null;
  }
}

function buildLauncherEnv(): NodeJS.ProcessEnv {
  // RL-079 / fold G — host secrets stay out of the subprocess. user env
  // is intentionally NOT layered here: LSP servers should not inherit
  // arbitrary user vars (no eval, no compile, just analysis).
  return buildNativeRunnerEnv(combinedAllowlist(RUST_TOOLCHAIN_KEYS), undefined);
}

export class RustAnalyzerLauncher {
  private process: LspProcess | null = null;
  private currentStatus: RustAnalyzerStatus = { kind: 'starting' };
  private restartAttempted = false;
  private disposed = false;
  private startPromise: Promise<RustAnalyzerStatus> | null = null;
  private readonly options: RustAnalyzerLauncherOptions;

  constructor(options: RustAnalyzerLauncherOptions = {}) {
    this.options = options;
  }

  status(): RustAnalyzerStatus {
    return this.currentStatus;
  }

  start(): Promise<RustAnalyzerStatus> {
    if (this.disposed) {
      return Promise.resolve({ kind: 'startup-failed', error: 'Launcher disposed' });
    }
    // In-flight guard: `start()` is async and yields at the binary
    // resolution step (up to 5s timeout). Two concurrent callers (two
    // BrowserWindows, a fast double-click on Restart, the boot-trigger
    // effect re-running) would otherwise spawn two child processes —
    // the second overwrites `this.process` without disposing the first,
    // leaking a child that holds locks on rust-analyzer's workspace
    // database. Coalesce concurrent calls onto the same promise.
    if (this.startPromise) return this.startPromise;
    const pending = this.runStart();
    this.startPromise = pending.finally(() => {
      this.startPromise = null;
    });
    return this.startPromise;
  }

  private async runStart(): Promise<RustAnalyzerStatus> {
    this.setStatus({ kind: 'starting' });

    const binary = await resolveRustAnalyzerBinary();
    if (!binary) {
      const status: RustAnalyzerStatus = {
        kind: 'missing',
        reason: 'rust-analyzer not found on PATH or in ~/.cargo/bin',
      };
      this.setStatus(status);
      return status;
    }

    const version = await detectRustAnalyzerVersion(binary.command);
    if (!version) {
      const status: RustAnalyzerStatus = {
        kind: 'startup-failed',
        error: 'rust-analyzer --version returned no output',
      };
      this.setStatus(status);
      return status;
    }

    return this.spawnAndInitialize(binary.command, version);
  }

  /**
   * Re-spawn the process after a user-initiated recovery. Resets the
   * `restartAttempted` flag so a fresh single-restart budget applies.
   */
  async restart(): Promise<RustAnalyzerStatus> {
    this.restartAttempted = false;
    this.disposeProcess();
    return this.start();
  }

  sendRequest<T = unknown>(method: string, params?: unknown): Promise<T> {
    if (!this.process || !this.process.isAlive()) {
      return Promise.reject(new Error('rust-analyzer is not running'));
    }
    return this.process.sendRequest<T>(method, params);
  }

  sendNotification(method: string, params?: unknown): void {
    if (!this.process || !this.process.isAlive()) return;
    this.process.sendNotification(method, params);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.disposeProcess();
  }

  private disposeProcess(): void {
    if (this.process) {
      try {
        // Per LSP spec, `shutdown` is a request (id-bearing), not a
        // notification. We fire-and-forget because `dispose()` below
        // kills the child anyway — the request just gives rust-analyzer
        // the chance to flush state cleanly. `exit` is correctly a
        // notification. The immediate `dispose()` rejects every pending
        // request, this one included, so swallow the rejection or every
        // stop/restart/quit emits an unhandled rejection in main.
        this.process.sendRequest('shutdown').catch(() => {});
        this.process.sendNotification('exit');
      } catch {
        // Best-effort — the process may already be gone.
      }
      this.process.dispose();
      this.process = null;
    }
  }

  private async spawnAndInitialize(
    command: string,
    version: string
  ): Promise<RustAnalyzerStatus> {
    const lsp = new LspProcess({
      command,
      env: buildLauncherEnv(),
      onNotification: (notification) => this.options.onNotification?.(notification),
      // Ignore exits from processes this launcher no longer owns. A
      // user-initiated restart() disposes the old child and immediately
      // spawns a new one; without this guard the OLD child's exit event
      // enters handleExit(), schedules a crash-recovery spawn 500 ms
      // later, and that recovery overwrites `this.process` — leaving the
      // restart's process alive but unreachable (duplicate diagnostics,
      // workspace lock held, impossible to kill from the UI).
      onExit: (code, signal) => {
        if (this.process !== lsp) return;
        this.handleExit(code, signal);
      },
    });
    this.process = lsp;
    lsp.start();

    try {
      await lsp.sendRequest('initialize', this.buildInitializeParams());
      lsp.sendNotification('initialized', {});
      const status: RustAnalyzerStatus = { kind: 'running', version };
      this.setStatus(status);
      return status;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const status: RustAnalyzerStatus = { kind: 'startup-failed', error: message };
      this.setStatus(status);
      this.disposeProcess();
      return status;
    }
  }

  private buildInitializeParams(): Record<string, unknown> {
    const rootUri = this.options.workspaceRoot
      ? pathToFileUri(this.options.workspaceRoot)
      : null;
    return {
      processId: process.pid,
      clientInfo: { name: 'Lingua', version: '1.0.0' },
      rootUri,
      capabilities: {
        textDocument: {
          synchronization: { dynamicRegistration: false },
          publishDiagnostics: { relatedInformation: false },
          completion: {
            completionItem: { snippetSupport: true },
          },
          hover: { contentFormat: ['markdown', 'plaintext'] },
          signatureHelp: {
            signatureInformation: { parameterInformation: { labelOffsetSupport: false } },
          },
        },
        workspace: { configuration: false },
      },
      workspaceFolders: rootUri ? [{ uri: rootUri, name: 'lingua' }] : null,
    };
  }

  private handleExit(
    code: number | null,
    signal: NodeJS.Signals | null
  ): void {
    if (this.disposed) return;
    if (this.currentStatus.kind === 'missing') return;

    const exitDetail = `code=${code ?? 'null'} signal=${signal ?? 'null'}`;

    if (this.restartAttempted) {
      this.setStatus({ kind: 'degraded', error: `rust-analyzer crashed (${exitDetail})` });
      return;
    }

    this.restartAttempted = true;
    setTimeout(() => {
      if (this.disposed) return;
      void this.spawnAndInitializeRecovery(exitDetail);
    }, RESTART_BACKOFF_MS);
  }

  private async spawnAndInitializeRecovery(exitDetail: string): Promise<void> {
    const binary = await resolveRustAnalyzerBinary();
    if (!binary) {
      this.setStatus({
        kind: 'degraded',
        error: `rust-analyzer crashed (${exitDetail}) and binary is no longer available`,
      });
      return;
    }
    const version = await detectRustAnalyzerVersion(binary.command);
    if (!version) {
      this.setStatus({
        kind: 'degraded',
        error: `rust-analyzer crashed (${exitDetail}) and could not be re-detected`,
      });
      return;
    }
    await this.spawnAndInitialize(binary.command, version);
  }

  private setStatus(status: RustAnalyzerStatus): void {
    this.currentStatus = status;
    this.options.onStatus?.(status);
  }
}

/**
 * Encode an absolute path as a `file://` URI. Equivalent to Node's
 * `pathToFileURL(path).toString()` but kept inline so the helper stays
 * unit-testable without importing `node:url` at module top-level (the
 * test mock for spawn keeps Node imports lazy).
 */
export function pathToFileUri(absolutePath: string): string {
  const normalized = absolutePath.replace(/\\/g, '/');
  const prefix = normalized.startsWith('/') ? 'file://' : 'file:///';
  return prefix + encodeURI(normalized).replace(/#/g, '%23').replace(/\?/g, '%3F');
}
