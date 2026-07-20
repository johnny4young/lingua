/**
 * implementation — main-process `env:snapshot` IPC handler.
 *
 * The bridge exists so implementation can wire against a stable API shape, but
 * it must NOT leak the host environment into the renderer. The real
 * subprocess merge stays in main once runner integration lands.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type IpcHandler = (event: unknown, ...args: unknown[]) => unknown;
const ipcHandlers = new Map<string, IpcHandler>();

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: IpcHandler) => {
      ipcHandlers.set(channel, handler);
    },
  },
}));

describe('env:snapshot IPC', () => {
  beforeEach(() => {
    ipcHandlers.clear();
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('registers the env:snapshot channel on registerEnvHandlers()', async () => {
    const { registerEnvHandlers } = await import('../../src/main/ipc/env');
    registerEnvHandlers();
    expect(ipcHandlers.has('env:snapshot')).toBe(true);
  });

  it('returns an empty object instead of exposing process.env', async () => {
    const { snapshotProcessEnv } = await import('../../src/main/ipc/env');
    const originalEnv = process.env;
    (process as { env: Record<string, unknown> }).env = {
      LINGUA_TEST_STRING: 'ok',
      OPENAI_API_KEY: 'secret',
    };
    try {
      expect(snapshotProcessEnv()).toEqual({});
    } finally {
      process.env = originalEnv;
    }
  });

  it('invoking the handler returns the snapshot', async () => {
    const { registerEnvHandlers } = await import('../../src/main/ipc/env');
    registerEnvHandlers();
    const handler = ipcHandlers.get('env:snapshot');
    expect(handler).toBeDefined();
    const result = await handler?.({});
    expect(result && typeof result === 'object').toBe(true);
  });
});
