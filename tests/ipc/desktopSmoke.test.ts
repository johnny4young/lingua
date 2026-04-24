import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const handlers = new Map<string, (...args: unknown[]) => unknown>();
const listeners = new Map<string, (...args: unknown[]) => unknown>();
const mockWriteFile = vi.fn().mockResolvedValue(undefined);
const mockMkdir = vi.fn().mockResolvedValue(undefined);
const mockCapturePage = vi.fn().mockResolvedValue({
  toPNG: () => Buffer.from('png-bytes'),
});
const mockAppExit = vi.fn();
const originalArgv = process.argv;

vi.mock('electron', () => ({
  app: {
    exit: mockAppExit,
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
    });
  });
});
