// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RUNTIME_ASSETS } from '#src/shared/runtimeAssets';

/**
 * implementation review pass — unit coverage for
 * `src/main/offlineSmoke.ts`. The end-to-end desktop smoke proves
 * the offline gate works in practice, but a regression in the
 * protocol allowlist or the loopback check would only surface as a
 * red `pnpm run smoke:desktop:offline` after a full Electron boot.
 * These tests pin the URL-classification logic and the listener
 * registration so a misclassified scheme fails inside Vitest.
 */

interface OnBeforeRequestDetails {
  url: string;
}

type OnBeforeRequestCallback = (response: { cancel: boolean }) => void;
type OnBeforeRequestListener = (
  details: OnBeforeRequestDetails,
  callback: OnBeforeRequestCallback
) => void;

interface FakeSession {
  webRequest: {
    onBeforeRequest: ReturnType<typeof vi.fn>;
  };
  __listeners: OnBeforeRequestListener[];
}

function createFakeSession(): FakeSession {
  const listeners: OnBeforeRequestListener[] = [];
  return {
    webRequest: {
      onBeforeRequest: vi.fn((listener: OnBeforeRequestListener) => {
        listeners.push(listener);
      }),
    },
    __listeners: listeners,
  };
}

async function loadFreshModule() {
  vi.resetModules();
  return import('#src/main/offlineSmoke');
}

describe('offlineSmoke — isOfflineSmokeRequested env gate', () => {
  const originalValue = process.env.LINGUA_DESKTOP_SMOKE_OFFLINE;

  afterEach(() => {
    if (originalValue === undefined) {
      delete process.env.LINGUA_DESKTOP_SMOKE_OFFLINE;
    } else {
      process.env.LINGUA_DESKTOP_SMOKE_OFFLINE = originalValue;
    }
  });

  it('is false when the env var is not set', async () => {
    delete process.env.LINGUA_DESKTOP_SMOKE_OFFLINE;
    const mod = await loadFreshModule();
    expect(mod.isOfflineSmokeRequested()).toBe(false);
  });

  it('is true only when the env var equals exactly "1"', async () => {
    const mod = await loadFreshModule();

    process.env.LINGUA_DESKTOP_SMOKE_OFFLINE = '1';
    expect(mod.isOfflineSmokeRequested()).toBe(true);

    process.env.LINGUA_DESKTOP_SMOKE_OFFLINE = 'true';
    expect(mod.isOfflineSmokeRequested()).toBe(false);

    process.env.LINGUA_DESKTOP_SMOKE_OFFLINE = '';
    expect(mod.isOfflineSmokeRequested()).toBe(false);
  });
});

describe('offlineSmoke — webRequest filter classification', () => {
  let mod: typeof import('#src/main/offlineSmoke');
  let session: FakeSession;

  beforeEach(async () => {
    mod = await loadFreshModule();
    mod.__resetOfflineSmokeState();
    session = createFakeSession();
    mod.installOfflineSmokeFilter(session as never);
  });

  function classify(url: string): { cancel: boolean; recorded: readonly string[] } {
    const listener = session.__listeners[0];
    expect(listener, 'installOfflineSmokeFilter must register an onBeforeRequest').toBeDefined();
    let result: { cancel: boolean } | null = null;
    listener!({ url }, (response) => {
      result = response;
    });
    expect(result, 'callback was never invoked').not.toBeNull();
    return { cancel: result!.cancel, recorded: mod.getBlockedOfflineSmokeUrls() };
  }

  it('allows loopback HTTP, HTTPS, WS, and WSS without recording', () => {
    const allowed = [
      'http://localhost:5174/',
      'https://localhost:5174/path',
      'http://127.0.0.1:5174/index.html',
      'ws://localhost:5174/?token=abc',
      'wss://127.0.0.1:5174/hmr',
      'http://[::1]:5174/',
    ];
    for (const url of allowed) {
      const { cancel } = classify(url);
      expect(cancel, `${url} should be allowed`).toBe(false);
    }
    expect(mod.getBlockedOfflineSmokeUrls()).toEqual([]);
  });

  it('allows local-only protocols (file:, blob:, data:, devtools:, lingua:)', () => {
    const allowed = [
      'file:///Applications/Lingua.app/Contents/Resources/app.asar/.vite/renderer/main_window/pyodide/pyodide.mjs',
      'blob:http://localhost:5174/abc-def',
      'data:application/json;base64,eyJvayI6dHJ1ZX0=',
      'devtools://devtools/bundled/inspector.html',
      'chrome://extensions',
      'chrome-extension://abcdef/page.html',
      'lingua://open-snippet/abc',
      'lingua-asset://pyodide/pyodide.mjs',
    ];
    for (const url of allowed) {
      const { cancel } = classify(url);
      expect(cancel, `${url} should be allowed`).toBe(false);
    }
    expect(mod.getBlockedOfflineSmokeUrls()).toEqual([]);
  });

  it('cancels and records remote HTTP/HTTPS requests', () => {
    const cdn = `${RUNTIME_ASSETS.pyodide.sourceUrl}pyodide.mjs`;
    const analytics = 'https://example.com/track?id=1';

    expect(classify(cdn).cancel).toBe(true);
    expect(classify(analytics).cancel).toBe(true);

    const recorded = mod.getBlockedOfflineSmokeUrls();
    expect(recorded).toEqual([cdn, analytics]);
  });

  it('cancels remote ws://, wss:// and unknown protocols', () => {
    expect(classify('wss://example.com/socket').cancel).toBe(true);
    expect(classify('ftp://example.com/asset').cancel).toBe(true);

    const recorded = mod.getBlockedOfflineSmokeUrls();
    expect(recorded).toEqual([
      'wss://example.com/socket',
      'ftp://example.com/asset',
    ]);
  });

  it('allows malformed URLs through (defensive: do not break the smoke for a benign request)', () => {
    const { cancel, recorded } = classify('not-a-url');
    expect(cancel).toBe(false);
    expect(recorded).toEqual([]);
  });

  it('returns a fresh copy of the blocked list each call', () => {
    classify('https://example.com/a');
    const first = mod.getBlockedOfflineSmokeUrls();
    const second = mod.getBlockedOfflineSmokeUrls();
    expect(first).not.toBe(second);
    expect(first).toEqual(second);
  });
});

describe('offlineSmoke — install idempotence', () => {
  it('only registers one onBeforeRequest listener even if called multiple times', async () => {
    const mod = await loadFreshModule();
    mod.__resetOfflineSmokeState();
    const session = createFakeSession();

    mod.installOfflineSmokeFilter(session as never);
    mod.installOfflineSmokeFilter(session as never);
    mod.installOfflineSmokeFilter(session as never);

    expect(session.webRequest.onBeforeRequest).toHaveBeenCalledTimes(1);
  });

  it('__resetOfflineSmokeState clears recorded URLs and re-arms install', async () => {
    const mod = await loadFreshModule();
    mod.__resetOfflineSmokeState();
    const firstSession = createFakeSession();
    mod.installOfflineSmokeFilter(firstSession as never);

    firstSession.__listeners[0]!(
      { url: 'https://example.com/x' },
      () => undefined
    );
    expect(mod.getBlockedOfflineSmokeUrls()).toEqual(['https://example.com/x']);

    mod.__resetOfflineSmokeState();
    expect(mod.getBlockedOfflineSmokeUrls()).toEqual([]);

    const secondSession = createFakeSession();
    mod.installOfflineSmokeFilter(secondSession as never);
    expect(secondSession.webRequest.onBeforeRequest).toHaveBeenCalledTimes(1);
  });
});
