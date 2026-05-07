import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const handlers = new Map<string, (...args: unknown[]) => unknown>();
const listeners = new Map<string, (...args: unknown[]) => unknown>();
const mockWriteFile = vi.fn().mockResolvedValue(undefined);
const mockMkdir = vi.fn().mockResolvedValue(undefined);
const mockCapturePage = vi.fn().mockResolvedValue({
  toPNG: () => Buffer.from('png-bytes'),
});
const mockAppExit = vi.fn();
const mockGetAppMetrics = vi.fn(() => [
  {
    type: 'Browser',
    pid: 123,
    memory: {
      workingSetSize: 2048,
      peakWorkingSetSize: 4096,
      privateBytes: 1024,
    },
  },
]);
const originalArgv = process.argv;

vi.mock('electron', () => ({
  app: {
    exit: mockAppExit,
    getAppMetrics: mockGetAppMetrics,
  },
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler);
    },
    on: (channel: string, handler: (...args: unknown[]) => unknown) => {
      listeners.set(channel, handler);
    },
  },
  BrowserWindow: {
    fromWebContents: vi.fn(() => ({
      capturePage: mockCapturePage,
    })),
  },
}));

vi.mock('node:fs/promises', () => ({
  mkdir: mockMkdir,
  writeFile: mockWriteFile,
  default: {
    mkdir: mockMkdir,
    writeFile: mockWriteFile,
  },
}));

