import { beforeEach, describe, expect, it, vi } from 'vitest';

type IpcHandler = (event: unknown, ...args: unknown[]) => unknown;

const electronMock = vi.hoisted(() => ({
  handlers: new Map<string, IpcHandler>(),
  getVersion: vi.fn(() => '9.9.9'),
  openExternal: vi.fn(async () => undefined),
}));

vi.mock('electron', () => ({
  app: {
    getVersion: electronMock.getVersion,
  },
  ipcMain: {
    handle: (channel: string, handler: IpcHandler) => {
      electronMock.handlers.set(channel, handler);
    },
  },
  shell: {
    openExternal: electronMock.openExternal,
  },
}));

describe('appInfo IPC', () => {
  beforeEach(() => {
    electronMock.handlers.clear();
    electronMock.getVersion.mockClear();
    electronMock.openExternal.mockClear();
    vi.resetModules();
  });

  it('exposes packaged app metadata without leaking package internals', async () => {
    const { registerAppInfoHandlers } = await import('../../src/main/ipc/appInfo');
    registerAppInfoHandlers();

    const handler = electronMock.handlers.get('app:get-info');
    expect(handler).toBeTypeOf('function');

    const result = await handler!({});
    expect(result).toMatchObject({
      productName: 'Lingua',
      version: '9.9.9',
      licenseType: 'Commercial',
    });
  });

  it('rejects malformed open-external payloads before reaching shell.openExternal', async () => {
    const { registerAppInfoHandlers } = await import('../../src/main/ipc/appInfo');
    registerAppInfoHandlers();

    const handler = electronMock.handlers.get('app:open-external');
    expect(handler).toBeTypeOf('function');

    await expect(handler!({}, null)).resolves.toBe(false);
    await expect(handler!({}, { href: 'https://github.com/johnny4young/lingua' })).resolves.toBe(false);
    await expect(handler!({}, ['https://github.com/johnny4young/lingua'])).resolves.toBe(false);
    await expect(handler!({}, 'javascript:alert(1)')).resolves.toBe(false);

    expect(electronMock.openExternal).not.toHaveBeenCalled();
  });

  it('opens normalized http and https urls only after validation', async () => {
    const { registerAppInfoHandlers } = await import('../../src/main/ipc/appInfo');
    registerAppInfoHandlers();

    const handler = electronMock.handlers.get('app:open-external');
    expect(handler).toBeTypeOf('function');

    await expect(handler!({}, ' https://github.com/johnny4young/lingua ')).resolves.toBe(true);
    expect(electronMock.openExternal).toHaveBeenCalledWith(
      'https://github.com/johnny4young/lingua'
    );
  });
});
