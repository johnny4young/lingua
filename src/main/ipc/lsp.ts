import { stat } from 'node:fs/promises';
import { resolveCapabilityPath } from './projectCapabilities';
import { isLspDocumentUriAllowed, resolveLspNavigationTarget } from '../lsp/navigationTargets';
import { typedHandle } from './typedHandle';
import type { RootId } from '../../shared/fs/brandedIds';
import { ipcMain, BrowserWindow } from 'electron';
import {
  pathToFileUri,
  RustAnalyzerLauncher,
  type RustAnalyzerStatus,
} from '../lsp/rustAnalyzerLauncher';
import type { JsonRpcNotification } from '../lsp/lspProcess';
import { GoplsLauncher, type GoplsStatus } from '../lsp/goplsLauncher';

/**
 * main-process IPC bridge for desktop
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
 * language per main process). `app.on('will-quit')` calls
 * `disposeLspBridge()` to kill every live child. Tests can call the
 * same helper for cleanup.
 */

type LspLanguage = 'rust' | 'go';

type LauncherFor<L extends LspLanguage> = L extends 'rust' ? RustAnalyzerLauncher : GoplsLauncher;

type StatusFor<L extends LspLanguage> = L extends 'rust' ? RustAnalyzerStatus : GoplsStatus;

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
  'textDocument/definition',
  'textDocument/references',
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

function documentUriOf(params: unknown): unknown {
  if (typeof params !== 'object' || params === null) return undefined;
  const textDocument = (params as { textDocument?: unknown }).textDocument;
  if (typeof textDocument !== 'object' || textDocument === null) return undefined;
  return (textDocument as { uri?: unknown }).uri;
}

// Diagnostics reported through the realpath would not match the renderer's model URIs.
function rewriteDiagnosticsUri(
  notification: JsonRpcNotification,
  roots: WorkspaceRoots | undefined
): JsonRpcNotification {
  if (!roots || roots.realPath === roots.rootPath) return notification;
  if (notification.method !== 'textDocument/publishDiagnostics') return notification;
  const params = notification.params as { uri?: unknown } | undefined;
  if (typeof params?.uri !== 'string') return notification;
  const realPrefix = `${pathToFileUri(roots.realPath)}/`;
  if (!params.uri.startsWith(realPrefix)) return notification;
  const uri = `${pathToFileUri(roots.rootPath)}/${params.uri.slice(realPrefix.length)}`;
  return { ...notification, params: { ...params, uri } };
}

function broadcastNotification(channel: string, payload: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send(channel, payload);
    }
  }
}

interface WorkspaceRoots {
  rootPath: string;
  realPath: string;
}

const contexts: Record<LspLanguage, RootId | undefined> = { rust: undefined, go: undefined };
const workspaceRoots: Partial<Record<LspLanguage, WorkspaceRoots>> = {};
const epochs: Record<LspLanguage, number> = { rust: 0, go: 0 };
function ensureLauncher<L extends LspLanguage>(
  language: L,
  workspaceRoot?: string
): LauncherFor<L> {
  const epoch = epochs[language];
  if (language === 'rust') {
    if (launchers.rust) return launchers.rust as LauncherFor<L>;
    launchers.rust = new RustAnalyzerLauncher({
      workspaceRoot,
      onNotification: notification => {
        if (epoch !== epochs[language]) return;
        broadcastNotification(
          'lsp:rust:notification',
          rewriteDiagnosticsUri(notification, workspaceRoots[language])
        );
      },
      onStatus: status => {
        if (epoch !== epochs[language]) return;
        broadcastNotification('lsp:rust:status', status);
      },
    });
    return launchers.rust as LauncherFor<L>;
  }
  // language === 'go'
  if (launchers.go) return launchers.go as LauncherFor<L>;
  launchers.go = new GoplsLauncher({
    workspaceRoot,
    onNotification: notification => {
      if (epoch !== epochs[language]) return;
      broadcastNotification(
        'lsp:go:notification',
        rewriteDiagnosticsUri(notification, workspaceRoots[language])
      );
    },
    onStatus: status => {
      if (epoch !== epochs[language]) return;
      broadcastNotification('lsp:go:status', status);
    },
  });
  return launchers.go as LauncherFor<L>;
}

function stopLauncher(language: LspLanguage): void {
  epochs[language] += 1;
  const launcher = launchers[language];
  if (!launcher) return;
  launcher.dispose();
  launchers[language] = null;
  delete workspaceRoots[language];
}

