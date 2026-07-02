import { ipcMain, BrowserWindow } from 'electron';
import {
  RustAnalyzerLauncher,
  type RustAnalyzerStatus,
} from '../lsp/rustAnalyzerLauncher';
import { GoplsLauncher, type GoplsStatus } from '../lsp/goplsLauncher';

/**
 * RL-026 Slice 3 + Slice 4 — main-process IPC bridge for desktop
 * LSP servers (rust-analyzer, gopls).
 *
 * The renderer never talks to either server directly; instead it
 * exchanges high-level commands through this bridge:
 *
 *   - `lsp:<lang>:start`   → boot the launcher if it isn't running and
 *                            return the current `*Status`.
 *   - `lsp:<lang>:stop`    → dispose the launcher (sends LSP shutdown +
 *                            exit then kills the process).
 *   - `lsp:<lang>:restart` → user-initiated recovery from the
 *                            `'degraded'` state. Resets the auto-restart
 *                            budget then re-spawns.
 *   - `lsp:<lang>:status`  → return the current status without
 *                            touching the launcher (used on renderer
 *                            rehydrate).
 *   - `lsp:<lang>:request` → forward an allowlisted editor request
 *                            (completion / hover / signature help) and
 *                            return the server's response.
 *   - `lsp:<lang>:notify`  → forward an allowlisted fire-and-forget
 *                            notification (`textDocument/didOpen` /
 *                            `didChange` / `didClose`).
 *
 * `<lang>` is `'rust'` or `'go'`. The allowlists are shared — the LSP
 * method set Lingua actually consumes is identical across both
 * languages — but the launchers are independent: detection, binary,
 * env, and lifecycle are language-specific.
 *
 * The bridge also pushes incoming server notifications back to every
 * renderer via `lsp:<lang>:notification` — that's how
 * `textDocument/publishDiagnostics` reaches the editor.
 *
 * Lifecycle ownership: launchers live at module scope (one per
 * language per main process). `app.on('before-quit')` calls
 * `disposeLspBridge()` to kill every live child. Tests can call the
 * same helper for cleanup.
 */

type LspLanguage = 'rust' | 'go';

type LauncherFor<L extends LspLanguage> = L extends 'rust'
  ? RustAnalyzerLauncher
  : GoplsLauncher;

type StatusFor<L extends LspLanguage> = L extends 'rust'
  ? RustAnalyzerStatus
  : GoplsStatus;

const launchers: { rust: RustAnalyzerLauncher | null; go: GoplsLauncher | null } = {
  rust: null,
  go: null,
};

// The LSP method set Lingua actually consumes is identical for Rust
// and Go (and any future LSP-backed language we add). Sharing the
// allowlist keeps the security surface narrow: every new method that
// crosses the IPC boundary must be added here explicitly.
const ALLOWED_LSP_REQUESTS = new Set([
  'textDocument/completion',
  'textDocument/hover',
  'textDocument/signatureHelp',
]);

const ALLOWED_LSP_NOTIFICATIONS = new Set([
  'textDocument/didOpen',
  'textDocument/didChange',
  'textDocument/didClose',
]);

function isAllowedLspRequest(method: unknown): method is string {
  return typeof method === 'string' && ALLOWED_LSP_REQUESTS.has(method);
}

function isAllowedLspNotification(method: unknown): method is string {
  return typeof method === 'string' && ALLOWED_LSP_NOTIFICATIONS.has(method);
}

function broadcastNotification(channel: string, payload: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send(channel, payload);
    }
  }
}

function ensureLauncher<L extends LspLanguage>(language: L): LauncherFor<L> {
  if (language === 'rust') {
    if (launchers.rust) return launchers.rust as LauncherFor<L>;
    launchers.rust = new RustAnalyzerLauncher({
      onNotification: (notification) => {
        broadcastNotification('lsp:rust:notification', notification);
      },
      onStatus: (status) => {
        broadcastNotification('lsp:rust:status', status);
      },
    });
    return launchers.rust as LauncherFor<L>;
  }
  // language === 'go'
  if (launchers.go) return launchers.go as LauncherFor<L>;
  launchers.go = new GoplsLauncher({
    onNotification: (notification) => {
      broadcastNotification('lsp:go:notification', notification);
    },
    onStatus: (status) => {
      broadcastNotification('lsp:go:status', status);
    },
  });
  return launchers.go as LauncherFor<L>;
}

