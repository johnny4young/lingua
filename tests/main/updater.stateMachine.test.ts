/**
 * State-machine guards for `src/main/updater.ts`. Locks in two
 * regressions reported in production:
 *
 * 1. The hourly `setInterval` poll fired `checkForUpdates()` after a
 *    download had already landed. Squirrel emits `checking-for-update`
 *    before `update-not-available`; both transitions must preserve the
 *    terminal `'downloaded'` state.
 * 2. The `updates:restart` IPC handler used to return `false`
 *    silently when `updateState.status !== 'downloaded'`, masking the
 *    above regression.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

type Handler = (...args: unknown[]) => void;
type IpcHandler = (...args: unknown[]) => Promise<unknown> | unknown;

interface UpdaterHarness {
  autoUpdaterHandlers: Map<string, Handler>;
  ipcHandlers: Map<string, IpcHandler>;
  checkForUpdates: ReturnType<typeof vi.fn>;
  quitAndInstall: ReturnType<typeof vi.fn>;
  getState: () => Promise<UpdateState>;
}

const ORIGINAL_PROCESS_PLATFORM = process.platform;

function stubProcessPlatform(value: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value, configurable: true });
}

function restoreProcessPlatform(): void {
  Object.defineProperty(process, 'platform', {
    value: ORIGINAL_PROCESS_PLATFORM,
    configurable: true,
  });
}

async function loadUpdaterHarness({
  updateURL = 'https://updates.example.com',
  platform = 'darwin' as NodeJS.Platform,
}: {
  updateURL?: string;
  platform?: NodeJS.Platform;
} = {}): Promise<UpdaterHarness> {
  vi.resetModules();
  vi.doUnmock('electron');
  vi.unstubAllGlobals();

  // CI fix: `src/main/updater.ts` gates on `SUPPORTED_PLATFORMS =
  // new Set(['darwin', 'win32'])` and reads `process.platform`
  // directly. Without the stub the Linux CI runner hits the
  // `'unavailable'` early-return and the autoUpdater handlers are
  // never registered. Defaults to `'darwin'` so every existing test
  // body keeps working unchanged; tests that exercise the unsupported
  // path can pass `platform: 'linux'` explicitly.
  stubProcessPlatform(platform);

  const autoUpdaterHandlers = new Map<string, Handler>();
  const ipcHandlers = new Map<string, IpcHandler>();
  const checkForUpdates = vi.fn().mockResolvedValue(undefined);
  const quitAndInstall = vi.fn();

  vi.doMock('electron', () => ({
    app: {
      isPackaged: true,
      isReady: () => true,
      once: vi.fn(),
      getVersion: () => '0.3.0',
    },
    autoUpdater: {
      on: (event: string, handler: Handler) => {
        autoUpdaterHandlers.set(event, handler);
      },
      setFeedURL: vi.fn(),
      checkForUpdates,
      quitAndInstall,
    },
    BrowserWindow: { getAllWindows: () => [] },
    ipcMain: {
      handle: (channel: string, handler: IpcHandler) => {
        ipcHandlers.set(channel, handler);
      },
    },
  }));

  vi.stubGlobal('__LINGUA_UPDATE_URL__', updateURL);

  const { registerUpdater } = await import('../../src/main/updater');
  registerUpdater();

  const getStateHandler = ipcHandlers.get('updates:get-state');
  expect(getStateHandler).toBeTypeOf('function');

  return {
    autoUpdaterHandlers,
    ipcHandlers,
    checkForUpdates,
    quitAndInstall,
    getState: async () => (await getStateHandler!()) as UpdateState,
  };
}

afterEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  vi.doUnmock('electron');
  vi.unstubAllGlobals();
  restoreProcessPlatform();
});

describe('updater state-machine guards', () => {
  it('captures every handler registerUpdater is expected to wire up', async () => {
    const harness = await loadUpdaterHarness();

    expect(harness.autoUpdaterHandlers.get('checking-for-update')).toBeTypeOf('function');
    expect(harness.autoUpdaterHandlers.get('update-downloaded')).toBeTypeOf('function');
    expect(harness.autoUpdaterHandlers.get('update-not-available')).toBeTypeOf('function');
    expect(harness.autoUpdaterHandlers.get('update-available')).toBeTypeOf('function');
    expect(harness.ipcHandlers.get('updates:check')).toBeTypeOf('function');
    expect(harness.ipcHandlers.get('updates:get-state')).toBeTypeOf('function');
    expect(harness.ipcHandlers.get('updates:restart')).toBeTypeOf('function');
  });

  it('preserves the terminal downloaded status across the full hourly poll sequence', async () => {
    const harness = await loadUpdaterHarness();
    const updateDownloaded = harness.autoUpdaterHandlers.get('update-downloaded')!;
    const checkingForUpdate = harness.autoUpdaterHandlers.get('checking-for-update')!;
    const updateNotAvailable = harness.autoUpdaterHandlers.get('update-not-available')!;

    updateDownloaded(
      undefined,
      'v0.4.0 release notes',
      'v0.4.0',
      undefined,
      'https://updates.example.com/darwin/0.4.0'
    );
    expect(await harness.getState()).toMatchObject({
      status: 'downloaded',
      releaseName: 'v0.4.0',
    });

    checkingForUpdate();
    updateNotAvailable();

    expect(await harness.getState()).toMatchObject({
      status: 'downloaded',
      releaseName: 'v0.4.0',
    });
  });

  it('preserves downloaded state while a manual check is dispatched', async () => {
    const harness = await loadUpdaterHarness();
    const updateDownloaded = harness.autoUpdaterHandlers.get('update-downloaded')!;
    const check = harness.ipcHandlers.get('updates:check')!;

    updateDownloaded(
      undefined,
      'v0.4.0 release notes',
      'v0.4.0',
      undefined,
      'https://updates.example.com/darwin/0.4.0'
    );

    const result = await check();

    expect(harness.checkForUpdates).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ status: 'downloaded', releaseName: 'v0.4.0' });
    expect(await harness.getState()).toMatchObject({
      status: 'downloaded',
      releaseName: 'v0.4.0',
    });
  });

  it('preserves the in-flight available status when update-not-available races a download', async () => {
    const harness = await loadUpdaterHarness();
    const updateAvailable = harness.autoUpdaterHandlers.get('update-available')!;
    const checkingForUpdate = harness.autoUpdaterHandlers.get('checking-for-update')!;
    const updateNotAvailable = harness.autoUpdaterHandlers.get('update-not-available')!;

    updateAvailable();
    checkingForUpdate();
    updateNotAvailable();

    expect(await harness.getState()).toMatchObject({ status: 'available' });
  });

  it('updates:restart attempts quitAndInstall via the recovery path even when status is not downloaded', async () => {
    const harness = await loadUpdaterHarness();
    const restart = harness.ipcHandlers.get('updates:restart')!;

    expect(await harness.getState()).toMatchObject({ status: 'idle', enabled: true });

    const result = await restart();

    expect(result).toBe(true);
    expect(harness.quitAndInstall).toHaveBeenCalledOnce();
  });

  it('updates:restart short-circuits when updates are disabled', async () => {
    const harness = await loadUpdaterHarness({ updateURL: 'http://updates.example.com' });
    const restart = harness.ipcHandlers.get('updates:restart')!;

    expect(await harness.getState()).toMatchObject({
      status: 'unavailable',
      enabled: false,
    });

    const result = await restart();

    expect(result).toBe(false);
    expect(harness.quitAndInstall).not.toHaveBeenCalled();
  });
});