describe('desktop smoke IPC handlers', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    handlers.clear();
    listeners.clear();
    process.env.LINGUA_DESKTOP_SMOKE = '1';
    process.env.LINGUA_SMOKE_ARTIFACT_DIR = '/tmp/lingua-smoke';
  });

  afterEach(() => {
    process.argv = originalArgv;
  });

  it('returns smoke config and writes screenshot artifacts', async () => {
    const { registerDesktopSmokeHandlers } = await import('#src/main/ipc/desktopSmoke');
    registerDesktopSmokeHandlers();

    const getConfig = handlers.get('desktop-smoke:get-config');
    const capture = handlers.get('desktop-smoke:capture');

    expect(await getConfig?.()).toEqual({
      enabled: true,
      artifactDir: '/tmp/lingua-smoke',
      offline: false,
      packagedSubset: false,
    });

    const screenshotPath = await capture?.({ sender: {} } as never, 'Rust Panel');

    expect(mockCapturePage).toHaveBeenCalled();
    expect(mockWriteFile).toHaveBeenCalledWith(
      '/tmp/lingua-smoke/rust-panel.png',
      expect.any(Buffer)
    );
    expect(screenshotPath).toBe('/tmp/lingua-smoke/rust-panel.png');
  });

  it('writes JSON artifacts and exits with the reported status', async () => {
    const { registerDesktopSmokeHandlers } = await import('#src/main/ipc/desktopSmoke');
    registerDesktopSmokeHandlers();

    const writeJson = handlers.get('desktop-smoke:write-json-artifact');
    const finish = listeners.get('desktop-smoke:finish');

    const artifactPath = await writeJson?.({} as never, 'summary.json', { ok: true });

    expect(mockWriteFile).toHaveBeenCalledWith(
      '/tmp/lingua-smoke/summary.json',
      JSON.stringify({ ok: true }, null, 2),
      'utf8'
    );
    expect(artifactPath).toBe('/tmp/lingua-smoke/summary.json');

    finish?.({} as never, false);
    await new Promise((resolve) => setImmediate(resolve));

    expect(mockAppExit).toHaveBeenCalledWith(1);
  });

  it('accepts CLI flags when LaunchServices drops smoke environment variables', async () => {
    delete process.env.LINGUA_DESKTOP_SMOKE;
    delete process.env.LINGUA_SMOKE_ARTIFACT_DIR;
    process.argv = [
      ...originalArgv,
      '--lingua-desktop-smoke',
      '--lingua-smoke-artifact-dir=/tmp/lingua-smoke-argv',
    ];

    const { registerDesktopSmokeHandlers } = await import('#src/main/ipc/desktopSmoke');
    registerDesktopSmokeHandlers();

    const getConfig = handlers.get('desktop-smoke:get-config');

    expect(await getConfig?.()).toEqual({
      enabled: true,
      artifactDir: '/tmp/lingua-smoke-argv',
      offline: false,
      packagedSubset: false,
    });
  });

  it('flags offline mode when LINGUA_DESKTOP_SMOKE_OFFLINE is set', async () => {
    process.env.LINGUA_DESKTOP_SMOKE_OFFLINE = '1';
    try {
      const { registerDesktopSmokeHandlers } = await import('#src/main/ipc/desktopSmoke');
      registerDesktopSmokeHandlers();

      const getConfig = handlers.get('desktop-smoke:get-config');
      expect(await getConfig?.()).toEqual({
        enabled: true,
        artifactDir: '/tmp/lingua-smoke',
        offline: true,
        packagedSubset: false,
      });

      const getOfflineBlocks = handlers.get('desktop-smoke:get-offline-blocks');
      expect(await getOfflineBlocks?.()).toEqual([]);
    } finally {
      delete process.env.LINGUA_DESKTOP_SMOKE_OFFLINE;
    }
  });

  it('flags packaged-subset mode when LINGUA_DESKTOP_SMOKE_PACKAGED_SUBSET is set (RL-080 Slice 3)', async () => {
    process.env.LINGUA_DESKTOP_SMOKE_PACKAGED_SUBSET = '1';
    try {
      const { registerDesktopSmokeHandlers } = await import('#src/main/ipc/desktopSmoke');
      registerDesktopSmokeHandlers();

      const getConfig = handlers.get('desktop-smoke:get-config');
      expect(await getConfig?.()).toEqual({
        enabled: true,
        artifactDir: '/tmp/lingua-smoke',
        offline: false,
        packagedSubset: true,
      });
    } finally {
      delete process.env.LINGUA_DESKTOP_SMOKE_PACKAGED_SUBSET;
    }
  });

  it('returns memory metrics when smoke mode is enabled', async () => {
    const { registerDesktopSmokeHandlers } = await import('#src/main/ipc/desktopSmoke');
    registerDesktopSmokeHandlers();

    const getMemorySnapshot = handlers.get('desktop-smoke:get-memory-snapshot');
    const snapshot = await getMemorySnapshot?.();

    expect(snapshot).toMatchObject({
      ok: true,
      process: {
        rssBytes: expect.any(Number),
        heapTotalBytes: expect.any(Number),
        heapUsedBytes: expect.any(Number),
      },
      chromium: [
        {
          type: 'Browser',
          pid: 123,
          workingSetSizeBytes: 2048 * 1024,
          peakWorkingSetSizeBytes: 4096 * 1024,
          privateBytes: 1024,
        },
      ],
    });
  });

  it('returns unsupported when process memoryUsage is unavailable', async () => {
    const originalMemoryUsage = process.memoryUsage;
    Object.defineProperty(process, 'memoryUsage', {
      configurable: true,
      value: undefined,
    });
    try {
      const { registerDesktopSmokeHandlers } = await import('#src/main/ipc/desktopSmoke');
      registerDesktopSmokeHandlers();

      const getMemorySnapshot = handlers.get('desktop-smoke:get-memory-snapshot');
      expect(await getMemorySnapshot?.()).toEqual({
        ok: false,
        reason: 'unsupported',
      });
    } finally {
      Object.defineProperty(process, 'memoryUsage', {
        configurable: true,
        value: originalMemoryUsage,
      });
    }
  });

  it('returns smoke-disabled when smoke mode is off', async () => {
    delete process.env.LINGUA_DESKTOP_SMOKE;
    process.argv = process.argv.filter((arg) => arg !== '--lingua-desktop-smoke');

    const { registerDesktopSmokeHandlers } = await import('#src/main/ipc/desktopSmoke');
    registerDesktopSmokeHandlers();

    const getMemorySnapshot = handlers.get('desktop-smoke:get-memory-snapshot');
    expect(await getMemorySnapshot?.()).toEqual({
      ok: false,
      reason: 'smoke-disabled',
    });
  });
});
