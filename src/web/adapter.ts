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
import { canOpenExternalUrl, getBundledAppInfo } from '../shared/appInfo';
import { translateCommon } from '../shared/i18n/runtime';
import { webFsAdapter } from './fs-adapter';

function t(key: string): string {
  return translateCommon(getActiveAppLanguage(), key);
}

const goStub: LinguaAPI['go'] = {
  detect: async (): Promise<GoDetectResult> => ({
    installed: false,
    error: t('errors.go.webUnavailable'),
  }),
  compile: async (_sourceCode: string): Promise<GoCompileResult> => ({
    success: false,
    error: t('errors.go.webUnavailable'),
  }),
};

// ----------------------------------------------------- Rust stub

const rustStub: LinguaAPI['rust'] = {
  detect: async (): Promise<RustDetectResult> => ({
    installed: false,
    error: t('errors.rust.webUnavailable'),
  }),
  run: async (_sourceCode: string): Promise<RustRunResult> => ({
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
    if (!canOpenExternalUrl(url)) {
      return false;
    }

    window.open(url, '_blank', 'noopener,noreferrer');
    return true;
  },
  confirmClose: async () => 2, // Cancel by default to avoid silent data loss in web mode.
  confirmCloseTab: async () => 2,
  onBeforeClose: () => () => {},
  forceClose: () => {},
  go: goStub,
  rust: rustStub,
  fs: webFsAdapter,
  updates: updateStub,
  plugins: pluginStub,
};

// Expose on window — mirrors what the Electron preload does via contextBridge
(window as Window & typeof globalThis).lingua = webLingua;
