/**
 * RL-011 Slice B — main-process `env:snapshot` IPC handler.
 *
 * The snapshot must only expose string values (binary env junk should not
 * reach the renderer) and must register under the `env:snapshot` channel
 * so the preload can forward the call.
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

  it('returns a string-only snapshot of process.env', async () => {
    const { snapshotProcessEnv } = await import('../../src/main/ipc/env');
    const originalEnv = process.env;
    // Cast to any so we can stub a non-string value without TS yelling.
    (process as { env: Record<string, unknown> }).env = {
      LINGUA_TEST_STRING: 'ok',
      LINGUA_TEST_EMPTY: '',
      LINGUA_TEST_NONSTRING: 42,
    };

    try {
      const snapshot = snapshotProcessEnv();
      expect(snapshot.LINGUA_TEST_STRING).toBe('ok');
      expect(snapshot.LINGUA_TEST_EMPTY).toBe('');
      expect('LINGUA_TEST_NONSTRING' in snapshot).toBe(false);
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
