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

import { webFsAdapter } from './fs-adapter';

// ----------------------------------------------------- Go stub

const goStub: LinguaAPI['go'] = {
  detect: async (): Promise<GoDetectResult> => ({
    installed: false,
    error: 'Go compilation is not available in the web version. Download the desktop app to compile Go code.',
  }),
  compile: async (_sourceCode: string): Promise<GoCompileResult> => ({
    success: false,
    error: 'Go compilation is not available in the web version. Download the desktop app to compile Go code.',
  }),
};

// ----------------------------------------------------- Rust stub

const rustStub: LinguaAPI['rust'] = {
  detect: async (): Promise<RustDetectResult> => ({
    installed: false,
    error: 'Rust compilation is not available in the web version. Download the desktop app to compile Rust code.',
  }),
  run: async (_sourceCode: string): Promise<RustRunResult> => ({
    success: false,
    stdout: '',
    stderr: 'Rust compilation is not available in the web version. Download the desktop app to compile Rust code.',
    exitCode: 1,
    executionTime: 0,
    error: 'Rust compilation is not available in the web version.',
  }),
};

// -------------------------------------------------- Update stub

const updateStubState: UpdateState = {
  status: 'unavailable',
  supported: false,
  enabled: false,
  message: 'Automatic updates are not available in the web version.',
};

const updateStub: LinguaAPI['updates'] = {
  getState: async () => updateStubState,
  check: async () => updateStubState,
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
  go: goStub,
  rust: rustStub,
  fs: webFsAdapter,
  updates: updateStub,
  plugins: pluginStub,
};

// Expose on window — mirrors what the Electron preload does via contextBridge
(window as Window & typeof globalThis).lingua = webLingua;
