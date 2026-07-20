import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { homedir } from 'node:os';
import { access } from 'node:fs/promises';
import path from 'node:path';
import {
  buildNativeRunnerEnv,
  combinedAllowlist,
  GO_TOOLCHAIN_KEYS,
} from '../runners/nativeEnv';
import { LspProcess } from './lspProcess';
import type { JsonRpcNotification } from './lspProcess';
import { pathToFileUri } from './rustAnalyzerLauncher';

/**
 * implementation — gopls launcher.
 *
 * Mirrors the shape of `rustAnalyzerLauncher.ts` because the lifecycle
 * concerns are the same — detection, initialize handshake, single
 * auto-restart on crash, env-filtered subprocess. The launcher is
 * intentionally a copy rather than a shared base class: with only two
 * desktop LSPs in the tree the abstraction would be speculative, and
 * implementation picked the copy path deliberately so the rust path can keep
 * stabilising without churn from implementation.
 *
 * Go-specific concerns the launcher owns:
 *   - Detection: PATH first, then `$GOPATH/bin/gopls`, then
 *     `~/go/bin/gopls`. macOS Electron apps launched from Finder
 *     inherit a sparse PATH that often omits `~/go/bin`; the fallback
 *     keeps a default `go install` invocation discoverable without
 *     forcing the user to add a Lingua-specific entry to their shell
 *     rc files.
 *   - Env: `buildNativeRunnerEnv(combinedAllowlist(GO_TOOLCHAIN_KEYS))`
 *     — the same allowlist the Go compile path uses. Host secrets
 *     (CI tokens, OPENAI_API_KEY) never reach the spawned subprocess.
 *   - Workspace root: identical handling to the rust launcher —
 *     `rootUri`/`workspaceFolders` are `null` when no workspaceRoot
 *     is supplied so gopls does not anchor itself to the user home
 *     and crawl unrelated Go modules.
 */

const execFileAsync = promisify(execFile);

export type GoplsStatus =
  | { kind: 'unknown' }
  | { kind: 'starting' }
  | { kind: 'running'; version: string }
  | { kind: 'missing'; reason: string }
  | { kind: 'startup-failed'; error: string }
  | { kind: 'degraded'; error: string }
  | { kind: 'stopped' };

export interface GoplsLauncherOptions {
  workspaceRoot?: string;
  onNotification?: (notification: JsonRpcNotification) => void;
  onStatus?: (status: GoplsStatus) => void;
}

const GOPLS_BIN = process.platform === 'win32' ? 'gopls.exe' : 'gopls';

function defaultFallbackPaths(): string[] {
  const home = homedir();
  const gopathEnv = process.env.GOPATH;
  const candidates: string[] = [];
  if (gopathEnv && gopathEnv.length > 0) {
    // GOPATH can be a list separated by the platform path delimiter
    // (`:` on POSIX, `;` on Windows). gopls is installed into the FIRST
    // entry's `bin` by `go install` per Go's documented behaviour.
    const firstEntry = gopathEnv.split(path.delimiter)[0];
    if (firstEntry && firstEntry.length > 0) {
      candidates.push(path.join(firstEntry, 'bin', GOPLS_BIN));
    }
  }
  candidates.push(path.join(home, 'go', 'bin', GOPLS_BIN));
  return candidates;
}

const RESTART_BACKOFF_MS = 500;

export async function resolveGoplsBinary(): Promise<{
  command: string;
  source: 'path' | 'gopath-bin' | 'home-go-bin';
  /**
   * Captured `gopls version` output for the PATH-case detection so
   * `runStart` does not need to spawn a second `execFile gopls version`
   * just to read the version line. `null` when the binary was located
   * via `access()` on a fallback path; the caller falls through to
   * `detectGoplsVersion` in that case.
   */
  prefetchedVersion: string | null;
} | null> {
  try {
    const result = await execFileAsync(GOPLS_BIN, ['version'], {
      env: buildLauncherEnv(),
      timeout: 5000,
    });
    return {
      command: GOPLS_BIN,
      source: 'path',
      prefetchedVersion: firstLineOrNull(execFileOutputText(result)),
    };
  } catch {
    // Fall through.
  }

  const fallbacks = defaultFallbackPaths();
  for (let i = 0; i < fallbacks.length; i += 1) {
    const fallback = fallbacks[i]!;
    try {
      await access(fallback);
      return {
        command: fallback,
        source: i === 0 && process.env.GOPATH ? 'gopath-bin' : 'home-go-bin',
        prefetchedVersion: null,
      };
    } catch {
      continue;
    }
  }

  return null;
}

function firstLineOrNull(text: string): string | null {
  const firstLine = text.split('\n')[0]?.trim();
  return firstLine && firstLine.length > 0 ? firstLine : null;
}

export async function detectGoplsVersion(command: string): Promise<string | null> {
  try {
    const result = await execFileAsync(command, ['version'], {
      env: buildLauncherEnv(),
      timeout: 5000,
    });
    // `gopls version` emits multi-line output:
    //   golang.org/x/tools/gopls v0.16.2
    //   <commit / build info follow>
    // Keep just the first line to match the rust-analyzer shape
    // (a single recognisable identifier).
    return firstLineOrNull(execFileOutputText(result));
  } catch {
    return null;
  }
}