function stopLauncher(language: LspLanguage): void {
  const launcher = launchers[language];
  if (!launcher) return;
  launcher.dispose();
  launchers[language] = null;
}

export async function startRustLsp(): Promise<RustAnalyzerStatus> {
  return ensureLauncher('rust').start();
}

export async function restartRustLsp(): Promise<RustAnalyzerStatus> {
  return ensureLauncher('rust').restart();
}

export function stopRustLsp(): void {
  stopLauncher('rust');
}

export async function startGoLsp(): Promise<GoplsStatus> {
  return ensureLauncher('go').start();
}

export async function restartGoLsp(): Promise<GoplsStatus> {
  return ensureLauncher('go').restart();
}

export function stopGoLsp(): void {
  stopLauncher('go');
}

export function disposeLspBridge(): void {
  stopRustLsp();
  stopGoLsp();
}

/**
 * @deprecated Slice 3 export. Slice 4 widens the bridge to multiple
 * languages — prefer `disposeLspBridge`. Retained as a thin alias so
 * the lifecycle wiring in `main/index.ts` keeps working through any
 * mid-rollout state.
 */
export function disposeRustLspBridge(): void {
  disposeLspBridge();
}

interface LanguageHandlers<L extends LspLanguage> {
  language: L;
  start: () => Promise<StatusFor<L>>;
  restart: () => Promise<StatusFor<L>>;
}

function registerLanguageHandlers<L extends LspLanguage>(
  config: LanguageHandlers<L>
): void {
  const { language, start, restart } = config;
  // NOTE (typed IPC contract): this factory builds channel names
  // dynamically (`lsp:${language}:${suffix}`), so it registers via raw
  // `ipcMain.handle` — `typedHandle` requires a literal contract key and a
  // computed string is not one. The channels ARE in `IpcInvokeContract`
  // (both rust + go variants) and stay covered by the drift test; only the
  // compile-time return-type binding is unavailable here, which is the
  // inherent trade-off of a generic multi-language registrar.
  const channel = (suffix: string) => `lsp:${language}:${suffix}`;
  const launcherLabel = language === 'rust' ? 'rust-analyzer' : 'gopls';

  ipcMain.handle(channel('start'), async () => start());
  ipcMain.handle(channel('restart'), async () => restart());
  ipcMain.handle(channel('stop'), async () => {
    stopLauncher(language);
    return { kind: 'stopped' as const };
  });
  ipcMain.handle(channel('status'), () => {
    const launcher = launchers[language];
    return launcher ? launcher.status() : ({ kind: 'unknown' } as const);
  });
  ipcMain.handle(
    channel('request'),
    async (_event, method: unknown, params: unknown) => {
      if (!isAllowedLspRequest(method)) {
        return { ok: false as const, error: `Unsupported ${launcherLabel} request` };
      }
      const launcher = launchers[language];
      if (!launcher) {
        return {
          ok: false as const,
          error: `${launcherLabel} launcher not started`,
        };
      }
      try {
        const result = await launcher.sendRequest(method, params);
        return { ok: true as const, result };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { ok: false as const, error: message };
      }
    }
  );
  ipcMain.on(channel('notify'), (_event, method: unknown, params: unknown) => {
    if (!isAllowedLspNotification(method)) return;
    const launcher = launchers[language];
    if (!launcher) return;
    launcher.sendNotification(method, params);
  });
}

export function registerLspHandlers(): void {
  registerLanguageHandlers({
    language: 'rust',
    start: startRustLsp,
    restart: restartRustLsp,
  });
  registerLanguageHandlers({
    language: 'go',
    start: startGoLsp,
    restart: restartGoLsp,
  });
}
