import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SecretStore } from '../../src/main/secretStore';

const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (event: unknown, ...args: unknown[]) => unknown) => {
      handlers.set(channel, handler);
    },
  },
}));

const { registerSecretHandlers } = await import('../../src/main/ipc/secrets');

function memoryStore(): SecretStore {
  const values = new Map<string, string>();
  return {
    status: () => ({ mode: 'encrypted' }),
    set: vi.fn(async (id: string, value: string) => {
      values.set(id, value);
      return { ok: true as const, mode: 'encrypted' as const };
    }),
    get: async (id: string) => values.get(id) ?? null,
    delete: async (id: string) => values.delete(id),
    list: async (prefix: string) => [...values.keys()].filter((id) => id.startsWith(prefix)),
  };
}

const invoke = (channel: string, ...args: unknown[]) => handlers.get(channel)!({}, ...args);

describe('secrets IPC handlers', () => {
  let store: SecretStore;
  beforeEach(() => {
    handlers.clear();
    store = memoryStore();
    registerSecretHandlers(store);
  });

  it('registers every secrets channel', () => {
    expect([...handlers.keys()].sort()).toEqual([
      'secrets:delete',
      'secrets:get',
      'secrets:list',
      'secrets:set',
      'secrets:status',
    ]);
  });

  it('keeps database passwords out of the renderer\'s reach', async () => {
    await store.set('db.conn_1', 'hunter2');
    expect(await invoke('secrets:get', 'db.conn_1')).toBeNull();
    expect(await invoke('secrets:set', 'db.conn_1', 'x')).toEqual({ ok: false, reason: 'invalid-id' });
    expect(await invoke('secrets:delete', 'db.conn_1')).toEqual({ ok: false });
    expect(await invoke('secrets:list', 'db.')).toEqual([]);
    expect(await store.get('db.conn_1')).toBe('hunter2');
  });

  it('rejects non-string arguments before reaching the store', async () => {
    expect(await invoke('secrets:set', 42, 'x')).toEqual({ ok: false, reason: 'invalid-id' });
    expect(await invoke('secrets:set', 'ai.api-key', { value: 'x' })).toEqual({
      ok: false,
      reason: 'invalid-value',
    });
    expect(store.set).not.toHaveBeenCalled();
    expect(await invoke('secrets:get', '../../etc/passwd')).toBeNull();
    expect(await invoke('secrets:delete', null)).toEqual({ ok: false });
    expect(await invoke('secrets:list', '')).toEqual([]);
  });

  it('passes valid calls through', async () => {
    expect(await invoke('secrets:set', 'ai.api-key', 'sk')).toEqual({ ok: true, mode: 'encrypted' });
    expect(await invoke('secrets:get', 'ai.api-key')).toBe('sk');
    expect(await invoke('secrets:list', 'ai.')).toEqual(['ai.api-key']);
    expect(await invoke('secrets:delete', 'ai.api-key')).toEqual({ ok: true });
    expect(await invoke('secrets:status')).toEqual({ mode: 'encrypted' });
  });
});