const startIntents: Record<LspLanguage, number> = { rust: 0, go: 0 };
// Restart follows the latest requested project, even while its start awaits authorization.
const requestedContexts: Partial<Record<LspLanguage, RootId>> = {};
async function startContext<L extends LspLanguage>(
  language: L,
  rootId?: RootId
): Promise<StatusFor<L>> {
  const intent = ++startIntents[language];
  requestedContexts[language] = rootId;
  const unauthorized = (error: string): StatusFor<L> => {
    if (intent === startIntents[language]) { stopLauncher(language); contexts[language] = undefined; }
    return { kind: 'startup-failed', error } as StatusFor<L>;
  };
  if (contexts[language] !== rootId) stopLauncher(language);
  let roots: WorkspaceRoots | undefined;
  if (rootId !== undefined) {
    const resolved =
      typeof rootId === 'string' ? await resolveCapabilityPath(rootId, '', 'read') : null;
    if (!resolved?.ok || !(await stat(resolved.absolutePath).catch(() => null))?.isDirectory())
      return unauthorized('Project root is not authorized.');
    const fresh = await resolveCapabilityPath(rootId, '', 'read');
    if (!fresh.ok || fresh.absolutePath !== resolved.absolutePath)
      return unauthorized('Project root was revoked.');
    // Documents are opened under the symlink-preserving root, so the server must be too.
    roots = { rootPath: fresh.rootPath, realPath: fresh.absolutePath };
  }
  if (intent !== startIntents[language])
    return { kind: 'startup-failed', error: 'Project context changed.' } as StatusFor<L>;
  if (contexts[language] !== rootId) stopLauncher(language);
  contexts[language] = rootId;
  const launcher = ensureLauncher(language, roots?.rootPath);
  if (roots) workspaceRoots[language] = roots;
  else delete workspaceRoots[language];
  return launcher.start() as Promise<StatusFor<L>>;
}

export function disposeLspBridge(): void {
  startIntents.rust += 1;
  startIntents.go += 1;
  stopLauncher('rust');
  stopLauncher('go');
}

interface LanguageHandlers<L extends LspLanguage> {
  language: L;
}

// Without a project context there is no grant to check against, so only the URI shape is enforced.
function documentAllowed(language: LspLanguage, params: unknown): boolean {
  const roots = workspaceRoots[language];
  const bases =
    contexts[language] === undefined ? null : roots ? [roots.rootPath, roots.realPath] : [];
  return isLspDocumentUriAllowed(documentUriOf(params), bases);
}

function registerLanguageHandlers<L extends LspLanguage>(config: LanguageHandlers<L>): void {
  const { language } = config;
  // NOTE (typed IPC contract): this factory builds channel names
  // dynamically (`lsp:${language}:${suffix}`), so it registers via raw
  // `ipcMain.handle` — `typedHandle` requires a literal contract key and a
  // computed string is not one. The channels ARE in `IpcInvokeContract`
  // (both rust + go variants) and stay covered by the drift test; only the
  // compile-time return-type binding is unavailable here, which is the
  // inherent trade-off of a generic multi-language registrar.
  const channel = (suffix: string) => `lsp:${language}:${suffix}`;
  const launcherLabel = language === 'rust' ? 'rust-analyzer' : 'gopls';

  ipcMain.handle(channel('start'), async (_event, rootId?: RootId) =>
    startContext(language, rootId)
  );
  ipcMain.handle(channel('restart'), async () => {
    const rootId = requestedContexts[language];
    stopLauncher(language);
    return startContext(language, rootId);
  });
  ipcMain.handle(channel('stop'), async () => {
    startIntents[language] += 1;
    stopLauncher(language);
    return { kind: 'stopped' as const };
  });
  ipcMain.handle(channel('status'), () => {
    const launcher = launchers[language];
    return launcher ? launcher.status() : ({ kind: 'unknown' } as const);
  });
  ipcMain.handle(
    channel('request'),
    async (_event, method: unknown, params: unknown): Promise<LspRequestResult> => {
      if (!isAllowedLspRequest(method)) {
        return {
          ok: false,
          reason: 'unsupported-method',
          message: `Unsupported ${launcherLabel} request`,
        };
      }
      const launcher = launchers[language];
      if (!launcher) {
        return {
          ok: false,
          reason: 'not-started',
          message: `${launcherLabel} launcher not started`,
        };
      }
      const status = launcher.status();
      if (
        (method === 'textDocument/definition' || method === 'textDocument/references') &&
        (status.kind !== 'running' ||
          !status.navigation?.[method === 'textDocument/definition' ? 'definition' : 'references'])
      )
        return {
          ok: false,
          reason: 'unsupported-method',
          message: 'Server does not declare this navigation capability.',
        };
      if (!documentAllowed(language, params))
        return {
          ok: false,
          reason: 'request-failed',
          message: 'Document is outside the authorized project.',
        };
      const epoch = epochs[language];
      try {
        const result = await launcher.sendRequest(method, params);
        if (epoch !== epochs[language] || launchers[language] !== launcher)
          return { ok: false, reason: 'request-failed', message: 'Project context changed.' };
        return { ok: true, data: result };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { ok: false, reason: 'request-failed', message };
      }
    }
  );
  ipcMain.on(channel('notify'), (_event, method: unknown, params: unknown) => {
    if (!isAllowedLspNotification(method)) return;
    const launcher = launchers[language];
    if (!launcher || !documentAllowed(language, params)) return;
    launcher.sendNotification(method, params);
  });
}

export function registerLspHandlers(): void {
  typedHandle('lsp:resolve-target', (_event, rootId, uri) =>
    resolveLspNavigationTarget(rootId, uri)
  );
  registerLanguageHandlers({
    language: 'rust',
  });
  registerLanguageHandlers({
    language: 'go',
  });
}
