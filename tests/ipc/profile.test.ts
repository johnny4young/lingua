import { beforeEach, describe, expect, it, vi } from 'vitest';

const handlers = new Map<string, (...args: unknown[]) => unknown>();
const mockShowMessageBox = vi.fn(async () => ({ response: 1 }));
const mockFromWebContents = vi.fn(() => ({ id: 1 }));

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler);
    },
  },
  dialog: {
    showMessageBox: mockShowMessageBox,
  },
  BrowserWindow: {
    fromWebContents: mockFromWebContents,
  },
}));

describe('profile IPC handlers', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    handlers.clear();
  });

  it('sanitizes malformed replacement counts before interpolating dialog copy', async () => {
    const { registerProfileHandlers } = await import('#src/main/ipc/profile');
    registerProfileHandlers();

    const handler = handlers.get('profile:confirm-replace');
    await handler?.(
      { sender: {} } as never,
      { snippets: Number.POSITIVE_INFINITY, envVars: Number.NaN },
      'en'
    );

    expect(mockShowMessageBox).toHaveBeenCalledWith(
      { id: 1 },
      expect.objectContaining({
        detail: expect.stringContaining('0 snippets, 0 env vars'),
      })
    );
  });

  it('cancels when the sender has no BrowserWindow', async () => {
    mockFromWebContents.mockReturnValueOnce(null);
    const { registerProfileHandlers } = await import('#src/main/ipc/profile');
    registerProfileHandlers();

    const handler = handlers.get('profile:confirm-replace');
    await expect(
      handler?.({ sender: {} } as never, { snippets: 1, envVars: 1 }, 'en')
    ).resolves.toBe(1);
    expect(mockShowMessageBox).not.toHaveBeenCalled();
  });
});