function execFileOutputText(result: unknown): string {
  if (typeof result === 'string') return result;
  if (result && typeof result === 'object') {
    const stdout = (result as { stdout?: unknown }).stdout;
    const stderr = (result as { stderr?: unknown }).stderr;
    if (typeof stdout === 'string' && stdout.trim().length > 0) return stdout;
    if (typeof stderr === 'string') return stderr;
  }
  return '';
}

function buildLauncherEnv(): NodeJS.ProcessEnv {
  // implementation note — host secrets stay out of the subprocess.
  // User env is intentionally NOT layered: an LSP server should not
  // inherit arbitrary user vars.
  return buildNativeRunnerEnv(combinedAllowlist(GO_TOOLCHAIN_KEYS), undefined);
}

export class GoplsLauncher {
  private process: LspProcess | null = null;
  private currentStatus: GoplsStatus = { kind: 'starting' };
  private restartAttempted = false;
  private disposed = false;
  private startPromise: Promise<GoplsStatus> | null = null;
  private readonly options: GoplsLauncherOptions;

  constructor(options: GoplsLauncherOptions = {}) {
    this.options = options;
  }

  status(): GoplsStatus {
    return this.currentStatus;
  }

  start(): Promise<GoplsStatus> {
    if (this.disposed) {
      return Promise.resolve({ kind: 'startup-failed', error: 'Launcher disposed' });
    }
    if (this.startPromise) return this.startPromise;
    const pending = this.runStart();
    this.startPromise = pending.finally(() => {
      this.startPromise = null;
    });
    return this.startPromise;
  }

  private async runStart(): Promise<GoplsStatus> {
    this.setStatus({ kind: 'starting' });

    const binary = await resolveGoplsBinary();
    if (!binary) {
      const status: GoplsStatus = {
        kind: 'missing',
        reason: 'gopls not found on PATH, in $GOPATH/bin, or in ~/go/bin',
      };
      this.setStatus(status);
      return status;
    }

    // Reuse the version `resolveGoplsBinary` already parsed for the
    // PATH case so we don't pay a second `execFile gopls version` round
    // trip (each one carries a 5s timeout). Fallback paths only checked
    // existence via `access`, so they still need a real version probe.
    const version = binary.prefetchedVersion ?? (await detectGoplsVersion(binary.command));
    if (!version) {
      const status: GoplsStatus = {
        kind: 'startup-failed',
        error: 'gopls version returned no output',
      };
      this.setStatus(status);
      return status;
    }

    return this.spawnAndInitialize(binary.command, version);
  }

  async restart(): Promise<GoplsStatus> {
    this.restartAttempted = false;
    this.disposeProcess();
    return this.start();
  }

  sendRequest<T = unknown>(method: string, params?: unknown): Promise<T> {
    if (!this.process || !this.process.isAlive()) {
      return Promise.reject(new Error('gopls is not running'));
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
        // Per LSP spec, `shutdown` is a request, `exit` a notification.
        // The immediate `dispose()` below rejects every pending request,
        // this one included — swallow the rejection or every
        // stop/restart/quit emits an unhandled rejection in main.
        this.process.sendRequest('shutdown').catch(() => {});
        this.process.sendNotification('exit');
      } catch {
        // Best-effort.
      }
      this.process.dispose();
      this.process = null;
    }
  }

  private async spawnAndInitialize(
    command: string,
    version: string
  ): Promise<GoplsStatus> {
    const lsp = new LspProcess({
      command,
      // gopls expects to be run with `gopls` (no subcommand) for LSP
      // mode on stdio. That is the default when no args are passed.
      args: [],
      env: buildLauncherEnv(),
      onNotification: (notification) => this.options.onNotification?.(notification),
      // Ignore exits from processes this launcher no longer owns — a
      // restart() disposes the old child and spawns a new one, and the
      // old child's exit event must not trigger the crash-recovery path
      // (which would overwrite `this.process` with a duplicate, orphaned
      // gopls). Same guard as rustAnalyzerLauncher.
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
      const status: GoplsStatus = { kind: 'running', version };
      this.setStatus(status);
      return status;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const status: GoplsStatus = { kind: 'startup-failed', error: message };
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
      this.setStatus({ kind: 'degraded', error: `gopls crashed (${exitDetail})` });
      return;
    }

    this.restartAttempted = true;
    setTimeout(() => {
      if (this.disposed) return;
      void this.spawnAndInitializeRecovery(exitDetail);
    }, RESTART_BACKOFF_MS);
  }

  private async spawnAndInitializeRecovery(exitDetail: string): Promise<void> {
    const binary = await resolveGoplsBinary();
    if (!binary) {
      this.setStatus({
        kind: 'degraded',
        error: `gopls crashed (${exitDetail}) and binary is no longer available`,
      });
      return;
    }
    const version = await detectGoplsVersion(binary.command);
    if (!version) {
      this.setStatus({
        kind: 'degraded',
        error: `gopls crashed (${exitDetail}) and could not be re-detected`,
      });
      return;
    }
    await this.spawnAndInitialize(binary.command, version);
  }

  private setStatus(status: GoplsStatus): void {
    this.currentStatus = status;
    this.options.onStatus?.(status);
  }
}
