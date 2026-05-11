import { ipcMain, BrowserWindow } from 'electron';
import {
  RustAnalyzerLauncher,
  type RustAnalyzerStatus,
} from '../lsp/rustAnalyzerLauncher';

/**
 * RL-026 Slice 3 — main-process IPC bridge for the Rust LSP.
 *
 * The renderer never talks to rust-analyzer directly; instead it
 * exchanges high-level commands through this bridge:
 *
 *   - `lsp:rust:start`   → boot the launcher if it isn't running and
 *                          return the resulting `RustAnalyzerStatus`.
 *   - `lsp:rust:stop`    → dispose the launcher (sends LSP shutdown +
 *                          exit then kills the process).
 *   - `lsp:rust:restart` → user-initiated recovery from the
 *                          `'degraded'` state. Resets the auto-restart
 *                          budget then re-spawns.
 *   - `lsp:rust:status`  → return the current status without touching
 *                          the launcher (used on renderer rehydrate).
 *   - `lsp:rust:request` → forward an allowlisted editor request
 *                          (completion / hover / signature help) and
 *                          return the server's response.
 *   - `lsp:rust:notify`  → forward an allowlisted fire-and-forget notification
 *                          (`textDocument/didOpen` / `didChange` /
 *                          `didClose`).
 *
 * The bridge also pushes incoming server notifications back to every
 * renderer via the `lsp:rust:notification` push channel — that's how
 * `textDocument/publishDiagnostics` reaches the editor.
 *
 * Lifecycle ownership: the launcher lives at module scope (one per
 * main process). `app.on('before-quit')` disposes it; tests can call
 * `disposeRustLspBridge` for the same effect.
 */

let launcher: RustAnalyzerLauncher | null = null;

const ALLOWED_RUST_LSP_REQUESTS = new Set([
  'textDocument/completion',
  'textDocument/hover',
  'textDocument/signatureHelp',
]);

const ALLOWED_RUST_LSP_NOTIFICATIONS = new Set([
  'textDocument/didOpen',
  'textDocument/didChange',
  'textDocument/didClose',
]);

function isAllowedRustLspRequest(method: unknown): method is string {
  return typeof method === 'string' && ALLOWED_RUST_LSP_REQUESTS.has(method);
}

function isAllowedRustLspNotification(method: unknown): method is string {
  return typeof method === 'string' && ALLOWED_RUST_LSP_NOTIFICATIONS.has(method);
}

function broadcastNotification(channel: string, payload: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send(channel, payload);
    }
  }
}

function ensureLauncher(): RustAnalyzerLauncher {
  if (launcher) return launcher;
  launcher = new RustAnalyzerLauncher({
    onNotification: (notification) => {
      broadcastNotification('lsp:rust:notification', notification);
    },
    onStatus: (status) => {
      broadcastNotification('lsp:rust:status', status);
    },
  });
  return launcher;
}

export async function startRustLsp(): Promise<RustAnalyzerStatus> {
  return ensureLauncher().start();
}

export async function restartRustLsp(): Promise<RustAnalyzerStatus> {
  return ensureLauncher().restart();
}

export function stopRustLsp(): void {
  if (!launcher) return;
  launcher.dispose();
  launcher = null;
}

export function disposeRustLspBridge(): void {
  stopRustLsp();
}

export function registerLspHandlers(): void {
  ipcMain.handle('lsp:rust:start', async () => startRustLsp());
  ipcMain.handle('lsp:rust:restart', async () => restartRustLsp());
  ipcMain.handle('lsp:rust:stop', async () => {
    stopRustLsp();
    return { kind: 'stopped' as const };
  });
  ipcMain.handle('lsp:rust:status', () => {
    return launcher ? launcher.status() : ({ kind: 'unknown' } as const);
  });
  ipcMain.handle(
    'lsp:rust:request',
    async (_event, method: unknown, params: unknown) => {
      if (!isAllowedRustLspRequest(method)) {
        return { ok: false as const, error: 'Unsupported rust-analyzer request' };
      }
      if (!launcher) {
        return { ok: false as const, error: 'rust-analyzer launcher not started' };
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
  ipcMain.on('lsp:rust:notify', (_event, method: unknown, params: unknown) => {
    if (!isAllowedRustLspNotification(method)) return;
    if (!launcher) return;
    launcher.sendNotification(method, params);
  });
}
