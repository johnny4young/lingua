import { beforeEach, describe, expect, it, vi } from 'vitest';

const electronMock = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, ...args: unknown[]) => unknown>(),
  getPath: vi.fn(() => '/Users/example/Library/Application Support/Lingua'),
  openPath: vi.fn(async () => ''),
  fromWebContents: vi.fn(() => ({ id: 1 })),
  showMessageBox: vi.fn(async () => ({ response: 1 })),
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: (
      channel: string,
      handler: (event: unknown, ...args: unknown[]) => unknown
    ) => {
      electronMock.handlers.set(channel, handler);
    },
  },
  app: {
    getPath: electronMock.getPath,
  },
  shell: {
    openPath: electronMock.openPath,
  },
  BrowserWindow: {
    fromWebContents: electronMock.fromWebContents,
  },
  dialog: {
    showMessageBox: electronMock.showMessageBox,
  },
}));

describe('recovery IPC', () => {
  beforeEach(() => {
    electronMock.handlers.clear();
    electronMock.getPath.mockClear();
    electronMock.openPath.mockClear();
    electronMock.fromWebContents.mockClear();
    electronMock.showMessageBox.mockClear();
    vi.resetModules();
  });

  it('opens the recovery folder without returning the absolute path to the renderer', async () => {
    const { registerRecoveryHandlers } = await import('../../src/main/ipc/recovery');
    registerRecoveryHandlers();

    const handler = electronMock.handlers.get('recovery:reveal-folder');
    expect(handler).toBeTypeOf('function');

    const result = await handler!({});
    expect(electronMock.getPath).toHaveBeenCalledWith('userData');
    expect(electronMock.openPath).toHaveBeenCalledWith(
      '/Users/example/Library/Application Support/Lingua'
    );
    expect(result).toEqual({ ok: true });
  });

  it('returns a typed error when the OS file browser cannot open the recovery folder', async () => {
    electronMock.openPath.mockResolvedValueOnce('denied');
    const { registerRecoveryHandlers } = await import('../../src/main/ipc/recovery');
    registerRecoveryHandlers();

    const handler = electronMock.handlers.get('recovery:reveal-folder');
    const result = await handler!({});
    expect(result).toEqual({
      ok: false,
      reason: 'open-failed',
      message: 'denied',
    });
  });
});
