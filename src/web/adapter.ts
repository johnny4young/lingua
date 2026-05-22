/**
 * Web Adapter
 *
 * Sets up `window.lingua` for the browser (non-Electron) build.
 *
 * JS / TS / Python runners work natively because they use Web Workers
 * and the browser already supports those. Go and Rust require native
 * toolchains that are not available in the browser, so their methods
 * return a descriptive "not available" result.
 *
 * This module must be imported BEFORE the React application renders.
 */

import { getActiveAppLanguage, getBrowserSystemLanguages } from '../renderer/i18n';
import { getBundledAppInfo, normalizeExternalUrl } from '../shared/appInfo';
import { translateCommon } from '../shared/i18n/runtime';
import { webFsAdapter } from './fs-adapter';

function t(key: string): string {
  return translateCommon(getActiveAppLanguage(), key);
}

const goStub: LinguaAPI['go'] = {
  detect: async (_userEnv?: Record<string, string>): Promise<GoDetectResult> => ({
    installed: false,
    error: t('errors.go.webUnavailable'),
  }),
  compile: async (
    _sourceCode: string,
    _userEnv?: Record<string, string>,
    _messages?: NativeRunnerMessages
  ): Promise<GoCompileResult> => ({
    success: false,
    error: t('errors.go.webUnavailable'),
  }),
};

// ----------------------------------------------------- Rust stub

const formatStub: LinguaAPI['format'] = {
  gofmt: async () => ({
    available: false,
    reason: 'web-unavailable',
    error: t('errors.format.webUnavailable'),
  }),
  rustfmt: async () => ({
    available: false,
    reason: 'web-unavailable',
    error: t('errors.format.webUnavailable'),
  }),
  python: async () => ({
    available: false,
    reason: 'web-unavailable',
    error: t('errors.format.webUnavailable'),
  }),
};

const rustStub: LinguaAPI['rust'] = {
  detect: async (_userEnv?: Record<string, string>): Promise<RustDetectResult> => ({
    installed: false,
    error: t('errors.rust.webUnavailable'),
  }),
  run: async (
    _sourceCode: string,
    _userEnv?: Record<string, string>,
    _messages?: NativeRunnerMessages
  ): Promise<RustRunResult> => ({
    success: false,
    stdout: '',
    stderr: t('errors.rust.webUnavailable'),
    exitCode: 1,
    executionTime: 0,
    error: t('errors.rust.webUnavailableShort'),
  }),
};

// -------------------------------------------------- Update stub

function createUnavailableUpdateState(): UpdateState {
  return {
    status: 'unavailable',
    supported: false,
    enabled: false,
    message: t('updates.message.webUnavailable'),
  };
}

const updateStub: LinguaAPI['updates'] = {
  getState: async () => createUnavailableUpdateState(),
  check: async () => ({
    ...createUnavailableUpdateState(),
    lastCheckedAt: new Date().toISOString(),
  }),
  restartToApply: async () => false,
  onStateChanged: () => () => {},
};

// -------------------------------------------------- Plugin stub

const pluginStub: LinguaAPI['plugins'] = {
  getInstallDirectory: async () => null,
  list: async () => [],
};

// ----------------------------------------------------- Install adapter

const webLingua: LinguaAPI = {
  platform: 'web',
  getSystemLanguages: async () => getBrowserSystemLanguages(),
  getAppInfo: async () => getBundledAppInfo(),
  openExternal: async (url: string) => {
    const normalizedUrl = normalizeExternalUrl(url);
    if (normalizedUrl === null) {
      return false;
    }

    window.open(normalizedUrl, '_blank', 'noopener,noreferrer');
    return true;
  },
  confirmClose: async () => 2, // Cancel by default to avoid silent data loss in web mode.
  confirmCloseTab: async () => 2,
  onBeforeClose: () => () => {},
  forceClose: () => {},
  go: goStub,
  rust: rustStub,
  format: formatStub,
  // Web build has no main-process mirror to write; the renderer store
  // remains the source of truth and the crash reporter never runs here.
  consent: {
    set: async () => ({ ok: true }),
  },
  // Web has no host process, so the env snapshot is always empty. Merging
  // still works — `mergeEnvScopes({ processEnv: {} })` just reduces the
  // result to the user-owned tiers.
  env: {
    snapshot: async () => ({}),
  },
  // RL-026 Slice 3 + Slice 4 — desktop LSPs (rust-analyzer + gopls)
  // are desktop-only. The web build resolves every entry point to a
  // stable `'missing'` status so the renderer renders the install
  // hint and never tries to send JSON-RPC requests that have no
  // transport.
  lsp: {
    rust: {
      start: async () => ({ kind: 'missing' as const, reason: 'web-build' }),
      restart: async () => ({ kind: 'missing' as const, reason: 'web-build' }),
      stop: async () => ({ kind: 'stopped' as const }),
      status: async () => ({ kind: 'missing' as const, reason: 'web-build' }),
      request: async () => ({ ok: false as const, error: 'web-build' }),
      notify: () => {},
      onNotification: () => () => {},
      onStatusChanged: () => () => {},
    },
    go: {
      start: async () => ({ kind: 'missing' as const, reason: 'web-build' }),
      restart: async () => ({ kind: 'missing' as const, reason: 'web-build' }),
      stop: async () => ({ kind: 'stopped' as const }),
      status: async () => ({ kind: 'missing' as const, reason: 'web-build' }),
      request: async () => ({ ok: false as const, error: 'web-build' }),
      notify: () => {},
      onNotification: () => () => {},
      onStatusChanged: () => () => {},
    },
  },
  fs: webFsAdapter,
  updates: updateStub,
  plugins: pluginStub,
  deepLinks: {
    consumePending: async () => null,
    markReady: () => {},
    onLink: () => () => {},
  },
  // RL-089 — web has no native confirm modal. Resolve to 1 (cancel)
  // so the renderer preserves current data and surfaces an explicit
  // cancellation notice instead of silently doing nothing.
  profile: {
    confirmReplace: async () => 1,
  },
  // RL-090 — recovery surface. Web has no native confirm dialog
  // (returns 1 = cancel; RecoverySection surfaces an inline notice)
  // and no shell.openPath equivalent (revealFolder reports unsupported
  // so the button hides on web).
  recovery: {
    confirmReset: async () => 1,
    revealFolder: async () => ({ ok: false, reason: 'unsupported' as const }),
  },
  // RL-025 Slice A — dependency resolver. Web has no `node_modules`
  // tree to probe and (per AGENTS.md `CAPABILITY_MATRIX.md`) cannot
  // run an install path either. The stub returns the input names
  // unchanged so the renderer's adapter maps every entry to
  // `'needs-desktop'` without an extra round-trip.
  dependencies: {
    resolveJs: async (specifiers) => ({
      statuses: Object.fromEntries(
        specifiers.map((name) => [name, 'detected' as const])
      ),
      cwd: null,
    }),
  },
};

// Expose on window — mirrors what the Electron preload does via contextBridge
(window as Window & typeof globalThis).lingua = webLingua;
