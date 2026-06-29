/**
 * State-machine guards for `src/main/updater.ts` (electron-updater engine).
 * Locks in two regressions reported in production:
 *
 * 1. The hourly `setInterval` poll fired `checkForUpdates()` after a
 *    download had already landed. The updater emits `checking-for-update`
 *    before `update-not-available`; both transitions must preserve the
 *    terminal `'downloaded'` state.
 * 2. The `updates:restart` IPC handler used to return `false` silently
 *    when `updateState.status !== 'downloaded'`, masking the above.
 *
 * The feed itself is read from electron-builder's generated `app-update.yml`
 * (the GitHub publish provider), so there is no feed URL to configure or
 * gate on — "disabled" now means an unpackaged / unsupported build.
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
  packaged = true,
  platform = 'darwin' as NodeJS.Platform,
}: {
  packaged?: boolean;
  platform?: NodeJS.Platform;
} = {}): Promise<UpdaterHarness> {
  vi.resetModules();
  vi.doUnmock('electron');
  vi.doUnmock('electron-updater');

  // The updater gates on SUPPORTED_PLATFORMS (darwin/win32/linux) and reads
  // `process.platform` directly. Defaults to 'darwin' so existing test bodies
  // keep working; the unsupported-path test passes an unknown platform.
  stubProcessPlatform(platform);

  const autoUpdaterHandlers = new Map<string, Handler>();
  const ipcHandlers = new Map<string, IpcHandler>();
  const checkForUpdates = vi.fn().mockResolvedValue(undefined);
  const quitAndInstall = vi.fn();

  vi.doMock('electron', () => ({
    app: {
      isPackaged: packaged,
      isReady: () => true,
      once: vi.fn(),
      getVersion: () => '0.3.0',
    },
    BrowserWindow: { getAllWindows: () => [] },
    ipcMain: {
      handle: (channel: string, handler: IpcHandler) => {
        ipcHandlers.set(channel, handler);
      },
    },
  }));

  vi.doMock('electron-updater', () => ({
    autoUpdater: {
      autoDownload: false,
      autoInstallOnAppQuit: false,
      on: (event: string, handler: Handler) => {
        autoUpdaterHandlers.set(event, handler);
      },
      checkForUpdates,
      quitAndInstall,
    },
  }));

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
  vi.doUnmock('electron-updater');
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

  it('supports Linux now that electron-updater handles AppImage updates', async () => {
    const harness = await loadUpdaterHarness({ platform: 'linux' as NodeJS.Platform });
    expect(await harness.getState()).toMatchObject({ status: 'idle', enabled: true });
  });

  it('preserves the terminal downloaded status across the full hourly poll sequence', async () => {
    const harness = await loadUpdaterHarness();
    const updateDownloaded = harness.autoUpdaterHandlers.get('update-downloaded')!;
    const checkingForUpdate = harness.autoUpdaterHandlers.get('checking-for-update')!;
    const updateNotAvailable = harness.autoUpdaterHandlers.get('update-not-available')!;

    updateDownloaded({ version: '0.4.0', releaseName: 'v0.4.0', releaseNotes: 'notes' });
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

    updateDownloaded({ version: '0.4.0', releaseName: 'v0.4.0', releaseNotes: 'notes' });

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

    updateAvailable({ version: '0.4.0', releaseName: 'v0.4.0' });
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

  it('updates:restart short-circuits when updates are disabled (unpackaged build)', async () => {
    const harness = await loadUpdaterHarness({ packaged: false });
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
